import http from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import WebSocket from 'ws';

import { getWsHub, resetWsHubForTest } from '../../ws/hub.js';
import { resetInflightRegistryForTest } from '../../ws/inflightRegistry.js';
import { startChatWsServer } from '../../ws/server.js';

export type WsJson = Record<string, unknown>;

const messageBuffer = new WeakMap<WebSocket, unknown[]>();
const MAX_BUFFERED = 200;

function ensureBuffer(ws: WebSocket) {
  if (messageBuffer.has(ws)) return;
  messageBuffer.set(ws, []);
  ws.on('message', (raw: WebSocket.RawData) => {
    try {
      const parsed = JSON.parse(raw.toString()) as unknown;
      const buf = messageBuffer.get(ws);
      if (!buf) return;
      buf.push(parsed);
      if (buf.length > MAX_BUFFERED) buf.splice(0, buf.length - MAX_BUFFERED);
    } catch {
      // ignore non-json
    }
  });
  ws.once('close', () => {
    messageBuffer.delete(ws);
  });
}

export function messageType(msg: WsJson): string | undefined {
  const value = msg.type;
  return typeof value === 'string' ? value : undefined;
}

export function messageString(msg: WsJson, key: string): string | undefined {
  const value = msg[key];
  return typeof value === 'string' ? value : undefined;
}

export async function startWsTestServer(params?: {
  mount?: (app: express.Express) => void;
}) {
  resetInflightRegistryForTest();
  resetWsHubForTest();

  const app = express();
  app.use(express.json());
  params?.mount?.(app);

  const server = http.createServer(app);
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  const wsHandle = startChatWsServer({ server, path: '/ws' });

  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const close = async () => {
    await wsHandle.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    app,
    server,
    baseUrl,
    wsUrl,
    hub: getWsHub(),
    close,
  };
}

export function openWs(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  ensureBuffer(ws);
  return ws;
}

export function sendJson(ws: WebSocket, payload: unknown) {
  ws.send(JSON.stringify(payload));
}

export async function waitForOpen(ws: WebSocket, timeoutMs = 2000) {
  ensureBuffer(ws);
  if (ws.readyState === ws.OPEN) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('ws open timeout')),
      timeoutMs,
    );
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function waitForMessage<T = unknown>(
  ws: WebSocket,
  predicate: (msg: T) => boolean,
  timeoutMs = 2000,
) {
  ensureBuffer(ws);

  const existing = messageBuffer.get(ws);
  if (existing && existing.length > 0) {
    const idx = existing.findIndex((msg) => {
      try {
        return predicate(msg as T);
      } catch {
        return false;
      }
    });
    if (idx >= 0) {
      const [match] = existing.splice(idx, 1);
      return match as T;
    }
  }

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('ws message timeout')),
      timeoutMs,
    );

    const tryResolve = () => {
      const buf = messageBuffer.get(ws);
      if (!buf || buf.length === 0) return false;
      const idx = buf.findIndex((msg) => {
        try {
          return predicate(msg as T);
        } catch {
          return false;
        }
      });
      if (idx < 0) return false;
      const [match] = buf.splice(idx, 1);
      cleanup();
      resolve(match as T);
      return true;
    };

    const onMessage = () => {
      tryResolve();
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };

    if (tryResolve()) return;

    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}
