import crypto from 'node:crypto';

import WebSocket, { type RawData } from 'ws';

import { resolveConfiguredTestTimeoutMs } from './testTimeouts.js';

const bufferedEventsBySocket = new WeakMap<WebSocket, unknown[]>();

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
      if (buffer.length > 500) buffer.splice(0, buffer.length - 500);
    } catch {
      // ignore malformed payloads
    }
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

export function peekBufferedEvents(ws: WebSocket): unknown[] {
  return [...getBuffer(ws)];
}

export async function waitForEvent<T>(params: {
  ws: WebSocket;
  predicate: (event: unknown) => event is T;
  timeoutMs?: number;
  describe?: () => string;
  inspectCurrent?: () => string;
  describeEvent?: (event: unknown) => string;
}): Promise<T> {
  const timeoutMs = resolveConfiguredTestTimeoutMs(params.timeoutMs ?? 2000);

  const buffer = getBuffer(params.ws);
  const consumeBuffered = (): T | undefined => {
    while (buffer.length) {
      const next = buffer.shift();
      if (params.predicate(next)) return next;
    }
    return undefined;
  };

  const already = consumeBuffered();
  if (already) return already;

  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      const recentEvents = peekBufferedEvents(params.ws)
        .slice(-12)
        .map((event) =>
          params.describeEvent ? params.describeEvent(event) : JSON.stringify(event),
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

  try {
    ws.close();
  } catch {
    // ignore
  }
  await waitForClose(ws, resolvedTimeoutMs);
  bufferedEventsBySocket.delete(ws);
}

export function waitForClose(
  ws: WebSocket,
  timeoutMs = 2000,
): Promise<{ code: number; reason: string }> {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeAllListeners('close');
      reject(new Error('Timed out waiting for WebSocket close'));
    }, resolvedTimeoutMs);

    ws.once('close', (code, rawReason) => {
      clearTimeout(timeout);
      resolve({ code, reason: rawReason.toString() });
    });
  });
}
