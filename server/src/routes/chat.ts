import type { LMStudioClient } from '@lmstudio/sdk';
import { Router, json } from 'express';
import { endStream, startStream, writeEvent } from '../chatStream.js';
import { append } from '../logStore.js';
import { baseLogger, resolveLogConfig } from '../logger.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
type ChatModelClient = {
  act: (
    args: unknown,
  ) =>
    | Promise<AsyncIterable<unknown> | AsyncIterableIterator<unknown>>
    | AsyncIterable<unknown>
    | AsyncIterableIterator<unknown>;
};
type ClientWithModel = {
  getModel: (key: string) => ChatModelClient;
};

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

function mapEvent(event: Record<string, unknown> | null | undefined) {
  const record = (event ?? {}) as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : undefined;
  const roundIndex =
    typeof record.roundIndex === 'number' ? record.roundIndex : undefined;
  const callId = typeof record.callId === 'string' ? record.callId : undefined;
  const name = typeof record.name === 'string' ? record.name : undefined;

  switch (type) {
    case 'predictionFragment':
      return {
        type: 'token',
        content: (event as { content?: string }).content,
        roundIndex,
      };
    case 'message':
      return {
        type: 'final',
        message: (event as { message?: unknown }).message,
        roundIndex,
      };
    case 'token':
    case 'final':
    case 'complete':
    case 'error':
    case 'tool-request':
    case 'tool-result':
      return {
        ...record,
        type,
        roundIndex,
      };
    case 'toolCallRequestStart':
    case 'toolCallNameReceived':
    case 'toolCallArgumentFragmentGenerated':
    case 'toolCallRequestEnd':
      return {
        type: 'tool-request',
        callId,
        name,
        roundIndex,
        stage: type,
      };
    case 'toolCallResult':
      return {
        type: 'tool-result',
        callId,
        roundIndex,
        stage: type,
      };
    default:
      return null;
  }
}

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

    try {
      const client = clientFactory(
        toWebSocketUrl(baseUrl),
      ) as unknown as ClientWithModel;
      const modelClient = client.getModel(model);
      const ongoing = await modelClient.act({
        messages,
        tools: [
          {
            name: 'noop',
            description: 'does nothing',
            execute: async () => ({ result: 'noop' }),
          },
        ],
        allowParallelToolExecution: false,
      });

      for await (const rawEvent of ongoing as AsyncIterable<unknown>) {
        const event = rawEvent as Record<string, unknown> | null | undefined;
        const eventType =
          typeof event?.type === 'string' ? event.type : undefined;
        const callId =
          typeof event?.callId === 'string' ? event.callId : undefined;
        const toolName =
          typeof event?.name === 'string' ? event.name : undefined;

        if (eventType?.startsWith('toolCall')) {
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
              name: toolName,
            },
          });
          baseLogger.info(
            {
              requestId,
              baseUrl: safeBase,
              model,
              type: eventType,
              callId,
              name: toolName,
            },
            'chat tool event',
          );
        }
        const mapped = mapEvent(event);
        if (mapped) {
          writeEvent(res, mapped);
        }
      }

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
      endStream(res);
    }
  });

  return router;
}
