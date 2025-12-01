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

    try {
      const client = clientFactory(toWebSocketUrl(baseUrl));
      const modelClient = await client.llm.model(model);
      let currentRound = 0;
      const emittedToolResults = new Set<string | number>();
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

      const toolNames = new Map<number, string>();

      const emitToolResult = (
        roundIndex: number,
        callId: string | number,
        name: string | undefined,
        payload: unknown,
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
          },
          'chat tool result emit',
        );
        writeIfOpen({
          type: 'tool-result',
          callId,
          roundIndex,
          name,
          result: payload,
        });
      };

      const normalizeToolResults = (
        message: unknown,
      ): Array<{
        callId?: string | number;
        name?: string;
        result?: unknown;
      }> => {
        const content =
          (message as { content?: unknown })?.content ??
          (message as { toolCallResult?: unknown })?.toolCallResult ??
          message;

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
                'result' in obj
                  ? obj.result
                  : 'content' in obj
                    ? obj.content
                    : obj,
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

        if (Array.isArray(content)) {
          return content.map((item) => toEntry(item));
        }
        return [toEntry(content)];
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
            emitToolResult(currentRound, callId, name, entry.result);
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
          writeIfOpen({
            type: 'error',
            message: (error as { message?: string }).message,
            roundIndex,
          });
        },
        onToolCallResult: (
          roundIndex: number,
          callId: number,
          info: unknown,
        ) => {
          const name =
            toolNames.get(callId) ??
            (info as { name?: string })?.name ??
            undefined;
          const payload =
            info && typeof info === 'object' && 'result' in (info as object)
              ? (info as { result?: unknown }).result
              : info;
          emitToolResult(roundIndex, callId, name, payload);
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
      endIfOpen();
    }
  });

  return router;
}
