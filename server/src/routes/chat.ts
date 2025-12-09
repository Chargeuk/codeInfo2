import { SYSTEM_CONTEXT } from '@codeinfo2/common';
import type { LLMActionOpts, LMStudioClient } from '@lmstudio/sdk';
import { Chat } from '@lmstudio/sdk';
import { Codex } from '@openai/codex-sdk';
import type {
  ThreadEvent as CodexThreadEvent,
  ThreadOptions as CodexThreadOptions,
  TurnOptions as CodexTurnOptions,
} from '@openai/codex-sdk';
import { Router, json } from 'express';
import mongoose from 'mongoose';
import {
  endStream,
  isStreamClosed,
  startStream,
  writeEvent,
} from '../chatStream.js';
import { buildCodexOptions } from '../config/codexConfig.js';
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

type CodexThread = {
  id: string | null;
  runStreamed: (
    input: string,
    opts?: CodexTurnOptions,
  ) => Promise<{ events: AsyncGenerator<CodexThreadEvent> }>;
};

type CodexFactory = () => {
  startThread: (opts?: CodexThreadOptions) => CodexThread;
  resumeThread: (id: string, opts?: CodexThreadOptions) => CodexThread;
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
  codexFactory = () => new Codex(buildCodexOptions()),
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

      try {
        const codex = codexFactory();
        const codexWorkingDirectory =
          process.env.CODEX_WORKDIR ??
          process.env.CODEINFO_CODEX_WORKDIR ??
          '/data';
        const conversationThreadId =
          threadId ??
          (existingConversation.flags?.threadId as string | undefined) ??
          null;
        const codexThreadOptions: CodexThreadOptions = {
          model,
          workingDirectory: codexWorkingDirectory,
          skipGitRepoCheck: true,
          sandboxMode: codexFlags?.sandboxMode ?? 'workspace-write',
          networkAccessEnabled: codexFlags?.networkAccessEnabled ?? true,
          webSearchEnabled: codexFlags?.webSearchEnabled ?? true,
          approvalPolicy: codexFlags?.approvalPolicy ?? 'on-failure',
          modelReasoningEffort: codexFlags?.modelReasoningEffort ?? 'high',
        };

        const thread =
          typeof conversationThreadId === 'string' &&
          conversationThreadId.length > 0
            ? codex.resumeThread(conversationThreadId, codexThreadOptions)
            : codex.startThread(codexThreadOptions);

        let activeThreadId = thread.id ?? conversationThreadId ?? null;
        let finalText = '';
        let reasoningText = '';
        const priorTurns = storedTurns.map((turn) => ({
          role: turn.role,
          content: turn.content,
        }));
        const promptHistory = [
          ...priorTurns,
          { role: 'user', content: message },
        ];

        const systemContext = SYSTEM_CONTEXT.trim();
        const userText = promptHistory
          .filter((entry) => entry.role === 'user')
          .map((entry) => entry.content)
          .join('\n\n');

        const prompt =
          !conversationThreadId && systemContext
            ? `Context:\n${systemContext}\n\nUser:\n${userText}`
            : userText;

        const { events } = await thread.runStreamed(prompt, {
          signal: controller.signal,
        } as CodexTurnOptions);

        const emitThreadId = (incoming?: string | null) => {
          if (!incoming || activeThreadId === incoming) return;
          activeThreadId = incoming;
          writeEvent(res, { type: 'thread', threadId: incoming });
          if (shouldUseMemoryPersistence()) {
            const existing = memoryConversations.get(conversationId);
            if (existing) {
              memoryConversations.set(conversationId, {
                ...existing,
                flags: { ...(existing.flags ?? {}), threadId: incoming },
                updatedAt: new Date(),
              });
            }
            return;
          }
          updateConversationMeta({
            conversationId,
            flags: {
              ...(existingConversation.flags ?? {}),
              threadId: incoming,
            },
          }).catch((err) =>
            baseLogger.error(
              { requestId, provider, model, err },
              'failed to persist codex thread id',
            ),
          );
        };

        emitThreadId(activeThreadId);

        type CodexToolCallItem = {
          type?: string;
          id?: string;
          name?: string;
          arguments?: unknown;
          status?: string;
          result?: { content?: unknown; error?: unknown };
        };

        const codexToolCtx = new Map<
          string,
          { name?: string; parameters?: unknown }
        >();

        const parseCodexToolParameters = (item: CodexToolCallItem): unknown => {
          const raw =
            (item as { arguments?: unknown; args?: unknown }).arguments ??
            (item as { args?: unknown }).args;
          if (raw === undefined) return undefined;
          if (typeof raw === 'string') {
            try {
              return JSON.parse(raw);
            } catch {
              return raw;
            }
          }
          return raw;
        };

        const pickContent = (content?: unknown): unknown | null => {
          if (!Array.isArray(content)) return null;
          const jsonEntry = content.find(
            (entry) =>
              entry &&
              typeof entry === 'object' &&
              (entry as { type?: string }).type === 'application/json' &&
              'json' in (entry as Record<string, unknown>),
          ) as { json?: unknown } | undefined;
          if (jsonEntry && 'json' in jsonEntry) {
            return jsonEntry.json as unknown;
          }

          const textEntry = content.find(
            (entry) =>
              entry &&
              typeof entry === 'object' &&
              (entry as { type?: string }).type === 'text' &&
              typeof (entry as { text?: unknown }).text === 'string',
          ) as { text?: string } | undefined;

          if (textEntry?.text) {
            try {
              return JSON.parse(textEntry.text);
            } catch {
              return textEntry.text;
            }
          }

          return null;
        };

        const parseCodexToolResult = (item: CodexToolCallItem): unknown => {
          const content = (item.result as { content?: unknown } | undefined)
            ?.content;
          const picked = pickContent(content);
          if (picked !== null) return picked;
          if ((item.result as { error?: unknown } | undefined)?.error) {
            return { error: (item.result as { error?: unknown }).error };
          }
          return item.result ?? null;
        };

        const trimCodexError = (
          err: unknown,
        ): { code?: string; message: string } | null => {
          if (!err) return null;
          if (typeof err === 'object') {
            const obj = err as Record<string, unknown>;
            const message =
              typeof obj.message === 'string' ? obj.message : String(err);
            const code = typeof obj.code === 'string' ? obj.code : undefined;
            return { code, message };
          }
          return { message: String(err) };
        };

        const deriveCodexToolName = (
          item: CodexToolCallItem,
        ): string | undefined => {
          const args = (item as { arguments?: Record<string, unknown> })
            .arguments;
          const argTool =
            args && typeof args === 'object' && typeof args.tool === 'string'
              ? args.tool
              : undefined;
          return (
            item.name ||
            (item as { tool_name?: string }).tool_name ||
            (item as { tool?: string }).tool ||
            argTool ||
            undefined
          );
        };

        const emitCodexToolRequest = (item: CodexToolCallItem) => {
          if (item.type !== 'mcp_tool_call') return;
          const callId = item.id ?? `codex-tool-${Date.now()}`;
          const name = deriveCodexToolName(item);
          const parameters = parseCodexToolParameters(item);
          codexToolCtx.set(String(callId), {
            name,
            parameters,
          });
          baseLogger.info(
            {
              requestId,
              provider,
              model,
              callId,
              itemKeys: Object.keys(item ?? {}),
              toolName: name ?? null,
              item,
            },
            'codex tool call observed',
          );
          writeEvent(res, {
            type: 'tool-request',
            callId,
            name,
            stage: 'started',
            parameters,
          });
        };

        const emitCodexToolResult = (item: CodexToolCallItem) => {
          if (item.type !== 'mcp_tool_call') return;
          const callId = item.id ?? 'codex-tool';
          const stored = codexToolCtx.get(String(callId));
          const parameters =
            stored?.parameters ?? parseCodexToolParameters(item);
          const name = stored?.name ?? deriveCodexToolName(item);
          const payload = parseCodexToolResult(item);
          const error = (item.result as { error?: unknown } | undefined)?.error;
          const errorTrimmed = trimCodexError(error);

          toolCallsForTurn.push({
            callId,
            name,
            parameters,
            result: payload,
            stage: error ? 'error' : 'success',
            error: errorTrimmed ?? undefined,
          });

          writeEvent(res, {
            type: 'tool-result',
            callId,
            name,
            stage: error ? 'error' : 'success',
            parameters,
            result: payload,
            errorTrimmed: errorTrimmed ?? undefined,
            errorFull: error ?? undefined,
          });
        };

        for await (const event of events) {
          if (cancelled || isStreamClosed(res)) break;
          baseLogger.info(
            {
              requestId,
              provider,
              model,
              eventType: event.type,
              itemType:
                (event as { item?: { type?: unknown } })?.item?.type ?? null,
              itemKeys: Object.keys(
                ((event as { item?: Record<string, unknown> }).item ??
                  {}) as Record<string, unknown>,
              ),
            },
            'codex event',
          );
          switch (event.type) {
            case 'thread.started': {
              emitThreadId(event.thread_id);
              break;
            }
            case 'item.started': {
              const item = (event as { item?: unknown })?.item as
                | CodexToolCallItem
                | undefined;
              if (item?.type === 'mcp_tool_call') {
                emitCodexToolRequest(item);
              }
              break;
            }
            case 'item.updated':
            case 'item.completed': {
              const item = (event as { item?: unknown })?.item as
                | CodexToolCallItem
                | { type?: string; text?: string }
                | undefined;

              if (item?.type === 'reasoning') {
                const text = (item as { text?: string }).text ?? '';
                const delta = text.slice(reasoningText.length);
                if (delta) {
                  // Codex reasoning feeds the client analysis stream (parity with LM Studio).
                  writeEvent(res, { type: 'analysis', content: delta });
                  reasoningText = text;
                }
                break;
              }

              if (item?.type === 'mcp_tool_call') {
                if (event.type === 'item.completed') {
                  emitCodexToolResult(item);
                }
                break;
              }

              if (!item || item.type !== 'agent_message') break;
              const text = (item as { text?: string }).text ?? '';
              const delta = text.slice(finalText.length);
              if (delta) {
                writeEvent(res, { type: 'token', content: delta });
                assistantContent += delta;
              }
              finalText = text;
              if (event.type === 'item.completed') {
                writeEvent(res, {
                  type: 'final',
                  message: { role: 'assistant', content: finalText },
                });
              }
              break;
            }
            case 'turn.failed': {
              const message = (event as { error?: { message?: string } })?.error
                ?.message;
              writeEvent(res, {
                type: 'error',
                message: message ?? 'codex turn failed',
              });
              break;
            }
            case 'error': {
              writeEvent(res, {
                type: 'error',
                message: (event as { message?: string })?.message,
              });
              break;
            }
            case 'turn.completed': {
              emitThreadId(activeThreadId);
              break;
            }
            default:
              break;
          }
        }

        if (!isStreamClosed(res)) {
          if (finalText.length === 0) {
            writeEvent(res, {
              type: 'final',
              message: { role: 'assistant', content: '' },
            });
          }
          completed = true;
          writeEvent(res, { type: 'complete', threadId: activeThreadId });
          assistantContent = finalText;
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
        const message =
          (err as Error | undefined)?.message ?? 'codex unavailable';
        writeEvent(res, { type: 'error', message });
        assistantStatus = cancelled ? 'stopped' : 'failed';
        append({
          level: 'error',
          message: 'chat stream failed',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: { provider, model, conversationId, error: message },
        });
        baseLogger.error(
          { requestId, provider, model, conversationId, error: message },
          'chat stream failed',
        );
      } finally {
        if (cancelled && assistantContent === '') {
          assistantStatus = 'stopped';
        }
        await recordAssistantTurn();
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
