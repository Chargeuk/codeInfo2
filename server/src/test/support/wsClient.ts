import crypto from 'node:crypto';

import WebSocket, { type RawData } from 'ws';

import { query, subscribe } from '../../logStore.js';
import { resolveConfiguredTestTimeoutMs } from './testTimeouts.js';

const bufferedEventsBySocket = new WeakMap<WebSocket, unknown[]>();
const closeResultsBySocket = new WeakMap<
  WebSocket,
  { code: number; reason: string }
>();

function getBuffer(ws: WebSocket): unknown[] {
  const existing = bufferedEventsBySocket.get(ws);
  if (existing) return existing;
  const created: unknown[] = [];
  bufferedEventsBySocket.set(ws, created);
  return created;
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return raw.toString('utf8');
}

export async function connectWs(params: {
  baseUrl: string;
  timeoutMs?: number;
}): Promise<WebSocket> {
  const wsUrl = `${params.baseUrl.replace(/^http/, 'ws')}/ws`;
  const ws = new WebSocket(wsUrl);
  const timeoutMs = resolveConfiguredTestTimeoutMs(params.timeoutMs ?? 2000);

  const buffer = getBuffer(ws);
  ws.on('message', (raw) => {
    const text = rawDataToString(raw);
    try {
      buffer.push(JSON.parse(text));
    } catch {
      // ignore malformed payloads
    }
  });
  ws.once('close', (code, rawReason) => {
    closeResultsBySocket.set(ws, {
      code,
      reason: rawReason.toString(),
    });
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out connecting to WebSocket'));
    }, timeoutMs);

    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('open', onOpen);
      ws.off('error', onError);
    };

    ws.on('open', onOpen);
    ws.on('error', onError);
  });

  return ws;
}

export function sendJson(
  ws: WebSocket,
  message: Record<string, unknown>,
): { requestId: string } {
  const requestId =
    typeof message.requestId === 'string' && message.requestId.length > 0
      ? message.requestId
      : crypto.randomUUID();

  const payload = {
    protocolVersion: 'v1',
    ...message,
    requestId,
  };

  ws.send(JSON.stringify(payload));
  return { requestId };
}

export async function subscribeConversationAndWaitReady(params: {
  ws: WebSocket;
  conversationId: string;
  timeoutMs?: number;
}): Promise<void> {
  const requestId = crypto.randomUUID();
  const timeoutMs = resolveConfiguredTestTimeoutMs(params.timeoutMs ?? 2000);
  const isReady = () =>
    query({ text: requestId }).some(
      (entry) =>
        entry.message === 'chat.ws.subscribe_conversation' &&
        entry.requestId === requestId &&
        entry.context?.conversationId === params.conversationId,
    );

  if (isReady()) return;

  await new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(
          `Timed out waiting for conversation subscription ${params.conversationId}`,
        ),
      );
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    };

    unsubscribe = subscribe((entry) => {
      if (
        entry.message === 'chat.ws.subscribe_conversation' &&
        entry.requestId === requestId &&
        entry.context?.conversationId === params.conversationId
      ) {
        finish();
      }
    });

    sendJson(params.ws, {
      type: 'subscribe_conversation',
      conversationId: params.conversationId,
      requestId,
    });

    if (isReady()) finish();
  });
}

export function peekBufferedEvents(ws: WebSocket): unknown[] {
  return [...getBuffer(ws)];
}

export async function waitForEvent<T>(params: {
  ws: WebSocket;
  predicate: (event: unknown) => event is T;
  timeoutMs?: number;
  useConfiguredTimeout?: boolean;
  describe?: () => string;
  inspectCurrent?: () => string;
  describeEvent?: (event: unknown) => string;
}): Promise<T> {
  const requestedTimeoutMs = params.timeoutMs ?? 2000;
  const timeoutMs =
    params.useConfiguredTimeout === false
      ? requestedTimeoutMs
      : resolveConfiguredTestTimeoutMs(requestedTimeoutMs);

  const buffer = getBuffer(params.ws);
  const consumeBuffered = (): T | undefined => {
    const matchingIndex = buffer.findIndex((event) => params.predicate(event));
    if (matchingIndex < 0) return undefined;
    return buffer.splice(matchingIndex, 1)[0] as T;
  };

  const already = consumeBuffered();
  if (already) return already;

  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      const recentEvents = peekBufferedEvents(params.ws)
        .slice(-12)
        .map((event) =>
          params.describeEvent
            ? params.describeEvent(event)
            : JSON.stringify(event),
        );
      reject(
        new Error(
          [
            'Timed out waiting for WebSocket event',
            params.describe ? params.describe() : null,
            params.inspectCurrent ? `current=${params.inspectCurrent()}` : null,
            `recentEvents=${JSON.stringify(recentEvents)}`,
          ]
            .filter((part): part is string => Boolean(part))
            .join(' | '),
        ),
      );
    }, timeoutMs);

    const interval = setInterval(() => {
      const candidate = consumeBuffered();
      if (!candidate) return;
      cleanup();
      resolve(candidate);
    }, 10);

    const onMessage = () => {
      const candidate = consumeBuffered();
      if (!candidate) return;
      cleanup();
      resolve(candidate);
    };

    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(interval);
      params.ws.off('message', onMessage);
      params.ws.off('error', onError);
    };

    params.ws.on('message', onMessage);
    params.ws.on('error', onError);

    const candidate = consumeBuffered();
    if (candidate) {
      cleanup();
      resolve(candidate);
    }
  });
}

export async function closeWs(ws: WebSocket, timeoutMs = 2000): Promise<void> {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  if (ws.readyState === WebSocket.CLOSED) return;
  if (ws.readyState === WebSocket.CLOSING) {
    await waitForClose(ws, resolvedTimeoutMs);
    return;
  }

  const closePromise = waitForClose(ws, resolvedTimeoutMs);
  try {
    ws.close();
  } catch {
    // ignore
  }
  await closePromise;
  bufferedEventsBySocket.delete(ws);
}

export function waitForClose(
  ws: WebSocket,
  timeoutMs = 2000,
): Promise<{ code: number; reason: string }> {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const alreadyClosed = closeResultsBySocket.get(ws);
  if (alreadyClosed) return Promise.resolve(alreadyClosed);
  if (ws.readyState === WebSocket.CLOSED) {
    return Promise.resolve({ code: 1005, reason: '' });
  }
  return new Promise((resolve, reject) => {
    const onClose = (code: number, rawReason: Buffer) => {
      cleanup();
      resolve({ code, reason: rawReason.toString() });
    };
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('close', onClose);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket close'));
    }, resolvedTimeoutMs);

    ws.once('close', onClose);
    const closedAfterRegistration = closeResultsBySocket.get(ws);
    if (closedAfterRegistration) {
      cleanup();
      resolve(closedAfterRegistration);
    }
  });
}
