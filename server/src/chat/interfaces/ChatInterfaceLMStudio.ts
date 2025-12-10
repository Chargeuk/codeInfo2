import { SYSTEM_CONTEXT } from '@codeinfo2/common';
import {
  Chat,
  type ChatMessage,
  type LLMActionOpts,
  type LMStudioClient,
} from '@lmstudio/sdk';
import { createLmStudioTools } from '../../lmstudio/tools.js';
import { append } from '../../logStore.js';
import { baseLogger } from '../../logger.js';
import { toWebSocketUrl } from '../../routes/lmstudioUrl.js';
import { shouldUseMemoryPersistence } from '../memoryPersistence.js';
import {
  ChatInterface,
  type ChatCompleteEvent,
  type ChatErrorEvent,
  type ChatEvent,
  type ChatFinalEvent,
  type ChatTokenEvent,
  type ChatToolRequestEvent,
  type ChatToolResultEvent,
} from './ChatInterface.js';

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

const countLines = (text: unknown): number | null => {
  if (typeof text !== 'string') return null;
  return text.split(/\n/).length;
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
  role?: string;
  content?: unknown;
};

const getMessageRole = (message: unknown): string | undefined => {
  const msg = message as LMMessage;
  return msg.data?.role ?? msg.role;
};

const getContentItems = (message: unknown): LMContentItem[] => {
  const msg = message as LMMessage;
  const items = msg.data?.content;
  return Array.isArray(items) ? (items as LMContentItem[]) : [];
};

type LmStudioRunFlags = {
  requestId?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  history?: Array<{ role?: string; content?: unknown }>;
  skipPersistence?: boolean;
  source?: 'REST' | 'MCP';
};

export class ChatInterfaceLMStudio extends ChatInterface {
  constructor(
    private readonly clientFactory: (baseUrl: string) => LMStudioClient,
    private readonly toolFactory: (opts: Record<string, unknown>) => {
      tools: ReadonlyArray<unknown>;
    } = createLmStudioTools,
  ) {
    super();
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void> {
    const { requestId, baseUrl, signal } = (flags ?? {}) as LmStudioRunFlags;
    const history = Array.isArray((flags as LmStudioRunFlags)?.history)
      ? (flags as LmStudioRunFlags).history
      : undefined;
    const safeBase = baseUrl ?? process.env.LMSTUDIO_BASE_URL ?? '';
    const wsBase = toWebSocketUrl(safeBase);

    const storedTurns =
      history?.map((turn) => ({
        role: (turn as { role?: string }).role ?? 'assistant',
        content: (turn as { content?: unknown }).content ?? '',
      })) ??
      (shouldUseMemoryPersistence()
        ? []
        : await this.loadHistory(conversationId));

    const controller = new AbortController();
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    const emitIfNotCancelled = (event: ChatEvent) => {
      if (controller.signal.aborted) return;
      this.emitEvent(event);
    };

    const toolNames = new Map<string, string>();
    const toolCtx = new Map<
      string,
      { params?: unknown; name?: string; roundIndex?: number }
    >();
    const toolArgs = new Map<string, string[]>();
    const toolRequestIdToCallId = new Map<string, string>();
    const emittedToolResults = new Set<string>();
    const syntheticToolResults = new Set<string>();
    const pendingSyntheticResults = new Map<
      string,
      { payload?: unknown; error?: unknown }
    >();

    const toCallId = (value: string | number | undefined | null) =>
      String(value ?? 'assistant-tool');

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
        { requestId, baseUrl: safeBase, model, ...payload },
        'chat tool usage',
      );
    };

    const { tools: lmStudioTools } = this.toolFactory({
      log: (payload: Record<string, unknown>) => logToolUsage(payload),
      onToolResult: (
        callId: unknown,
        result: unknown,
        error: unknown,
        ctx: unknown,
        meta?: { name?: string },
      ) => {
        const id = toCallId(callId as string | number | undefined | null);
        if (!toolCtx.has(id)) {
          toolCtx.set(id, {
            roundIndex: 0,
            name: toolNames.get(id) ?? meta?.name,
            params: (ctx as { parameters?: unknown } | undefined)?.parameters,
          });
        }
        emitSyntheticToolResult(id, result, error);
      },
    });

    const newestTurnStart = storedTurns.at(0);
    const newestTurnEnd = storedTurns.at(-1);
    const hasCurrentUser =
      (newestTurnStart?.role === 'user' &&
        newestTurnStart.content === message) ||
      (newestTurnEnd?.role === 'user' && newestTurnEnd.content === message);

    const chatHistory = [
      ...(SYSTEM_CONTEXT.trim()
        ? [{ role: 'system', content: SYSTEM_CONTEXT.trim() }]
        : []),
      ...storedTurns.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      ...(hasCurrentUser ? [] : [{ role: 'user', content: message }]),
    ];
    const chat = Chat.from(chatHistory as Parameters<typeof Chat.from>[0]);

