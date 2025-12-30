import crypto from 'node:crypto';

import type { LMStudioClient } from '@lmstudio/sdk';
import { Router, json } from 'express';

import {
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../agents/runLock.js';
import { attachChatStreamBridge } from '../chat/chatStreamBridge.js';
import { UnsupportedProviderError, getChatInterface } from '../chat/factory.js';
import {
  cleanupInflight,
  createInflight,
  getInflight,
} from '../chat/inflightRegistry.js';
import type { ChatInterface } from '../chat/interfaces/ChatInterface.js';
import type { CodexLike } from '../chat/interfaces/ChatInterfaceCodex.js';
import {
  getMemoryTurns,
  memoryConversations,
  shouldUseMemoryPersistence,
} from '../chat/memoryPersistence.js';
import { append } from '../logStore.js';
import { baseLogger, resolveLogConfig } from '../logger.js';
import { ConversationModel, type Conversation } from '../mongo/conversation.js';
import { createConversation, updateConversationMeta } from '../mongo/repo.js';
import { TurnModel, type Turn } from '../mongo/turn.js';
import { getCodexDetection } from '../providers/codexRegistry.js';
import { publishUserTurn } from '../ws/server.js';
import { ChatValidationError, validateChatRequest } from './chatValidators.js';
import { BASE_URL_REGEX, scrubBaseUrl } from './lmstudioUrl.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
type ToolFactory = (opts: Record<string, unknown>) => {
  tools: ReadonlyArray<unknown>;
};
type CodexFactory = () => CodexLike;

type LMContentItem =
  | { type: 'text'; text: string }
  | {
      type: 'toolCallRequest';
      toolCallRequest: {
        id: string;
        type: 'function';
        arguments: Record<string, unknown>;
        name: string;
      };
    }
  | {
      type: 'toolCallResult';
      toolCallId: string;
      content: string;
    };

type LMMessage = {
  data?: { role?: string; content?: LMContentItem[] };
  mutable?: boolean;
  role?: string; // fallback
  content?: unknown; // fallback
};

export const getMessageRole = (message: unknown): string | undefined => {
  const msg = message as LMMessage;
  return msg.data?.role ?? msg.role;
};

export const getContentItems = (message: unknown): LMContentItem[] => {
  const msg = message as LMMessage;
  const items = msg.data?.content;
  return Array.isArray(items) ? (items as LMContentItem[]) : [];
};

export function createChatRouter({
  clientFactory,
  codexFactory,
  toolFactory,
  chatFactory = getChatInterface,
}: {
  clientFactory: ClientFactory;
  codexFactory?: CodexFactory;
  toolFactory?: ToolFactory;
  chatFactory?: typeof getChatInterface;
}) {
  const router = Router();
  const { maxClientBytes } = resolveLogConfig();
  router.use(json({ limit: `${maxClientBytes}b`, strict: false }));

  router.post('/', async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const rawBody = req.body ?? {};
    const rawSize = JSON.stringify(rawBody).length;
    if (rawSize > maxClientBytes) {
      return res.status(400).json({
        status: 'error',
        code: 'VALIDATION_FAILED',
        message: 'payload too large',
      });
    }

    let validatedBody;
    try {
      validatedBody = validateChatRequest(rawBody);
    } catch (err) {
      if (err instanceof ChatValidationError) {
        return res.status(400).json({
          status: 'error',
          code: 'VALIDATION_FAILED',
          message: err.message,
        });
      }
      throw err;
    }

    const {
      model,
      message,
      provider,
      conversationId,
      threadId,
      inflightId: requestedInflightId,
      codexFlags,
      warnings,
    } = validatedBody;

    const now = new Date();

    const ensureConversation = async (): Promise<Conversation | null> => {
      if (shouldUseMemoryPersistence()) {
        const existing = memoryConversations.get(conversationId) ?? null;
        if (existing?.archivedAt) return null;

        if (!existing) {
          const created: Conversation = {
            _id: conversationId,
            provider,
            model,
            title: message.trim().slice(0, 80) || 'Untitled conversation',
            source: 'REST',
            flags: provider === 'codex' ? { ...codexFlags } : {},
            lastMessageAt: now,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
          } as Conversation;
          memoryConversations.set(conversationId, created);
          return created;
        }

        const updated: Conversation = {
          ...existing,
          model,
          flags:
            provider === 'codex'
              ? { ...(existing.flags ?? {}), ...codexFlags }
              : existing.flags,
          source: existing.source ?? 'REST',
          lastMessageAt: now,
          updatedAt: now,
        } as Conversation;
        memoryConversations.set(conversationId, updated);
        return updated;
      }

      const existing = (await ConversationModel.findById(conversationId)
        .lean()
        .exec()) as Conversation | null;
      if (existing?.archivedAt) return null;

      if (!existing) {
        await createConversation({
          conversationId,
          provider,
          model,
          title: message.trim().slice(0, 80) || 'Untitled conversation',
          source: 'REST',
          flags: provider === 'codex' ? { ...codexFlags } : {},
          lastMessageAt: now,
        });
        const created = (await ConversationModel.findById(conversationId)
          .lean()
          .exec()) as Conversation | null;
        return created;
      }

      await updateConversationMeta({
        conversationId,
        model,
        flags:
          provider === 'codex'
            ? { ...(existing.flags ?? {}), ...codexFlags }
            : existing.flags,
        lastMessageAt: now,
      });
      const updated = (await ConversationModel.findById(conversationId)
        .lean()
        .exec()) as Conversation | null;
      return updated ?? existing;
    };

    const loadTurnsChronological = async (): Promise<Turn[]> =>
      shouldUseMemoryPersistence()
        ? getMemoryTurns(conversationId)
        : ((await TurnModel.find({ conversationId })
            .sort({ createdAt: 1, _id: 1 })
            .lean()
            .exec()) as Turn[]);

    warnings.forEach((warning) => {
      append({
        level: 'warn',
        message: 'chat codex flag ignored',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { provider, warning },
      });
      baseLogger.warn({ requestId, provider, warning }, 'chat flag ignored');
    });

    // Provider availability checks before starting background execution.
    if (provider === 'codex') {
      const detection = getCodexDetection();
      if (!detection.available) {
        return res.status(503).json({
          status: 'error',
          code: 'PROVIDER_UNAVAILABLE',
          message: detection.reason ?? 'codex unavailable',
        });
      }
    }

    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? '';
    const safeBase = scrubBaseUrl(baseUrl);

    if (provider === 'lmstudio') {
      if (!BASE_URL_REGEX.test(baseUrl)) {
        append({
          level: 'error',
          message: 'chat run invalid baseUrl',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: { baseUrl: safeBase, model, provider },
        });
        baseLogger.error(
          { requestId, baseUrl: safeBase, model, provider },
          'chat run invalid baseUrl',
        );
        return res.status(503).json({
          status: 'error',
          code: 'PROVIDER_UNAVAILABLE',
          message: 'lmstudio unavailable',
        });
      }
    }

    const existingConversation = await ensureConversation();
    if (!existingConversation) {
      return res.status(410).json({
        status: 'error',
        code: 'CONVERSATION_ARCHIVED',
        message: 'Conversation is archived and must be restored before use.',
      });
    }

    if (!tryAcquireConversationLock(conversationId)) {
      return res.status(409).json({
        status: 'error',
        code: 'RUN_IN_PROGRESS',
        message: 'Conversation already has an active run.',
      });
    }

    const inflightId =
      typeof requestedInflightId === 'string' && requestedInflightId.length > 0
        ? requestedInflightId
        : crypto.randomUUID();

    createInflight({ conversationId, inflightId });

    publishUserTurn({
      conversationId,
      inflightId,
      content: message,
      createdAt: now.toISOString(),
    });

    let chat: ChatInterface;
    try {
      chat = chatFactory(provider, {
        clientFactory,
        codexFactory,
        toolFactory,
      });
    } catch (err) {
      releaseConversationLock(conversationId);
      cleanupInflight({ conversationId, inflightId });

      if (err instanceof UnsupportedProviderError) {
        return res.status(400).json({
          status: 'error',
          code: 'UNSUPPORTED_PROVIDER',
          message: err.message,
        });
      }
      throw err;
    }

    const bridge = attachChatStreamBridge({
      conversationId,
      inflightId,
      provider,
      model,
      requestId,
      chat,
    });

    append({
      level: 'info',
      message: 'chat.run.started',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: {
        provider,
        model,
        conversationId,
        inflightId,
      },
    });
    baseLogger.info(
      { requestId, provider, model, conversationId, inflightId },
      'chat.run.started',
    );

    // Respond immediately; execution continues in the background.
    res.status(202).json({
      status: 'started',
      conversationId,
      inflightId,
      provider,
      model,
    });

    void (async () => {
      try {
        if (provider === 'codex') {
          const activeThreadId =
            threadId ??
            (existingConversation.flags?.threadId as string | undefined) ??
            null;

          await chat.run(
            message,
            {
              provider: 'codex',
              threadId: activeThreadId,
              codexFlags,
              requestId,
              signal: getInflight(conversationId)?.abortController.signal,
              source: 'REST',
            },
            conversationId,
            model,
          );
          return;
        }

        const historyForRun = shouldUseMemoryPersistence()
          ? await loadTurnsChronological()
          : undefined;

        await chat.run(
          message,
          {
            provider,
            requestId,
            baseUrl,
            signal: getInflight(conversationId)?.abortController.signal,
            history: historyForRun,
            source: 'REST',
          },
          conversationId,
          model,
        );
      } catch (err) {
        baseLogger.error(
          {
            requestId,
            provider,
            model,
            conversationId,
            inflightId,
            err,
          },
          'chat run failed',
        );
      } finally {
        bridge.cleanup();

        // Defensive cleanup: if the provider failed to emit a terminal event,
        // avoid leaving in-flight state behind.
        const leftover = getInflight(conversationId);
        if (leftover && leftover.inflightId === inflightId) {
          cleanupInflight({ conversationId, inflightId });
        }

        releaseConversationLock(conversationId);
      }
    })();
  });

  return router;
}
