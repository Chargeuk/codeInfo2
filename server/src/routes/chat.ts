import type { LLMActionOpts, LMStudioClient } from '@lmstudio/sdk';
import { Router, json } from 'express';
import {
  endStream,
  isStreamClosed,
  startStream,
  writeEvent,
} from '../chatStream.js';
import { append } from '../logStore.js';
import { baseLogger, resolveLogConfig } from '../logger.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;

const BASE_URL_REGEX = /^(https?|wss?):\/\//i;

const scrubBaseUrl = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return '[invalid-url]';
  }
};

const toWebSocketUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/i, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/i, 'wss:');
  return value;
};

export function createChatRouter({
  clientFactory,
}: {
  clientFactory: ClientFactory;
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
      const tools = [
        {
          name: 'noop',
          description: 'does nothing',
          implementation: async () => ({ result: 'noop' }),
        },
      ] as Array<unknown>;
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

      const actOptions: Record<string, unknown> = {
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
        onMessage: (message: unknown) => {
          writeIfOpen({
            type: 'final',
            message,
            roundIndex: currentRound,
          });
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
          writeIfOpen({
            type: 'tool-request',
            callId,
            roundIndex,
            stage: 'toolCallRequestArgumentFragmentGenerated',
            content,
          });
        },
        onToolCallRequestEnd: (roundIndex: number, callId: number) => {
          logToolEvent('toolCallRequestEnd', callId, undefined, roundIndex);
          writeIfOpen({
            type: 'tool-request',
            callId,
            roundIndex,
            stage: 'toolCallRequestEnd',
          });
        },
        onToolCallRequestFailure: (
          roundIndex: number,
          callId: number,
          error: Error,
        ) => {
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
          logToolEvent('toolCallResult', callId, undefined, roundIndex);
          writeIfOpen({
            type: 'tool-result',
            callId,
            roundIndex,
            result: info,
          });
        },
      };

      const prediction = modelClient.act(
        { messages },
        tools as unknown as Array<never>,
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