    const parseToolParameters = (callId: string, info?: unknown): unknown => {
      if (info && typeof info === 'object') {
        const obj = info as Record<string, unknown>;
        const fromInfo =
          obj.parameters ??
          obj.params ??
          obj.arguments ??
          obj.args ??
          (Array.isArray(obj.content)
            ? obj.content.find(
                (entry) =>
                  entry &&
                  typeof entry === 'object' &&
                  'text' in (entry as object),
              )
            : undefined);
        if (fromInfo !== undefined) return fromInfo;
      }
      const aggregated = toolArgs.get(callId)?.join('');
      if (aggregated) {
        try {
          return JSON.parse(aggregated);
        } catch {
          return aggregated;
        }
      }
      return undefined;
    };

    const aggregateVectorFiles = (
      items: unknown[],
    ): Array<{
      hostPath: string;
      highestMatch: number | null;
      chunkCount: number;
      lineCount: number | null;
      hostPathWarning?: string;
      repo?: string;
      modelId?: string;
    }> => {
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

      items.forEach((item) => {
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

    const formatVectorResult = (payload: Record<string, unknown>): unknown => {
      const resultsArray = Array.isArray(payload.results)
        ? payload.results
        : [];
      const files = Array.isArray(payload.files)
        ? payload.files
        : aggregateVectorFiles(resultsArray);
      return { ...payload, files };
    };

    const trimError = (
      err: unknown,
    ): { code?: string; message: string } | null | undefined => {
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
              ? ''
              : String(obj.message ?? '');
        return { ...(code ? { code } : {}), message };
      }
      return { message: String(err) };
    };

    const writeToolResult = (
      callId: string,
      name: string | undefined,
      payload: unknown,
      info?: {
        stage?: 'success' | 'error';
        error?: unknown;
        parameters?: unknown;
      },
    ) => {
      if (emittedToolResults.has(callId)) return;
      emittedToolResults.add(callId);
      const safeName = name && name.length > 0 ? name : 'VectorSearch';
      const parameters = parseToolParameters(
        callId,
        info?.parameters ?? payload,
      );
      const formattedResult =
        safeName === 'VectorSearch' && payload && typeof payload === 'object'
          ? formatVectorResult(payload as Record<string, unknown>)
          : payload;
      const errorTrimmed = trimError(info?.error ?? undefined);
      const event: ChatToolResultEvent = {
        type: 'tool-result',
        callId,
        name: safeName,
        params: parameters,
        result: formattedResult,
        stage: info?.stage ?? (info?.error ? 'error' : 'success'),
        error: errorTrimmed ?? undefined,
      };
      emitIfNotCancelled(event);
    };

    const emitSyntheticToolResult = (
      callId: string,
      payload: unknown,
      err?: unknown,
    ) => {
      const stored = toolCtx.get(callId);
      if (!stored || stored.params === undefined) {
        pendingSyntheticResults.set(callId, { payload, error: err });
        return;
      }
      writeToolResult(callId, stored.name, err ? null : payload, {
        parameters: stored.params,
        stage: err ? 'error' : 'success',
        error: err,
      });
      syntheticToolResults.add(callId);
      pendingSyntheticResults.delete(callId);
    };

    try {
      const client = this.clientFactory(wsBase);
      const modelClient = await client.llm.model(model);

      const actOptions: LLMActionOpts & { signal?: AbortSignal } & Record<
          string,
          unknown
        > = {
        allowParallelToolExecution: false,
        signal: controller.signal,
        onPredictionFragment: (fragment: {
          content?: string;
          roundIndex?: number;
        }) => {
          const tokenEvent: ChatTokenEvent = {
            type: 'token',
            content: fragment.content ?? '',
          };
          emitIfNotCancelled(tokenEvent);
        },
        onMessage: (message: ChatMessage) => {
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
              const callId = toCallId(mappedCallId ?? entry.toolCallId);
              const name =
                toolNames.get(callId) ??
                (mappedCallId ? toolNames.get(mappedCallId) : undefined);
              if (syntheticToolResults.has(callId)) {
                emittedToolResults.delete(callId);
                syntheticToolResults.delete(callId);
              }
              writeToolResult(callId, name, parsed, {
                parameters: parseToolParameters(callId, parsed),
              });
            }
          };

          if (role === 'tool') {
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
              const callId = toCallId(
                (obj.toolCallId as string | number | undefined) ??
                  (obj.tool_call_id as string | number | undefined) ??
                  (obj.id as string | number | undefined),
              );
              const nameCandidate = obj.name;
              const name =
                typeof nameCandidate === 'string'
                  ? nameCandidate
                  : (toolNames.get(callId) ?? 'VectorSearch');
              writeToolResult(callId, name, obj.result, {
                parameters:
                  typeof obj.parameters === 'object'
                    ? obj.parameters
                    : parseToolParameters(callId, obj.result),
                stage:
                  obj.stage && typeof obj.stage === 'string'
                    ? (obj.stage as 'success' | 'error')
                    : obj.error
                      ? 'error'
                      : 'success',
                error: obj.error,
              });
            }
            emitToolResultsFromItems();
            const finalEvent: ChatFinalEvent = { type: 'final', content: '' };
            emitIfNotCancelled(finalEvent);
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
              message as unknown as {
                data?: { content?: unknown };
              }
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
                const name = toolNames.get(inferredCallId) ?? 'VectorSearch';
                if (!emittedToolResults.has(inferredCallId)) {
                  writeToolResult(inferredCallId, name, parsed, {
                    parameters: parseToolParameters(inferredCallId, parsed),
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
            const finalEvent: ChatFinalEvent = { type: 'final', content: text };
            emitIfNotCancelled(finalEvent);
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
              message as unknown as {
                data?: { content?: unknown };
              }
            )?.data?.content;
            if (
              !text &&
              rawDataContent === undefined &&
              typeof (message as { content?: unknown })?.content === 'string'
            ) {
              text = (message as { content?: string }).content ?? '';
            }
            const finalEvent: ChatFinalEvent = { type: 'final', content: text };
            emitIfNotCancelled(finalEvent);
          }
        },
        onToolCallRequestStart: (_roundIndex: number, callId: number) => {
          const id = toCallId(callId);
          toolArgs.set(id, []);
          toolCtx.set(id, { roundIndex: _roundIndex });
          const ev: ChatToolRequestEvent = {
            type: 'tool-request',
            callId: id,
            params: undefined,
            name: '',
            stage: 'started',
          };
          emitIfNotCancelled(ev);
        },
        onToolCallRequestNameReceived: (
          _roundIndex: number,
          callId: number,
          name: string,
        ) => {
          const id = toCallId(callId);
          toolNames.set(id, name);
          toolCtx.set(id, {
            ...(toolCtx.get(id) ?? {}),
            roundIndex: _roundIndex,
            name,
          });
          const ev: ChatToolRequestEvent = {
            type: 'tool-request',
            callId: id,
            name: name ?? '',
            params: undefined,
            stage: 'started',
          };
          emitIfNotCancelled(ev);
        },
        onToolCallRequestArgumentFragmentGenerated: (
          _roundIndex: number,
          callId: number,
          content: string,
        ) => {
          const id = toCallId(callId);
          toolArgs.set(id, [...(toolArgs.get(id) ?? []), content]);
          const ev: ChatToolRequestEvent = {
            type: 'tool-request',
            callId: id,
            name: toolNames.get(id) ?? '',
            params: undefined,
            stage: 'started',
          };
          emitIfNotCancelled(ev);
        },
        onToolCallRequestEnd: (
          _roundIndex: number,
          callId: number,
          info?: unknown,
        ) => {
          const id = toCallId(callId);
          const toolCallRequestId = (
            info as { toolCallRequest?: { id?: string } } | undefined
          )?.toolCallRequest?.id;
          if (toolCallRequestId) {
            toolRequestIdToCallId.set(toolCallRequestId, id);
          }
          const params = parseToolParameters(id, info);
          toolCtx.set(id, {
            ...(toolCtx.get(id) ?? {}),
            roundIndex: _roundIndex,
            params,
          });
          if (pendingSyntheticResults.has(id)) {
            const pending = pendingSyntheticResults.get(id);
            if (pending)
              emitSyntheticToolResult(id, pending.payload, pending.error);
          }
          const ev: ChatToolRequestEvent = {
            type: 'tool-request',
            callId: id,
            name: toolNames.get(id) ?? '',
            params,
            stage: 'started',
          };
          emitIfNotCancelled(ev);
        },
        onToolCallRequestFailure: (
          _roundIndex: number,
          callId: number,
          error: Error,
        ) => {
          const id = toCallId(callId);
          writeToolResult(id, toolNames.get(id), null, {
            stage: 'error',
            error,
          });
        },
        onToolCallResult: (
          _roundIndex: number,
          callId: number,
          info: unknown,
        ) => {
          const id = toCallId(callId);
          const name =
            toolNames.get(id) ?? (info as { name?: string })?.name ?? undefined;
          if (syntheticToolResults.has(id)) {
            emittedToolResults.delete(id);
            syntheticToolResults.delete(id);
          }
          const payload =
            info && typeof info === 'object' && 'result' in (info as object)
              ? (info as { result?: unknown }).result
              : info;
          writeToolResult(id, name, payload, {
            parameters: parseToolParameters(id, info),
          });
        },
      };

      const prediction = modelClient.act(
        chat,
        [...(lmStudioTools as readonly unknown[])] as Parameters<
          typeof modelClient.act
        >[1],
        actOptions as LLMActionOpts,
      );

      await prediction;

      const completeEvent: ChatCompleteEvent = { type: 'complete' };
      emitIfNotCancelled(completeEvent);
      toolCtx.clear();
      toolArgs.clear();
      toolRequestIdToCallId.clear();
    } catch (err) {
      const messageText =
        (err as Error | undefined)?.message ?? 'lmstudio unavailable';
      const errorEvent: ChatErrorEvent = {
        type: 'error',
        message: messageText,
      };
      emitIfNotCancelled(errorEvent);
    } finally {
      toolCtx.clear();
      toolArgs.clear();
      toolRequestIdToCallId.clear();
      // persistence handled by ChatInterface base
    }
  }
}
