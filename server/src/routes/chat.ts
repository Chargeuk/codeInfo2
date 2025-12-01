import type { LLMActionOpts, LMStudioClient } from '@lmstudio/sdk';
import { Chat } from '@lmstudio/sdk';
import { Router, json } from 'express';
import {
  endStream,
  isStreamClosed,
  startStream,
  writeEvent,
} from '../chatStream.js';
import { createLmStudioTools } from '../lmstudio/tools.js';
import { append } from '../logStore.js';
import { baseLogger, resolveLogConfig } from '../logger.js';
import { BASE_URL_REGEX, scrubBaseUrl, toWebSocketUrl } from './lmstudioUrl.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
type ToolFactory = typeof createLmStudioTools;

export const normalizeToolResults = (
  message: unknown,
): Array<{
  callId?: string | number;
  name?: string;
  result?: unknown;
}> => {
  const toEntry = (
    item: unknown,
  ): { callId?: string | number; name?: string; result?: unknown } => {
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      return {
        callId:
          (obj.toolCallId as string | number | undefined) ??
          (obj.callId as string | number | undefined) ??
          (obj.id as string | number | undefined),
        name: (obj.name as string | undefined) ?? undefined,
        result:
          'result' in obj ? obj.result : 'content' in obj ? obj.content : obj,
      };
    }
    if (typeof item === 'string') {
      try {
        const parsed = JSON.parse(item) as unknown;
        return toEntry(parsed);
      } catch {
        return { result: item };
      }
    }
    return { result: item };
  };

  const content =
    (message as { content?: unknown })?.content ??
    (message as { toolCallResult?: unknown })?.toolCallResult ??
    message;

  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => toEntry(item));
      }
      return [toEntry(parsed)];
    } catch {
      return [toEntry(content)];
    }
  }

  if (Array.isArray(content)) {
    return content.map((item) => toEntry(item));
  }
  return [toEntry(content)];
};

export const findAssistantToolResults = (
  message: unknown,
  toolCtx: Map<number, unknown>,
  toolNames: Map<number, string>,
) => {
  const msg = message as { role?: unknown; content?: unknown };
  if (!msg || msg.role !== 'assistant' || typeof msg.content !== 'string') {
    return [];
  }
  return normalizeToolResults(message).filter(
    (entry) =>
      entry.callId !== undefined &&
      (toolCtx.has(Number(entry.callId)) ||
        toolNames.has(Number(entry.callId))),
  );
};

export function createChatRouter({
  clientFactory,
  toolFactory = createLmStudioTools,
}: {
  clientFactory: ClientFactory;
  toolFactory?: ToolFactory;
}) {
  const router = Router();
  const { maxClientBytes } = resolveLogConfig();
  router.use(json({ limit: `${maxClientBytes}b`, strict: false }));

  router.post('/', async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const { model, messages } = req.body ?? {};
    const controller = new AbortController();
    let ended = false;
    let completed = false;
    let cancelled = false;

    const endIfOpen = () => {
      if (ended || isStreamClosed(res)) return;
      ended = true;
      endStream(res);
    };

    if (typeof model !== 'string' || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'invalid request' });
    }

    const rawSize = JSON.stringify(req.body ?? {}).length;
    if (rawSize > maxClientBytes) {
      return res.status(400).json({ error: 'payload too large' });
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
        context: { baseUrl: safeBase, model },
      });
      baseLogger.error(
        { requestId, baseUrl: safeBase, model },
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
      context: { baseUrl: safeBase, model },
    });
    baseLogger.info(
      { requestId, baseUrl: safeBase, model },
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
        context: { baseUrl: safeBase, model, reason: 'client_disconnect' },
      });
      baseLogger.info(
        { requestId, baseUrl: safeBase, model, reason: 'client_disconnect' },
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
      const chat = Chat.from(messages);
      const writeIfOpen = (payload: unknown) => {
        if (cancelled || isStreamClosed(res)) return;
        writeEvent(res, payload);
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
          writeIfOpen({
            type: 'token',
            content: fragment.content,
            roundIndex: fragment.roundIndex ?? currentRound,
          });
        },
        onMessage: (message) => {
          const msg = message as { role?: unknown; content?: unknown };
          const pendingToolResults =
            msg && msg.role === 'tool' ? normalizeToolResults(message) : [];

          if (msg && msg.role === 'tool') {
            baseLogger.info(
              {
                requestId,
                baseUrl: safeBase,
                model,
                messageKind: 'role:tool',
                hasResults: pendingToolResults.length > 0,
              },
              'chat onMessage received tool role',
            );
          }

          if (
            msg &&
            msg.role === 'assistant' &&
            typeof msg.content === 'string'
          ) {
            const assistantToolResults = findAssistantToolResults(
              message,
              toolCtx,
              toolNames,
            );

            if (assistantToolResults.length > 0) {
              baseLogger.info(
                {
                  requestId,
                  baseUrl: safeBase,
                  model,
                  messageKind: 'assistant_tool_payload',
                  count: assistantToolResults.length,
                },
                'chat onMessage suppressed assistant tool payload',
              );
              for (const entry of assistantToolResults) {
                const callId = entry.callId;
                if (callId === undefined || callId === null) continue;
                const name =
                  entry.name ??
                  toolNames.get(Number(callId)) ??
                  toolNames.get(callId as number) ??
                  undefined;
                if (syntheticToolResults.has(callId)) {
                  emittedToolResults.delete(callId);
                  syntheticToolResults.delete(callId);
                }
                emitToolResult(currentRound, callId, name, entry.result, {
                  parameters:
                    typeof callId === 'number'
                      ? parseToolParameters(callId, entry.result)
                      : undefined,
                });
              }
              return;
            }
          }

          if (
            msg &&
            typeof msg.role === 'string' &&
            typeof msg.content === 'string'
          ) {
            chat.append(
              msg.role as 'assistant' | 'user' | 'system',
              msg.content,
            );
          }
          writeIfOpen({
            type: 'final',
            message,
            roundIndex: currentRound,
          });

          for (const entry of pendingToolResults) {
            const callId = entry.callId;
            if (callId === undefined || callId === null) continue;
            const name =
              entry.name ??
              toolNames.get(Number(callId)) ??
              toolNames.get(callId as number) ??
              undefined;
            if (syntheticToolResults.has(callId)) {
              emittedToolResults.delete(callId);
              syntheticToolResults.delete(callId);
            }
            emitToolResult(currentRound, callId, name, entry.result, {
              parameters:
                typeof callId === 'number'
                  ? parseToolParameters(callId, entry.result)
                  : undefined,
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
        },
      };

      const prediction = modelClient.act(
        chat,
        tools,
        actOptions as LLMActionOpts,
      );

      await prediction;

      if (cancelled || req.aborted) {
        return;
      }
      completed = true;
      writeEvent(res, { type: 'complete' });
      toolCtx.clear();
      toolArgs.clear();

      append({
        level: 'info',
        message: 'chat stream complete',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, model },
      });
      baseLogger.info(
        { requestId, baseUrl: safeBase, model },
        'chat stream complete',
      );
    } catch (err) {
      const message =
        (err as Error | undefined)?.message ?? 'lmstudio unavailable';
      writeEvent(res, { type: 'error', message });
      append({
        level: 'error',
        message: 'chat stream failed',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, model, error: message },
      });
      baseLogger.error(
        { requestId, baseUrl: safeBase, model, error: message },
        'chat stream failed',
      );
    } finally {
      toolCtx.clear();
      toolArgs.clear();
      endIfOpen();
    }
  });

  return router;
}
