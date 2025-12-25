import type { LMStudioClient } from '@lmstudio/sdk';
import { Router, json } from 'express';

import {
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../agents/runLock.js';
import { UnsupportedProviderError, getChatInterface } from '../chat/factory.js';
import type { ChatInterface } from '../chat/interfaces/ChatInterface.js';
import type { CodexLike } from '../chat/interfaces/ChatInterfaceCodex.js';
import {
  getMemoryTurns,
  memoryConversations,
  recordMemoryTurn,
  shouldUseMemoryPersistence,
} from '../chat/memoryPersistence.js';
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
import { getWsHub } from '../ws/hub.js';
import { getInflightRegistry } from '../ws/inflightRegistry.js';
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
      inflightId,
      cancelOnDisconnect,
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
        ? getMemoryTurns(conversationId)
        : ((await TurnModel.find({ conversationId })
            .sort({ createdAt: 1, _id: 1 })
            .lean()
            .exec()) as Turn[]);

    const recordAssistantTurn = async () => {
      if (assistantTurnRecorded) return;
      assistantTurnRecorded = true;
      try {
        if (shouldUseMemoryPersistence()) {
          recordMemoryTurn({
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
    let transportClosed = false;

    const inflightRegistry = getInflightRegistry();
    const wsHub = getWsHub();
    let activeInflightId: string | undefined;
    let lockHeld = false;

    const endIfOpen = () => {
      if (ended || isStreamClosed(res)) return;
      transportClosed = true;
      ended = true;
      endStream(res);
    };

    const handleDisconnect = () => {
      if (transportClosed) return;
      transportClosed = true;
      if (!completed && cancelOnDisconnect && !controller.signal.aborted) {
        controller.abort();
        cancelled = true;
      }
      endIfOpen();
    };

    req.on('aborted', handleDisconnect);
    res.on('close', handleDisconnect);

    const existingConversation = await ensureConversation();
    if (!existingConversation) return;

    wsHub.emitConversationUpsert({
      conversationId,
      title: existingConversation.title,
      provider,
      model,
      source: (existingConversation.source ?? 'REST') as string,
      lastMessageAt: existingConversation.lastMessageAt ?? now,
      archived: existingConversation.archivedAt != null,
      ...(existingConversation.agentName
        ? { agentName: existingConversation.agentName }
        : {}),
    });

    const chronologicalTurns = await loadTurnsChronological();

    const startInflightOrConflict = () => {
      if (!lockHeld) {
        if (!tryAcquireConversationLock(conversationId)) {
          res.status(409).json({
            error: 'conflict',
            code: 'RUN_IN_PROGRESS',
            message: 'A run is already in progress for this conversation.',
          });
          return null;
        }
        lockHeld = true;
      }
      const started = inflightRegistry.createOrGetActive({
        conversationId,
        inflightId,
        cancelFn: () => controller.abort(),
      });
      if (started.conflict) {
        releaseConversationLock(conversationId);
        lockHeld = false;
        res.status(409).json({
          error: 'conflict',
          code: 'RUN_IN_PROGRESS',
          message: 'A run is already in progress for this conversation.',
        });
        return null;
      }
      activeInflightId = started.inflightId;
      const inflightSnapshot = inflightRegistry.getActive(conversationId);
      if (
        inflightSnapshot &&
        inflightSnapshot.inflightId === activeInflightId
      ) {
        wsHub.beginInflight({
          conversationId,
          inflightId: activeInflightId,
          startedAt: inflightSnapshot.startedAt,
          assistantText: inflightSnapshot.assistantText,
          analysisText: inflightSnapshot.analysisText,
          tools: inflightSnapshot.tools,
        });
      }
      return activeInflightId;
    };

    const releaseLockIfHeld = () => {
      if (!lockHeld) return;
      releaseConversationLock(conversationId);
      lockHeld = false;
    };

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

      if (!startInflightOrConflict()) return;

      const endIfOpen = () => {
        if (ended || isStreamClosed(res)) return;
        ended = true;
        endStream(res);
      };

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
      let wsFinalStatus: 'ok' | 'stopped' | 'failed' = 'ok';
      let activeThreadId =
        threadId ??
        (existingConversation.flags?.threadId as string | undefined) ??
        null;
      const toolCallsForTurn: Array<Record<string, unknown>> = [];

      chat.on('token', (ev) => {
        if (activeInflightId) {
          inflightRegistry.appendAssistantDelta(
            conversationId,
            activeInflightId,
            ev.content,
          );
          wsHub.assistantDelta({
            conversationId,
            inflightId: activeInflightId,
            delta: ev.content,
          });
        }
        if (!transportClosed) {
          writeEvent(res, { type: 'token', content: ev.content });
          assistantContent += ev.content;
        }
      });

      chat.on('analysis', (ev) => {
        if (activeInflightId) {
          inflightRegistry.appendAnalysisDelta(
            conversationId,
            activeInflightId,
            ev.content,
          );
          wsHub.analysisDelta({
            conversationId,
            inflightId: activeInflightId,
            delta: ev.content,
          });
        }
        if (!transportClosed) {
          writeEvent(res, { type: 'analysis', content: ev.content });
        }
      });

      chat.on('tool-request', (ev) => {
        const sseEvent = {
          type: 'tool-request',
          callId: ev.callId,
          name: ev.name,
          stage: ev.stage ?? 'started',
          parameters: ev.params,
        };
        if (activeInflightId) {
          inflightRegistry.updateToolState(conversationId, activeInflightId, {
            id: String(ev.callId),
            name: ev.name,
            status: 'requesting',
            stage: ev.stage ?? 'started',
            params: ev.params,
          });
          wsHub.toolEvent({
            conversationId,
            inflightId: activeInflightId,
            event: sseEvent,
          });
        }
        if (!transportClosed) {
          writeEvent(res, sseEvent);
        }
      });

      chat.on('tool-result', (ev) => {
        toolCallsForTurn.push({
          callId: ev.callId,
          name: ev.name,
          parameters: ev.params,
          result: ev.result,
          stage: ev.stage,
          error: ev.error ?? undefined,
        });
        const sseEvent = {
          type: 'tool-result',
          callId: ev.callId,
          name: ev.name,
          stage: ev.stage,
          parameters: ev.params,
          result: ev.result,
          errorTrimmed: ev.error ?? undefined,
        };
        if (activeInflightId) {
          const status = ev.error ? 'error' : 'done';
          inflightRegistry.updateToolState(conversationId, activeInflightId, {
            id: String(ev.callId),
            name: ev.name,
            status,
            stage: ev.stage,
            params: ev.params,
            result: ev.result,
            error: ev.error ?? undefined,
          });
          wsHub.toolEvent({
            conversationId,
            inflightId: activeInflightId,
            event: sseEvent,
          });
        }
        if (!transportClosed) {
          writeEvent(res, sseEvent);
        }
      });

      chat.on('final', (ev) => {
        assistantContent = ev.content;
        if (!transportClosed) {
          writeEvent(res, {
            type: 'final',
            message: { role: 'assistant', content: ev.content },
          });
        }
      });

      chat.on('thread', (ev) => {
        activeThreadId = ev.threadId;
        if (!transportClosed) {
          writeEvent(res, { type: 'thread', threadId: ev.threadId });
        }
      });

      chat.on('complete', (ev) => {
        completed = true;
        const tid = ev.threadId ?? activeThreadId;
        if (!transportClosed) {
          writeEvent(res, { type: 'complete', threadId: tid });
        }
        activeThreadId = tid ?? activeThreadId;
      });

      chat.on('error', (ev) => {
        assistantStatus = cancelled ? 'stopped' : 'failed';
        wsFinalStatus = cancelled ? 'stopped' : 'failed';
        if (!transportClosed) {
          writeEvent(res, { type: 'error', message: ev.message });
        }
      });

      try {
        await chat.run(
          message,
          {
            provider: 'codex',
            threadId: activeThreadId,
            codexFlags,
            requestId,
            signal: controller.signal,
            source: 'REST',
          },
          conversationId,
          model,
        );
        wsFinalStatus = cancelled ? 'stopped' : 'ok';
        if (!completed && !isStreamClosed(res) && !transportClosed) {
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
        wsFinalStatus = cancelled ? 'stopped' : 'failed';
        if (!transportClosed) {
          writeEvent(res, { type: 'error', message: messageText });
        }
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
        if (activeInflightId) {
          const finalized = inflightRegistry.finalize({
            conversationId,
            inflightId: activeInflightId,
            status: wsFinalStatus,
          });
          if (finalized) {
            wsHub.turnFinal({
              conversationId,
              inflightId: activeInflightId,
              status: wsFinalStatus,
            });
          }
        }
        if (cancelled && assistantContent === '') {
          assistantStatus = 'stopped';
        }
        // Codex class already persisted assistant turn; we still emit status bubble when stopped.
        if (assistantStatus === 'stopped' && !transportClosed) {
          writeEvent(res, {
            type: 'error',
            message: 'generation stopped',
          });
        }
        endIfOpen();
        releaseLockIfHeld();
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

    if (!startInflightOrConflict()) return;

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

    let wsFinalStatus: 'ok' | 'stopped' | 'failed' = 'ok';

    lmChat.on('token', (ev) => {
      if (activeInflightId) {
        inflightRegistry.appendAssistantDelta(
          conversationId,
          activeInflightId,
          ev.content,
        );
        wsHub.assistantDelta({
          conversationId,
          inflightId: activeInflightId,
          delta: ev.content,
        });
      }
      if (!transportClosed) {
        writeEvent(res, { type: 'token', content: ev.content });
        assistantContent += ev.content;
      }
    });

    lmChat.on('analysis', (ev) => {
      const content = (ev as { content?: string }).content ?? '';
      if (activeInflightId) {
        inflightRegistry.appendAnalysisDelta(
          conversationId,
          activeInflightId,
          content,
        );
        wsHub.analysisDelta({
          conversationId,
          inflightId: activeInflightId,
          delta: content,
        });
      }
      if (!transportClosed) {
        writeEvent(res, { type: 'analysis', content });
      }
    });

    lmChat.on('tool-request', (ev) => {
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
      const sseEvent = {
        type: 'tool-request',
        callId: callIdOut,
        name: nameOut,
        parameters: ev.params,
        stage: ev.stage ?? 'started',
      };
      if (activeInflightId) {
        inflightRegistry.updateToolState(conversationId, activeInflightId, {
          id: String(callIdOut),
          name: nameOut,
          status: 'requesting',
          stage: ev.stage ?? 'started',
          params: ev.params,
        });
        wsHub.toolEvent({
          conversationId,
          inflightId: activeInflightId,
          event: sseEvent,
        });
      }
      if (!transportClosed) {
        writeEvent(res, sseEvent);
      }
    });

    lmChat.on('tool-result', (ev) => {
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
      const sseEvent = {
        type: 'tool-result',
        callId: callIdOut,
        name: nameOut,
        stage: ev.stage,
        parameters: ev.params,
        result: ev.result,
        errorTrimmed: ev.error ?? undefined,
        errorFull: ev.error ?? undefined,
      };
      if (activeInflightId) {
        inflightRegistry.updateToolState(conversationId, activeInflightId, {
          id: String(callIdOut),
          name: nameOut,
          status: ev.error ? 'error' : 'done',
          stage: ev.stage,
          params: ev.params,
          result: ev.result,
          error: ev.error ?? undefined,
        });
        wsHub.toolEvent({
          conversationId,
          inflightId: activeInflightId,
          event: sseEvent,
        });
      }
      if (!transportClosed) {
        writeEvent(res, sseEvent);
      }
    });

    lmChat.on('final', (ev) => {
      assistantContent = ev.content;
      if (!transportClosed) {
        writeEvent(res, {
          type: 'final',
          message: { role: 'assistant', content: ev.content },
        });
      }
    });

    lmChat.on('complete', () => {
      completed = true;
      if (!transportClosed) {
        writeEvent(res, { type: 'complete' });
      }
    });

    lmChat.on('error', (ev) => {
      assistantStatus = cancelled ? 'stopped' : 'failed';
      wsFinalStatus = cancelled ? 'stopped' : 'failed';
      if (!transportClosed) {
        writeEvent(res, { type: 'error', message: ev.message });
      }
    });

    try {
      const historyForRun = shouldUseMemoryPersistence()
        ? chronologicalTurns
        : undefined;
      await lmChat.run(
        message,
        {
          provider,
          requestId,
          baseUrl,
          signal: controller.signal,
          history: historyForRun,
          source: 'REST',
        },
        conversationId,
        model,
      );
      wsFinalStatus = cancelled ? 'stopped' : 'ok';
      if (!completed && !isStreamClosed(res) && !transportClosed) {
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
      wsFinalStatus = cancelled ? 'stopped' : 'failed';
      if (!transportClosed) {
        writeEvent(res, { type: 'error', message: messageText });
      }
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
      if (activeInflightId) {
        const finalized = inflightRegistry.finalize({
          conversationId,
          inflightId: activeInflightId,
          status: wsFinalStatus,
        });
        if (finalized) {
          wsHub.turnFinal({
            conversationId,
            inflightId: activeInflightId,
            status: wsFinalStatus,
          });
        }
      }
      if (cancelled && assistantContent === '') {
        if (!transportClosed) {
          writeEvent(res, { type: 'error', message: 'generation stopped' });
        }
      }
      endIfOpen();
      releaseLockIfHeld();
    }
    await recordAssistantTurn();
    endIfOpen();
  });

  return router;
}
