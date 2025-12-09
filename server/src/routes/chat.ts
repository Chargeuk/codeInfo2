import { SYSTEM_CONTEXT } from '@codeinfo2/common';
import type { LLMActionOpts, LMStudioClient } from '@lmstudio/sdk';
import { Chat } from '@lmstudio/sdk';
import { Router, json } from 'express';
import mongoose from 'mongoose';
import { getChatInterface } from '../chat/factory.js';
import { ChatInterfaceCodex } from '../chat/interfaces/ChatInterfaceCodex.js';
import {
  endStream,
  isStreamClosed,
  startStream,
  writeEvent,
} from '../chatStream.js';
import { createLmStudioTools } from '../lmstudio/tools.js';
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
import { BASE_URL_REGEX, scrubBaseUrl, toWebSocketUrl } from './lmstudioUrl.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
type ToolFactory = typeof createLmStudioTools;
type CodexThreadLike = {
  id: string | null;
  runStreamed: (
    input: string,
    opts?: unknown,
  ) => Promise<{ events: AsyncGenerator<unknown> }>;
};
type CodexFactory = () => {
  startThread: (opts?: unknown) => CodexThreadLike;
  resumeThread: (id: string, opts?: unknown) => CodexThreadLike;
};

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

const isVectorPayload = (entry: unknown): boolean => {
  if (!entry || typeof entry !== 'object') return false;
  const obj = entry as Record<string, unknown>;
  const results = Array.isArray(obj.results) ? obj.results : [];
  const files = Array.isArray(obj.files) ? obj.files : [];
  const hasVectorLikeItem = (items: unknown[]) =>
    items.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const it = item as Record<string, unknown>;
      return (
        typeof it.hostPath === 'string' &&
        (typeof it.chunk === 'string' ||
          typeof it.score === 'number' ||
          typeof it.lineCount === 'number')
      );
    });
  return hasVectorLikeItem(results) || hasVectorLikeItem(files);
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
  toolFactory = createLmStudioTools,
  codexFactory,
}: {
  clientFactory: ClientFactory;
  toolFactory?: ToolFactory;
  codexFactory?: CodexFactory;
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

    const storedTurns = await loadTurnsChronological();
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

      startStream(res);

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

      const chat = codexFactory
        ? new ChatInterfaceCodex(codexFactory)
        : (getChatInterface('codex') as ChatInterfaceCodex);

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
        await (chat as ChatInterfaceCodex).run(
          message,
          {
            threadId: activeThreadId,
            codexFlags,
            requestId,
            signal: controller.signal,
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

    startStream(res);

    // Abort server-side streaming as soon as the client goes away so LM Studio stops work.
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
      // LM Studio SDK 1.5 does not expose abort on act; keep local flag to stop writes.
      cancelled = true;
    });

    const toolNames = new Map<number, string>();
    const toolArgs = new Map<number, string[]>();
    const toolRequestIdToCallId = new Map<string, number>();
    const toolCtx = new Map<
      number,
      {
        requestId?: string;
        roundIndex: number;
        name?: string;
        params?: unknown;
      }
    >();

    try {
      const client = clientFactory(toWebSocketUrl(baseUrl));
      const modelClient = await client.llm.model(model);
      let currentRound = 0;
      const emittedToolResults = new Set<string | number>();
      const syntheticToolResults = new Set<string | number>();
      const pendingSyntheticResults = new Map<
        string | number,
        { payload?: unknown; error?: unknown }
      >();
      const logToolUsage = (payload: Record<string, unknown>) => {
        append({
          level: 'info',
          message: 'chat tool usage',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            baseUrl: safeBase,
            model,
            ...payload,
          },
        });
        baseLogger.info(
          {
            requestId,
            baseUrl: safeBase,
            model,
            ...payload,
          },
          'chat tool usage',
        );
      };

      const { tools: lmStudioTools } = toolFactory({
        log: (payload) => logToolUsage(payload),
        onToolResult: (callId, result, error, ctx, meta) => {
          const numericId =
            typeof callId === 'string'
              ? Number(callId)
              : (callId ?? Number.NaN);
          if (!Number.isNaN(numericId) && !toolCtx.has(Number(numericId))) {
            toolCtx.set(Number(numericId), {
              requestId,
              roundIndex: currentRound,
              name: toolNames.get(Number(numericId)) ?? meta?.name,
              params:
                (ctx as { parameters?: unknown } | undefined)?.parameters ??
                undefined,
            });
          }
          emitSyntheticToolResult(callId, result, error);
        },
      });

      const tools = [...lmStudioTools];
      const chatHistory = [
        ...(SYSTEM_CONTEXT.trim()
          ? [{ role: 'system', content: SYSTEM_CONTEXT.trim() }]
          : []),
        ...storedTurns.map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
        { role: 'user', content: message },
      ];
      const chat = Chat.from(chatHistory as Parameters<typeof Chat.from>[0]);
      let finalCount = 0;
      const writeIfOpen = (payload: unknown) => {
        if (cancelled || isStreamClosed(res)) return;
        writeEvent(res, payload);
        if (
          payload &&
          typeof payload === 'object' &&
          (payload as { type?: unknown }).type === 'final'
        ) {
          finalCount += 1;
        }
      };
      const logToolEvent = (
        eventType: string,
        callId?: string | number,
        name?: string,
        roundIndex?: number,
      ) => {
        append({
          level: 'info',
          message: 'chat tool event',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            baseUrl: safeBase,
            model,
            type: eventType,
            callId,
            name,
            roundIndex,
          },
        });
        baseLogger.info(
          {
            requestId,
            baseUrl: safeBase,
            model,
            type: eventType,
            callId,
            name,
            roundIndex,
          },
          'chat tool event',
        );
      };

      const trimError = (
        err: unknown,
      ): { code?: string; message?: string } | null => {
        if (!err) return null;
        if (err instanceof Error) {
          const code = (err as { code?: unknown }).code;
          return {
            message: err.message,
            ...(typeof code === 'string' ? { code } : {}),
          };
        }
        if (typeof err === 'object') {
          const obj = err as Record<string, unknown>;
          const code = typeof obj.code === 'string' ? obj.code : undefined;
          const message =
            typeof obj.message === 'string'
              ? obj.message
              : obj.message === null
                ? null
                : undefined;
          return code || message
            ? { ...(code ? { code } : {}), message: message ?? undefined }
            : null;
        }
        return { message: String(err) };
      };

      const serializeError = (err: unknown): unknown => {
        if (!err) return null;
        if (err instanceof Error) {
          return {
            name: err.name,
            message: err.message,
            stack: err.stack,
            ...(typeof (err as { code?: unknown }).code === 'string'
              ? { code: (err as { code?: string }).code }
              : {}),
          };
        }
        if (typeof err === 'object') return err;
        return { message: String(err) };
      };

      const parseToolParameters = (callId: number, info?: unknown): unknown => {
        if (info && typeof info === 'object') {
          const obj = info as Record<string, unknown>;
          const fromInfo =
            obj.parameters ??
            obj.params ??
            obj.arguments ??
            obj.args ??
            undefined;
          if (fromInfo !== undefined) return fromInfo;
        }

        const fragments = toolArgs.get(callId);
        if (!fragments || fragments.length === 0) return undefined;
        const raw = fragments.join('');
        try {
          return JSON.parse(raw);
        } catch {
          return raw.trim() ? raw : undefined;
        }
      };

      const countLines = (text: unknown): number | null => {
        if (typeof text !== 'string') return null;
        if (!text.length) return 0;
        return text.split(/\r?\n/).length;
      };

      const aggregateVectorFiles = (results: unknown[]) => {
        const map = new Map<
          string,
          {
            hostPath: string;
            highestMatch: number | null;
            chunkCount: number;
            lineCount: number | null;
            hostPathWarning?: string;
            repo?: string;
            modelId?: string;
          }
        >();

        results.forEach((item) => {
          if (!item || typeof item !== 'object') return;
          const entry = item as Record<string, unknown>;
          const hostPath =
            typeof entry.hostPath === 'string' ? entry.hostPath : '';
          if (!hostPath) return;
          const score = typeof entry.score === 'number' ? entry.score : null;
          const lineCountValue =
            typeof entry.lineCount === 'number'
              ? entry.lineCount
              : countLines(entry.chunk);
          const hostPathWarning =
            typeof entry.hostPathWarning === 'string'
              ? entry.hostPathWarning
              : undefined;
          const repo = typeof entry.repo === 'string' ? entry.repo : undefined;
          const modelId =
            typeof entry.modelId === 'string' ? entry.modelId : undefined;

          const existing = map.get(hostPath);
          if (!existing) {
            map.set(hostPath, {
              hostPath,
              highestMatch: score,
              chunkCount: 1,
              lineCount: lineCountValue,
              hostPathWarning,
              repo,
              modelId,
            });
            return;
          }

          existing.chunkCount += 1;
          if (typeof score === 'number') {
            existing.highestMatch =
              existing.highestMatch === null
                ? score
                : Math.max(existing.highestMatch, score);
          }
          if (typeof lineCountValue === 'number') {
            if (typeof existing.lineCount === 'number') {
              existing.lineCount += lineCountValue;
            } else {
              existing.lineCount = lineCountValue;
            }
          }
          if (!existing.hostPathWarning && hostPathWarning) {
            existing.hostPathWarning = hostPathWarning;
          }
        });

        return Array.from(map.values()).sort((a, b) =>
          a.hostPath.localeCompare(b.hostPath),
        );
      };

      const emitToolResult = (
        roundIndex: number,
        callId: string | number,
        name: string | undefined,
        payload: unknown,
        info?: { stage?: string; error?: unknown; parameters?: unknown },
      ) => {
        if (emittedToolResults.has(callId)) return;
        emittedToolResults.add(callId);
        logToolEvent('toolCallResult', callId, name, roundIndex);
        baseLogger.info(
          {
            requestId,
            baseUrl: safeBase,
            model,
            callId,
            roundIndex,
            name,
            payloadKeys:
              payload && typeof payload === 'object'
                ? Object.keys(payload as Record<string, unknown>)
                : [],
            stage: info?.stage,
          },
          'chat tool result emit',
        );

        const parameters = parseToolParameters(
          typeof callId === 'number' ? callId : Number.NaN,
          info?.parameters ?? payload,
        );

        const formattedResult =
          name === 'VectorSearch' && payload && typeof payload === 'object'
            ? (() => {
                const obj = payload as Record<string, unknown>;
                const resultsArray = Array.isArray(obj.results)
                  ? obj.results
                  : [];
                const files = Array.isArray(obj.files)
                  ? obj.files
                  : aggregateVectorFiles(resultsArray);
                return { ...obj, files };
              })()
            : payload;

        const errorTrimmed = trimError(info?.error);
        const errorFull = serializeError(info?.error);

        writeIfOpen({
          type: 'tool-result',
          callId,
          roundIndex,
          name,
          stage: info?.stage ?? (info?.error ? 'error' : 'success'),
          parameters,
          result: formattedResult,
          errorTrimmed,
          errorFull,
        });
      };

      const emitSyntheticToolResult = (
        callId: number | string | undefined | null,
        payload: unknown,
        err?: unknown,
      ) => {
        if (callId === undefined || callId === null) return;
        const numericId = typeof callId === 'string' ? Number(callId) : callId;
        const stored = toolCtx.get(Number(numericId));
        if (!stored || stored.params === undefined) {
          pendingSyntheticResults.set(callId, { payload, error: err });
          return;
        }
        emitToolResult(
          stored.roundIndex,
          callId,
          stored.name,
          err ? null : payload,
          {
            parameters: stored.params,
            stage: err ? 'error' : 'success',
            error: err,
          },
        );
        syntheticToolResults.add(callId);
        pendingSyntheticResults.delete(callId);
      };

      const actOptions: LLMActionOpts & { signal?: AbortSignal } & Record<
          string,
          unknown
        > = {
        allowParallelToolExecution: false,
        // Extra field used by mocks; ignored by real SDK.
        signal: controller.signal,
        onRoundStart: (roundIndex: number) => {
          currentRound = roundIndex;
        },
        onPredictionFragment: (fragment: {
          content?: string;
          roundIndex?: number;
        }) => {
          if (typeof fragment.content === 'string') {
            assistantContent += fragment.content;
          }
          writeIfOpen({
            type: 'token',
            content: fragment.content,
            roundIndex: fragment.roundIndex ?? currentRound,
          });
        },
        onMessage: (message) => {
          try {
            baseLogger.debug(
              {
                requestId,
                baseUrl: safeBase,
                model,
                rawMessage: JSON.stringify(message),
              },
              'chat onMessage raw',
            );
          } catch {
            baseLogger.debug(
              { requestId, baseUrl: safeBase, model, rawMessage: message },
              'chat onMessage raw (non-serializable)',
            );
          }

          const role = getMessageRole(message);
          const items = getContentItems(message);

          const emitToolResultsFromItems = () => {
            const results = items.filter(
              (
                item,
              ): item is Extract<LMContentItem, { type: 'toolCallResult' }> =>
                item?.type === 'toolCallResult',
            );
            for (const entry of results) {
              let parsed: unknown = entry.content;
              try {
                parsed = JSON.parse(entry.content);
              } catch {
                parsed = entry.content;
              }
              const mappedCallId = toolRequestIdToCallId.get(entry.toolCallId);
              const callId =
                mappedCallId ?? entry.toolCallId ?? 'assistant-tool';
              const name =
                toolNames.get(Number(callId)) ??
                toolNames.get(mappedCallId ?? Number.NaN) ??
                undefined;
              if (syntheticToolResults.has(callId)) {
                emittedToolResults.delete(callId);
                syntheticToolResults.delete(callId);
              }
              emitToolResult(currentRound, callId, name, parsed, {
                parameters:
                  typeof callId === 'number'
                    ? parseToolParameters(callId, parsed)
                    : undefined,
              });
              toolCallsForTurn.push({
                callId,
                name,
                parameters:
                  typeof callId === 'number'
                    ? parseToolParameters(callId, parsed)
                    : undefined,
                result: parsed,
                stage: 'success',
              });
            }
          };

          if (role === 'tool') {
            // Some LM Studio responses send a single tool message object instead of
            // toolCallResult content items. Synthesize a tool-result in that case
            // so downstream consumers still see the payload.
            const rawContent = (message as { content?: unknown })?.content;
            if (!items.length && rawContent && typeof rawContent === 'object') {
              const obj = rawContent as {
                toolCallId?: unknown;
                tool_call_id?: unknown;
                id?: unknown;
                name?: unknown;
                result?: unknown;
                parameters?: unknown;
                error?: unknown;
                stage?: unknown;
              };
              const callId =
                (obj.toolCallId as number | string | undefined) ??
                (obj.tool_call_id as number | string | undefined) ??
                (obj.id as number | string | undefined) ??
                'assistant-tool';
              const nameCandidate = obj.name;
              const name =
                typeof nameCandidate === 'string'
                  ? nameCandidate
                  : (toolNames.get(Number(callId)) ?? 'VectorSearch');
              emitToolResult(currentRound, callId, name, obj.result, {
                parameters:
                  typeof obj.parameters === 'object'
                    ? obj.parameters
                    : parseToolParameters(Number(callId), obj.result),
                stage:
                  obj.stage && typeof obj.stage === 'string'
                    ? (obj.stage as string)
                    : obj.error
                      ? 'error'
                      : 'success',
                error: obj.error,
              });
            }
            emitToolResultsFromItems();
            writeIfOpen({
              type: 'final',
              message: { role: 'tool', content: '' },
              roundIndex: currentRound,
            });
            return;
          }

          if (role === 'assistant') {
            let text = items
              .filter((item) => item?.type === 'text')
              .map(
                (item) =>
                  (item as Extract<LMContentItem, { type: 'text' }>).text,
              )
              .join('');
            const rawDataContent = (
              message as unknown as { data?: { content?: unknown } }
            )?.data?.content;
            const contentString =
              rawDataContent === undefined &&
              typeof (message as { content?: unknown })?.content === 'string'
                ? ((message as { content?: string }).content ?? '')
                : undefined;
            if (!text && typeof contentString === 'string') {
              let parsed: unknown;
              try {
                parsed = JSON.parse(contentString);
              } catch {
                parsed = undefined;
              }
              if (parsed && isVectorPayload(parsed) && toolCtx.size > 0) {
                const inferredCallId =
                  Array.from(toolCtx.keys()).at(-1) ?? 'assistant-vector';
                const name =
                  toolNames.get(Number(inferredCallId)) ?? 'VectorSearch';
                if (!emittedToolResults.has(inferredCallId)) {
                  emitToolResult(currentRound, inferredCallId, name, parsed, {
                    parameters:
                      typeof inferredCallId === 'number'
                        ? parseToolParameters(inferredCallId, parsed)
                        : undefined,
                  });
                }
                return;
              }
            }
            if (
              !text &&
              rawDataContent === undefined &&
              typeof (message as { content?: unknown })?.content === 'string'
            ) {
              text = (message as { content?: string }).content ?? '';
            }
            emitToolResultsFromItems();

            writeIfOpen({
              type: 'final',
              message: { role: 'assistant', content: text },
              roundIndex: currentRound,
            });
            assistantContent = text;
            return;
          }

          if (role && typeof role === 'string') {
            let text = items
              .filter((item) => item?.type === 'text')
              .map(
                (item) =>
                  (item as Extract<LMContentItem, { type: 'text' }>).text,
              )
              .join('');
            const rawDataContent = (
              message as unknown as { data?: { content?: unknown } }
            )?.data?.content;
            if (
              !text &&
              rawDataContent === undefined &&
              typeof (message as { content?: unknown })?.content === 'string'
            ) {
              text = (message as { content?: string }).content ?? '';
            }
            writeIfOpen({
              type: 'final',
              message: { role, content: text },
              roundIndex: currentRound,
            });
          }
        },
        onToolCallRequestStart: (roundIndex: number, callId: number) => {
          logToolEvent('toolCallRequestStart', callId, undefined, roundIndex);
          writeIfOpen({
            type: 'tool-request',
            callId,
            roundIndex,
            stage: 'toolCallRequestStart',
          });
        },
        onToolCallRequestNameReceived: (
          roundIndex: number,
          callId: number,
          name: string,
        ) => {
          toolNames.set(callId, name);
          toolCtx.set(callId, {
            ...(toolCtx.get(callId) ?? {}),
            requestId,
            roundIndex,
            name,
          });
          logToolEvent('toolCallRequestNameReceived', callId, name, roundIndex);
          writeIfOpen({
            type: 'tool-request',
            callId,
            name,
            roundIndex,
            stage: 'toolCallRequestNameReceived',
          });
        },
        onToolCallRequestArgumentFragmentGenerated: (
          roundIndex: number,
          callId: number,
          content: string,
        ) => {
          logToolEvent(
            'toolCallRequestArgumentFragmentGenerated',
            callId,
            undefined,
            roundIndex,
          );
          baseLogger.debug(
            {
              requestId,
              baseUrl: safeBase,
              model,
              callId,
              roundIndex,
              content,
            },
            'chat tool arg fragment',
          );
          toolArgs.set(callId, [...(toolArgs.get(callId) ?? []), content]);
          writeIfOpen({
            type: 'tool-request',
            callId,
            roundIndex,
            stage: 'toolCallRequestArgumentFragmentGenerated',
            content,
          });
        },
        onToolCallRequestEnd: (
          roundIndex: number,
          callId: number,
          info?: unknown,
        ) => {
          logToolEvent('toolCallRequestEnd', callId, undefined, roundIndex);
          baseLogger.debug(
            {
              requestId,
              baseUrl: safeBase,
              model,
              callId,
              roundIndex,
              info,
            },
            'chat tool call end',
          );
          const toolCallRequestId = (
            info as { toolCallRequest?: { id?: string } } | undefined
          )?.toolCallRequest?.id;
          if (toolCallRequestId) {
            toolRequestIdToCallId.set(toolCallRequestId, callId);
          }
          toolCtx.set(callId, {
            ...(toolCtx.get(callId) ?? {}),
            requestId,
            roundIndex,
            params: parseToolParameters(callId, info),
          });
          if (pendingSyntheticResults.has(callId)) {
            const pending = pendingSyntheticResults.get(callId);
            emitSyntheticToolResult(callId, pending?.payload, pending?.error);
          }
          writeIfOpen({
            type: 'tool-request',
            callId,
            roundIndex,
            stage: 'toolCallRequestEnd',
            info,
          });
        },
        onToolCallRequestFailure: (
          roundIndex: number,
          callId: number,
          error: Error,
        ) => {
          logToolEvent('toolCallRequestFailure', callId, undefined, roundIndex);
          baseLogger.error(
            {
              requestId,
              baseUrl: safeBase,
              model,
              callId,
              roundIndex,
              error: error?.message,
              stack: (error as Error)?.stack,
            },
            'chat tool call failed',
          );
          logToolEvent('toolCallRequestFailure', callId, undefined, roundIndex);
          emitToolResult(roundIndex, callId, toolNames.get(callId), null, {
            stage: 'error',
            error,
          });
          toolCallsForTurn.push({
            callId,
            name: toolNames.get(callId),
            stage: 'error',
            error: trimError(error),
          });
        },
        onToolCallResult: (
          roundIndex: number,
          callId: number,
          info: unknown,
        ) => {
          baseLogger.info(
            {
              requestId,
              baseUrl: safeBase,
              model,
              callId,
              roundIndex,
              infoKeys:
                info && typeof info === 'object'
                  ? Object.keys(info as Record<string, unknown>)
                  : [],
            },
            'chat onToolCallResult fired',
          );
          const name =
            toolNames.get(callId) ??
            (info as { name?: string })?.name ??
            undefined;
          if (syntheticToolResults.has(callId)) {
            emittedToolResults.delete(callId);
            syntheticToolResults.delete(callId);
          }
          const payload =
            info && typeof info === 'object' && 'result' in (info as object)
              ? (info as { result?: unknown }).result
              : info;
          emitToolResult(roundIndex, callId, name, payload, {
            parameters: parseToolParameters(callId, info),
          });
          toolCallsForTurn.push({
            callId,
            name,
            parameters: parseToolParameters(callId, info),
            result: payload,
            stage: 'success',
          });
        },
      };

      const prediction = modelClient.act(
        chat,
        tools,
        actOptions as LLMActionOpts,
      );

      await prediction;

      if (cancelled || req.aborted) {
        assistantStatus = 'stopped';
      }
      if (finalCount === 0) {
        writeIfOpen({
          type: 'final',
          message: { role: 'assistant', content: '' },
          roundIndex: currentRound,
        });
      }
      completed = true;
      writeEvent(res, { type: 'complete' });
      toolCtx.clear();
      toolArgs.clear();
      toolRequestIdToCallId.clear();

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
    } catch (err) {
      const message =
        (err as Error | undefined)?.message ?? 'lmstudio unavailable';
      writeEvent(res, { type: 'error', message });
      assistantStatus = cancelled ? 'stopped' : 'failed';
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
          error: message,
        },
      });
      baseLogger.error(
        {
          requestId,
          baseUrl: safeBase,
          model,
          provider,
          conversationId,
          error: message,
        },
        'chat stream failed',
      );
    } finally {
      toolCtx.clear();
      toolArgs.clear();
      toolRequestIdToCallId.clear();
      await recordAssistantTurn();
      endIfOpen();
    }
  });

  return router;
}
