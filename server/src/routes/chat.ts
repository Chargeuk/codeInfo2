import type { LMStudioClient } from '@lmstudio/sdk';
import { Router, json } from 'express';
import mongoose from 'mongoose';
import { UnsupportedProviderError, getChatInterface } from '../chat/factory.js';
import type { ChatInterface } from '../chat/interfaces/ChatInterface.js';
import type { CodexLike } from '../chat/interfaces/ChatInterfaceCodex.js';
import {
  endStream,
  isStreamClosed,
  startStream,
  writeEvent,
} from '../chatStream.js';
import { append } from '../logStore.js';
import { baseLogger, resolveLogConfig } from '../logger.js';
import { ConversationModel, type Conversation } from '../mongo/conversation.js';
import {
  appendTurn,
  createConversation,
  updateConversationMeta,
} from '../mongo/repo.js';
import { TurnModel, type Turn, type TurnStatus } from '../mongo/turn.js';
import { getCodexDetection } from '../providers/codexRegistry.js';
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

const preferMemoryPersistence = process.env.NODE_ENV === 'test';
const shouldUseMemoryPersistence = () =>
  preferMemoryPersistence || mongoose.connection.readyState !== 1;
const memoryConversations = new Map<string, Conversation>();
const memoryTurns = new Map<string, Turn[]>();

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
    // Request example: { "conversationId": "abc123", "model": "llama-3", "provider": "lmstudio", "message": "Hi there", "sandboxMode": "workspace-write" }
    // History guard example error: 400 { "error": "invalid request", "message": "conversationId required; history is loaded server-side" }
    const requestId = res.locals.requestId as string | undefined;
    const rawBody = req.body ?? {};
    const rawSize = JSON.stringify(rawBody).length;
    if (rawSize > maxClientBytes) {
      return res.status(400).json({ error: 'payload too large' });
    }

    let validatedBody;
    try {
      validatedBody = validateChatRequest(rawBody);
    } catch (err) {
      if (err instanceof ChatValidationError) {
        return res
          .status(400)
          .json({ error: 'invalid request', message: err.message });
      }
      throw err;
    }

    const {
      model,
      message,
      provider,
      conversationId,
      threadId,
      codexFlags,
      warnings,
    } = validatedBody;

    const now = new Date();
    const toolCallsForTurn: Array<Record<string, unknown>> = [];
    let assistantContent = '';
    let assistantStatus: TurnStatus = 'ok';
    let assistantTurnRecorded = false;

    const ensureConversation = async (): Promise<Conversation | null> => {
      if (shouldUseMemoryPersistence()) {
        const existing = memoryConversations.get(conversationId) ?? null;
        if (existing?.archivedAt) {
          res.status(410).json({ error: 'archived' });
          return null;
        }

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
      if (existing?.archivedAt) {
        res.status(410).json({ error: 'archived' });
        return null;
      }

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
        ? [...(memoryTurns.get(conversationId) ?? [])]
        : ((await TurnModel.find({ conversationId })
            .sort({ createdAt: 1, _id: 1 })
            .lean()
            .exec()) as Turn[]);

    const recordUserTurn = async () => {
      if (shouldUseMemoryPersistence()) {
        const turns = memoryTurns.get(conversationId) ?? [];
        turns.push({
          conversationId,
          role: 'user',
          content: message,
          model,
          provider,
          source: 'REST',
          toolCalls: null,
          status: 'ok',
          createdAt: now,
        } as Turn);
        memoryTurns.set(conversationId, turns);
        const existing = memoryConversations.get(conversationId);
        if (existing) {
          memoryConversations.set(conversationId, {
            ...existing,
            lastMessageAt: now,
            updatedAt: now,
          });
        }
        return;
      }
      await appendTurn({
        conversationId,
        role: 'user',
        content: message,
        model,
        provider,
        source: 'REST',
        toolCalls: null,
        status: 'ok',
        createdAt: now,
      });
    };

    const recordAssistantTurn = async () => {
      if (assistantTurnRecorded) return;
      assistantTurnRecorded = true;
      try {
        if (shouldUseMemoryPersistence()) {
          const turns = memoryTurns.get(conversationId) ?? [];
          turns.push({
            conversationId,
            role: 'assistant',
            content: assistantContent,
            model,
            provider,
            source: 'REST',
            toolCalls:
              toolCallsForTurn.length > 0 ? { calls: toolCallsForTurn } : null,
            status: assistantStatus,
            createdAt: new Date(),
          } as Turn);
          memoryTurns.set(conversationId, turns);
          const existing = memoryConversations.get(conversationId);
          if (existing) {
            memoryConversations.set(conversationId, {
              ...existing,
              lastMessageAt: new Date(),
              updatedAt: new Date(),
            });
          }
          return;
        }
        await appendTurn({
          conversationId,
          role: 'assistant',
          content: assistantContent,
          model,
          provider,
          source: 'REST',
          toolCalls:
            toolCallsForTurn.length > 0 ? { calls: toolCallsForTurn } : null,
          status: assistantStatus,
        });
      } catch (err) {
        baseLogger.error(
          { requestId, provider, model, conversationId, err },
          'failed to record assistant turn',
        );
      }
    };

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
    const controller = new AbortController();
    let ended = false;
    let completed = false;
    let cancelled = false;

    const endIfOpen = () => {
      if (ended || isStreamClosed(res)) return;
      ended = true;
      endStream(res);
    };

    const existingConversation = await ensureConversation();
    if (!existingConversation) return;

    const chronologicalTurns = await loadTurnsChronological();
    await recordUserTurn();

    if (provider === 'codex') {
      const detection = getCodexDetection();
      if (!detection.available) {
        append({
          level: 'error',
          message: 'chat stream unavailable (codex)',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            provider,
            model,
            reason: detection.reason,
          },
        });
        baseLogger.error(
          { requestId, provider, model, reason: detection.reason },
          'chat stream unavailable (codex)',
        );
        return res
          .status(503)
          .json({ error: 'codex unavailable', reason: detection.reason });
      }

      const endIfOpen = () => {
        if (ended || isStreamClosed(res)) return;
        ended = true;
        endStream(res);
      };

      const handleDisconnect = (reason: 'close' | 'aborted') => {
        if (completed) return;
        if (reason === 'close' && !controller.signal.aborted) return;
        controller.abort();
        cancelled = true;
        append({
          level: 'info',
          message: 'chat stream cancelled',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: { provider, model, reason: 'client_disconnect' },
        });
        baseLogger.info(
          { requestId, provider, model, reason: 'client_disconnect' },
          'chat stream cancelled',
        );
        endIfOpen();
      };

      req.on('close', () => handleDisconnect('close'));
      req.on('aborted', () => handleDisconnect('aborted'));
      res.on('close', handleDisconnect);
      controller.signal.addEventListener('abort', () => {
        cancelled = true;
      });

      append({
        level: 'info',
        message: 'chat stream start',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { provider, model },
      });
      baseLogger.info({ requestId, provider, model }, 'chat stream start');

      let chat: ChatInterface;
      try {
        chat = chatFactory('codex', { codexFactory });
      } catch (err) {
        if (err instanceof UnsupportedProviderError) {
          return res.status(400).json({
            error: 'unsupported provider',
            message: err.message,
          });
        }
        throw err;
      }

      startStream(res);

      let assistantContent = '';
      let assistantStatus: TurnStatus = 'ok';
      let activeThreadId =
        threadId ??
        (existingConversation.flags?.threadId as string | undefined) ??
        null;
      const toolCallsForTurn: Array<Record<string, unknown>> = [];

      chat.on('token', (ev) => {
        if (cancelled) return;
        writeEvent(res, { type: 'token', content: ev.content });
        assistantContent += ev.content;
      });

      chat.on('analysis', (ev) => {
        if (cancelled) return;
        writeEvent(res, { type: 'analysis', content: ev.content });
      });

      chat.on('tool-request', (ev) => {
        if (cancelled) return;
        writeEvent(res, {
          type: 'tool-request',
          callId: ev.callId,
          name: ev.name,
          stage: ev.stage ?? 'started',
          parameters: ev.params,
        });
      });

      chat.on('tool-result', (ev) => {
        if (cancelled) return;
        toolCallsForTurn.push({
          callId: ev.callId,
          name: ev.name,
          parameters: ev.params,
          result: ev.result,
          stage: ev.stage,
          error: ev.error ?? undefined,
        });
        writeEvent(res, {
          type: 'tool-result',
          callId: ev.callId,
          name: ev.name,
          stage: ev.stage,
          parameters: ev.params,
          result: ev.result,
          errorTrimmed: ev.error ?? undefined,
        });
      });

      chat.on('final', (ev) => {
        if (cancelled) return;
        assistantContent = ev.content;
        writeEvent(res, {
          type: 'final',
          message: { role: 'assistant', content: ev.content },
        });
      });

      chat.on('thread', (ev) => {
        activeThreadId = ev.threadId;
        writeEvent(res, { type: 'thread', threadId: ev.threadId });
      });

      chat.on('complete', (ev) => {
        completed = true;
        const tid = ev.threadId ?? activeThreadId;
        writeEvent(res, { type: 'complete', threadId: tid });
        activeThreadId = tid ?? activeThreadId;
      });

      chat.on('error', (ev) => {
        assistantStatus = cancelled ? 'stopped' : 'failed';
        writeEvent(res, { type: 'error', message: ev.message });
      });

      try {
        await chat.run(
          message,
          {
            threadId: activeThreadId,
            codexFlags,
            requestId,
            signal: controller.signal,
            source: 'REST',
          },
          conversationId,
          model,
        );
        if (!completed && !isStreamClosed(res)) {
          completed = true;
          writeEvent(res, { type: 'complete', threadId: activeThreadId });
        }
        append({
          level: 'info',
          message: 'chat stream complete',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            provider,
            model,
            threadId: activeThreadId,
            conversationId,
          },
        });
        baseLogger.info(
          {
            requestId,
            provider,
            model,
            threadId: activeThreadId,
            conversationId,
          },
          'chat stream complete',
        );
      } catch (err) {
        const messageText =
          (err as Error | undefined)?.message ?? 'codex unavailable';
        assistantStatus = cancelled ? 'stopped' : 'failed';
        writeEvent(res, { type: 'error', message: messageText });
        append({
          level: 'error',
          message: 'chat stream failed',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: { provider, model, conversationId, error: messageText },
        });
        baseLogger.error(
          { requestId, provider, model, conversationId, error: messageText },
          'chat stream failed',
        );
      } finally {
        if (cancelled && assistantContent === '') {
          assistantStatus = 'stopped';
        }
        // Codex class already persisted assistant turn; we still emit status bubble when stopped.
        if (assistantStatus === 'stopped') {
          writeEvent(res, {
            type: 'error',
            message: 'generation stopped',
          });
        }
        endIfOpen();
      }

      return;
    }

    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? '';
    const safeBase = scrubBaseUrl(baseUrl);

    if (!BASE_URL_REGEX.test(baseUrl)) {
      append({
        level: 'error',
        message: 'chat stream invalid baseUrl',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, model, provider },
      });
      baseLogger.error(
        { requestId, baseUrl: safeBase, model, provider },
        'chat stream invalid baseUrl',
      );
      return res.status(503).json({ error: 'lmstudio unavailable' });
    }

    append({
      level: 'info',
      message: 'chat stream start',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: { baseUrl: safeBase, model, provider },
    });
    baseLogger.info(
      { requestId, baseUrl: safeBase, model, provider },
      'chat stream start',
    );

    const handleDisconnect = (reason: 'close' | 'aborted') => {
      if (completed) return;
      if (reason === 'close' && !controller.signal.aborted) return;
      controller.abort();
      cancelled = true;
      append({
        level: 'info',
        message: 'chat stream cancelled',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          baseUrl: safeBase,
          model,
          provider,
          reason: 'client_disconnect',
        },
      });
      baseLogger.info(
        {
          requestId,
          baseUrl: safeBase,
          model,
          provider,
          reason: 'client_disconnect',
        },
        'chat stream cancelled',
      );
      endIfOpen();
    };

    req.on('close', () => handleDisconnect('close'));
    req.on('aborted', () => handleDisconnect('aborted'));
    res.on('close', handleDisconnect);
    controller.signal.addEventListener('abort', () => {
      cancelled = true;
    });

    let lmChat: ChatInterface;
    try {
      lmChat = chatFactory('lmstudio', { clientFactory, toolFactory });
    } catch (err) {
      if (err instanceof UnsupportedProviderError) {
        append({
          level: 'error',
          message: 'unsupported provider',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: { provider },
        });
        baseLogger.error({ requestId, provider }, 'unsupported provider');
        return res.status(400).json({
          error: 'unsupported provider',
          message: (err as Error).message,
        });
      }
      throw err;
    }

    startStream(res);
    const toCallIdOut = (callId: string | number) => {
      const num = Number(callId);
      return Number.isFinite(num) && `${num}` === String(callId) ? num : callId;
    };

    lmChat.on('token', (ev) => {
      if (cancelled) return;
      writeEvent(res, { type: 'token', content: ev.content });
      assistantContent += ev.content;
    });

    lmChat.on('analysis', (ev) => {
      if (cancelled) return;
      writeEvent(res, {
        type: 'analysis',
        content: (ev as { content?: string }).content ?? '',
      });
    });

    lmChat.on('tool-request', (ev) => {
      if (cancelled) return;
      const callIdOut = toCallIdOut(ev.callId);
      const nameOut = ev.name && ev.name.length > 0 ? ev.name : 'VectorSearch';
      append({
        level: 'info',
        message: 'chat tool event',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          provider,
          model,
          callId: callIdOut,
          name: nameOut,
          stage: ev.stage ?? 'started',
          type: 'tool-request',
        },
      });
      writeEvent(res, {
        type: 'tool-request',
        callId: callIdOut,
        name: nameOut,
        parameters: ev.params,
        stage: ev.stage ?? 'started',
      });
    });

    lmChat.on('tool-result', (ev) => {
      if (cancelled) return;
      const callIdOut = toCallIdOut(ev.callId);
      const nameOut = 'VectorSearch';
      toolCallsForTurn.push({
        callId: callIdOut,
        name: nameOut,
        parameters: ev.params,
        result: ev.result,
        stage: ev.stage,
        error: ev.error ?? undefined,
      });
      append({
        level: 'info',
        message: 'chat tool event',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          provider,
          model,
          callId: callIdOut,
          name: nameOut,
          stage: ev.stage ?? 'success',
          type: 'tool-result',
          error: ev.error ?? undefined,
        },
      });
      writeEvent(res, {
        type: 'tool-result',
        callId: callIdOut,
        name: nameOut,
        stage: ev.stage,
        parameters: ev.params,
        result: ev.result,
        errorTrimmed: ev.error ?? undefined,
        errorFull: ev.error ?? undefined,
      });
    });

    lmChat.on('final', (ev) => {
      if (cancelled) return;
      assistantContent = ev.content;
      writeEvent(res, {
        type: 'final',
        message: { role: 'assistant', content: ev.content },
      });
    });

    lmChat.on('complete', () => {
      completed = true;
      writeEvent(res, { type: 'complete' });
    });

    lmChat.on('error', (ev) => {
      assistantStatus = cancelled ? 'stopped' : 'failed';
      writeEvent(res, { type: 'error', message: ev.message });
    });

    try {
      const historyForRun = shouldUseMemoryPersistence()
        ? chronologicalTurns
        : undefined;
      await lmChat.run(
        message,
        {
          requestId,
          baseUrl,
          signal: controller.signal,
          history: historyForRun,
          source: 'REST',
        },
        conversationId,
        model,
      );
      if (!completed && !isStreamClosed(res)) {
        completed = true;
        writeEvent(res, { type: 'complete' });
      }
      append({
        level: 'info',
        message: 'chat stream complete',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, model, provider, conversationId },
      });
      baseLogger.info(
        { requestId, baseUrl: safeBase, model, provider, conversationId },
        'chat stream complete',
      );
      assistantTurnRecorded = !shouldUseMemoryPersistence(); // ChatInterfaceLMStudio persists only when Mongo is connected
    } catch (err) {
      const messageText =
        (err as Error | undefined)?.message ?? 'lmstudio unavailable';
      assistantStatus = cancelled ? 'stopped' : 'failed';
      writeEvent(res, { type: 'error', message: messageText });
      append({
        level: 'error',
        message: 'chat stream failed',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          baseUrl: safeBase,
          model,
          provider,
          conversationId,
          error: messageText,
        },
      });
      baseLogger.error(
        {
          requestId,
          baseUrl: safeBase,
          model,
          provider,
          conversationId,
          error: messageText,
        },
        'chat stream failed',
      );
    } finally {
      if (cancelled && assistantContent === '') {
        writeEvent(res, { type: 'error', message: 'generation stopped' });
      }
      endIfOpen();
    }
    await recordAssistantTurn();
    endIfOpen();
  });

  return router;
}
