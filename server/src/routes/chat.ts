import crypto from 'node:crypto';

import type { LMStudioClient } from '@lmstudio/sdk';
import type { CodexOptions } from '@openai/codex-sdk';
import { Router, json } from 'express';

import {
  getActiveRunOwnership,
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../agents/runLock.js';
import { attachChatStreamBridge } from '../chat/chatStreamBridge.js';
import { UnsupportedProviderError, getChatInterface } from '../chat/factory.js';
import {
  resolveCodexCapabilities,
  type CodexCapabilityResolution,
} from '../codex/capabilityResolver.js';
import {
  resolveRuntimeProviderSelection,
  type ChatDefaultProvider,
} from '../config/chatDefaults.js';
import {
  RuntimeConfigResolutionError,
  resolveChatRuntimeConfig,
} from '../config/runtimeConfig.js';
import {
  abortInflight,
  bindPendingConversationCancelToInflight,
  cleanupPendingConversationCancel,
  cleanupInflight,
  consumePendingConversationCancel,
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
type CodexFactory = (options?: CodexOptions) => CodexLike;

const T06_SUCCESS_LOG =
  '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=success';
const T06_ERROR_LOG =
  '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=error';
const TASK7_LOG_MARKER = 'DEV_0000040_T07_REST_DEFAULTS_APPLIED';

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

const toWebSocketUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/i, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/i, 'wss:');
  return value;
};

const isChatModel = (model: { type?: string; architecture?: string }) => {
  const kind = (model.type ?? '').toLowerCase();
  return kind !== 'embedding' && kind !== 'vector';
};

const sanitizeFlagsForProvider = (
  provider: ChatDefaultProvider,
  flags: Record<string, unknown> | undefined,
) => {
  const current = { ...(flags ?? {}) };
  if (provider !== 'codex') {
    delete current.threadId;
  }
  return current;
};

export function createChatRouter({
  clientFactory,
  codexFactory,
  toolFactory,
  chatFactory = getChatInterface,
  codexCapabilityResolver = resolveCodexCapabilities,
  cleanupInflightFn = cleanupInflight,
  releaseConversationLockFn = releaseConversationLock,
}: {
  clientFactory: ClientFactory;
  codexFactory?: CodexFactory;
  toolFactory?: ToolFactory;
  chatFactory?: typeof getChatInterface;
  codexCapabilityResolver?: (options: {
    consumer: 'chat_models' | 'chat_validation';
  }) => Promise<CodexCapabilityResolution>;
  cleanupInflightFn?: typeof cleanupInflight;
  releaseConversationLockFn?: typeof releaseConversationLock;
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
      validatedBody = await validateChatRequest(rawBody, {
        codexCapabilityResolver,
      });
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
      defaultsResolution,
    } = validatedBody;

    const now = new Date();
    const defaultsLogContext = {
      requestId,
      conversationId,
      provider,
      model,
      providerSource: defaultsResolution.providerSource,
      modelSource: defaultsResolution.modelSource,
      requestedProvider: defaultsResolution.requestedProvider,
      requestedModel: defaultsResolution.requestedModel,
      envProviderPresent:
        typeof process.env.CHAT_DEFAULT_PROVIDER === 'string' &&
        process.env.CHAT_DEFAULT_PROVIDER.trim().length > 0,
      envModelPresent:
        typeof process.env.CHAT_DEFAULT_MODEL === 'string' &&
        process.env.CHAT_DEFAULT_MODEL.trim().length > 0,
    };
    append({
      level: 'info',
      message: 'DEV-0000035:T1:defaults_resolution_evaluated',
      timestamp: now.toISOString(),
      source: 'server',
      requestId,
      context: defaultsLogContext,
    });
    baseLogger.info(
      defaultsLogContext,
      'DEV-0000035:T1:defaults_resolution_evaluated',
    );
    append({
      level: 'info',
      message: 'DEV-0000035:T1:defaults_resolution_result',
      timestamp: now.toISOString(),
      source: 'server',
      requestId,
      context: defaultsLogContext,
    });
    baseLogger.info(
      defaultsLogContext,
      'DEV-0000035:T1:defaults_resolution_result',
    );

    const requestedProvider = provider as ChatDefaultProvider;
    const requestedModel = model;
    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? '';
    const safeBase = scrubBaseUrl(baseUrl);

    const codexDetection = getCodexDetection();
    const codexCapabilities = await codexCapabilityResolver({
      consumer: 'chat_validation',
    });
    const codexState = {
      available: codexDetection.available,
      models: codexCapabilities.models.map((entry) => entry.model),
      reason: codexDetection.reason ?? 'codex unavailable',
    };

    let lmstudioModels: string[] = [];
    let lmstudioReason: string | undefined;
    let lmstudioAvailable = false;
    if (!BASE_URL_REGEX.test(baseUrl)) {
      lmstudioReason = 'lmstudio unavailable';
    } else {
      try {
        const client = clientFactory(toWebSocketUrl(baseUrl));
        const models = await client.system.listDownloadedModels();
        lmstudioModels = models
          .filter(isChatModel)
          .map((entry) => entry.modelKey)
          .filter((value) => typeof value === 'string' && value.trim().length);
        if (lmstudioModels.length > 0) {
          lmstudioAvailable = true;
        } else {
          lmstudioReason = 'lmstudio unavailable';
        }
      } catch {
        lmstudioReason = 'lmstudio unavailable';
      }
    }
    const runtimeSelection = resolveRuntimeProviderSelection({
      requestedProvider,
      requestedModel,
      codex: codexState,
      lmstudio: {
        available: lmstudioAvailable,
        models: lmstudioModels,
        reason: lmstudioReason,
      },
    });

    const executionProvider = runtimeSelection.executionProvider;
    const executionModel = runtimeSelection.executionModel;
    const effectiveCodexFlags = executionProvider === 'codex' ? codexFlags : {};
    console.info(TASK7_LOG_MARKER, {
      surface: '/chat',
      provider: executionProvider,
      warningCount: warnings.length,
      defaultsResolution,
    });
    let chatRuntimeConfig: CodexOptions['config'];

    if (executionProvider === 'codex') {
      try {
        const { config } = await resolveChatRuntimeConfig();
        chatRuntimeConfig = config as CodexOptions['config'];
        console.info(T06_SUCCESS_LOG, {
          surface: '/chat',
          provider: 'codex',
          hasModel: typeof config.model === 'string',
        });
      } catch (error) {
        const code =
          error instanceof RuntimeConfigResolutionError
            ? error.code
            : 'UNKNOWN_ERROR';
        console.error(`${T06_ERROR_LOG} surface=/chat code=${code}`);
        return res.status(500).json({
          status: 'error',
          code,
          message:
            error instanceof Error
              ? error.message
              : 'chat runtime config resolution failed',
        });
      }
    }

    const fallbackLogContext = {
      requestId,
      conversationId,
      requestedProvider: runtimeSelection.requestedProvider,
      requestedModel: runtimeSelection.requestedModel,
      executionProvider: runtimeSelection.executionProvider,
      executionModel: runtimeSelection.executionModel,
      fallbackApplied: runtimeSelection.fallbackApplied,
      decision: runtimeSelection.decision,
      requestedReason: runtimeSelection.requestedReason,
      fallbackReason: runtimeSelection.fallbackReason,
      lmstudioModelCount: lmstudioModels.length,
      baseUrl: safeBase,
    };
    append({
      level: 'info',
      message: 'DEV-0000035:T2:provider_fallback_evaluated',
      timestamp: now.toISOString(),
      source: 'server',
      requestId,
      context: fallbackLogContext,
    });
    baseLogger.info(
      fallbackLogContext,
      'DEV-0000035:T2:provider_fallback_evaluated',
    );
    append({
      level: 'info',
      message: 'DEV-0000035:T2:provider_fallback_result',
      timestamp: now.toISOString(),
      source: 'server',
      requestId,
      context: fallbackLogContext,
    });
    baseLogger.info(
      fallbackLogContext,
      'DEV-0000035:T2:provider_fallback_result',
    );

    const ensureConversation = async (): Promise<Conversation | null> => {
      if (shouldUseMemoryPersistence()) {
        const existing = memoryConversations.get(conversationId) ?? null;
        if (existing?.archivedAt) return null;

        if (!existing) {
          const created: Conversation = {
            _id: conversationId,
            provider: executionProvider,
            model: executionModel,
            title: message.trim().slice(0, 80) || 'Untitled conversation',
            source: 'REST',
            flags:
              executionProvider === 'codex' ? { ...effectiveCodexFlags } : {},
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
          provider: executionProvider,
          model: executionModel,
          flags:
            executionProvider === 'codex'
              ? { ...(existing.flags ?? {}), ...effectiveCodexFlags }
              : sanitizeFlagsForProvider('lmstudio', existing.flags),
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
          provider: executionProvider,
          model: executionModel,
          title: message.trim().slice(0, 80) || 'Untitled conversation',
          source: 'REST',
          flags:
            executionProvider === 'codex' ? { ...effectiveCodexFlags } : {},
          lastMessageAt: now,
        });
        const created = (await ConversationModel.findById(conversationId)
          .lean()
          .exec()) as Conversation | null;
        return created;
      }

      await updateConversationMeta({
        conversationId,
        provider: executionProvider,
        model: executionModel,
        flags:
          executionProvider === 'codex'
            ? { ...(existing.flags ?? {}), ...effectiveCodexFlags }
            : sanitizeFlagsForProvider('lmstudio', existing.flags),
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
        context: { provider: executionProvider, warning },
      });
      baseLogger.warn(
        { requestId, provider: executionProvider, warning },
        'chat flag ignored',
      );
    });

    if (runtimeSelection.unavailable) {
      const message =
        requestedProvider === 'codex'
          ? (codexState.reason ?? 'codex unavailable')
          : 'lmstudio unavailable';
      return res.status(503).json({
        status: 'error',
        code: 'PROVIDER_UNAVAILABLE',
        message,
      });
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

    const ownership = getActiveRunOwnership(conversationId);
    if (!ownership) {
      return res.status(500).json({
        status: 'error',
        code: 'RUN_STATE_UNAVAILABLE',
        message: 'Conversation run ownership could not be resolved.',
      });
    }
    const { runToken } = ownership;

    const inflightId =
      typeof requestedInflightId === 'string' && requestedInflightId.length > 0
        ? requestedInflightId
        : crypto.randomUUID();

    createInflight({
      conversationId,
      inflightId,
      provider: executionProvider,
      model: executionModel,
      source: 'REST',
      userTurn: { content: message, createdAt: now.toISOString() },
    });

    const consumePendingChatStop = () => {
      const boundPending = bindPendingConversationCancelToInflight({
        conversationId,
        runToken,
        inflightId,
      });
      if (!boundPending.ok) {
        return boundPending.reason !== 'PENDING_CANCEL_NOT_FOUND';
      }

      const pendingCancel = consumePendingConversationCancel({
        conversationId,
        runToken,
        inflightId,
      });
      if (!pendingCancel) return false;

      return abortInflight({ conversationId, inflightId }).ok;
    };

    consumePendingChatStop();

    publishUserTurn({
      conversationId,
      inflightId,
      content: message,
      createdAt: now.toISOString(),
    });

    let chat: ChatInterface;
    try {
      chat = chatFactory(executionProvider, {
        clientFactory,
        codexFactory,
        toolFactory,
      });
    } catch (err) {
      releaseConversationLockFn(conversationId, runToken);
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
      provider: executionProvider,
      model: executionModel,
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
        provider: executionProvider,
        model: executionModel,
        conversationId,
        inflightId,
      },
    });
    baseLogger.info(
      {
        requestId,
        provider: executionProvider,
        model: executionModel,
        conversationId,
        inflightId,
      },
      'chat.run.started',
    );

    // Respond immediately; execution continues in the background.
    res.status(202).json({
      status: 'started',
      conversationId,
      inflightId,
      provider: executionProvider,
      model: executionModel,
    });

    void (async () => {
      let runError: unknown;
      try {
        consumePendingChatStop();

        if (executionProvider === 'codex') {
          const activeThreadId =
            threadId ??
            (existingConversation.flags?.threadId as string | undefined) ??
            null;

          await chat.run(
            message,
            {
              provider: 'codex',
              threadId: activeThreadId,
              runtimeConfig: chatRuntimeConfig,
              codexFlags: effectiveCodexFlags,
              requestId,
              inflightId,
              deferInflightCleanup: true,
              signal: getInflight(conversationId)?.abortController.signal,
              source: 'REST',
            },
            conversationId,
            executionModel,
          );
          return;
        }

        const historyForRun = shouldUseMemoryPersistence()
          ? await loadTurnsChronological()
          : undefined;

        await chat.run(
          message,
          {
            provider: executionProvider,
            requestId,
            baseUrl,
            inflightId,
            deferInflightCleanup: true,
            signal: getInflight(conversationId)?.abortController.signal,
            history: historyForRun,
            source: 'REST',
          },
          conversationId,
          executionModel,
        );
      } catch (err) {
        runError = err;
        baseLogger.error(
          {
            requestId,
            provider: executionProvider,
            model: executionModel,
            conversationId,
            inflightId,
            err,
          },
          'chat run failed',
        );
      } finally {
        bridge.cleanup();
        const inflightState = getInflight(conversationId);
        const activeInflight =
          inflightState && inflightState.inflightId === inflightId
            ? inflightState
            : undefined;
        const cancelled = Boolean(
          activeInflight?.abortController.signal.aborted,
        );
        const errorMessage =
          runError instanceof Error ? runError.message : undefined;

        bridge.finalize({
          fallback: {
            status: cancelled ? 'stopped' : 'failed',
            threadId: null,
            ...(cancelled || !errorMessage
              ? {}
              : {
                  error: {
                    code: 'PROVIDER_ERROR',
                    message: errorMessage,
                  },
                }),
          },
        });

        try {
          if (activeInflight) {
            cleanupInflightFn({ conversationId, inflightId });
          }
        } catch (cleanupError) {
          baseLogger.error(
            {
              requestId,
              provider: executionProvider,
              model: executionModel,
              conversationId,
              inflightId,
              cleanupError,
            },
            'chat cleanup failed; falling back to direct runtime cleanup',
          );
          cleanupInflight({ conversationId, inflightId });
        } finally {
          cleanupPendingConversationCancel({
            conversationId,
            runToken,
            inflightId,
          });
          releaseConversationLockFn(conversationId, runToken);
        }
      }
    })();
  });

  return router;
}
