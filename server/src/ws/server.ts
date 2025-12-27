import crypto from 'node:crypto';
import type http from 'node:http';

import WebSocket, { type RawData, WebSocketServer } from 'ws';

import { append } from '../logStore.js';
import {
  isSidebarSubscribed,
  registerSocket,
  subscribeConversation,
  subscribeSidebar,
  subscribedConversationCount,
  unregisterSocket,
  unsubscribeConversation,
  unsubscribeSidebar,
} from './registry.js';
import { startSidebarPublisher, type SidebarPublisher } from './sidebar.js';
import { parseClientMessage, type WsClientMessage } from './types.js';

export type WsServerHandle = {
  close: () => Promise<void>;
};

export function attachWs(params: { httpServer: http.Server }): WsServerHandle {
  const wss = new WebSocketServer({ noServer: true });
  const sidebarPublisher: SidebarPublisher = startSidebarPublisher();

  const connectionIdBySocket = new WeakMap<WebSocket, string>();

  const isAlive = new WeakMap<WebSocket, boolean>();
  const missedPongs = new WeakMap<WebSocket, number>();

  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;

      const alive = isAlive.get(ws) ?? true;
      if (!alive) {
        const missed = (missedPongs.get(ws) ?? 0) + 1;
        missedPongs.set(ws, missed);
        if (missed >= 2) {
          ws.terminate();
          continue;
        }
      }

      isAlive.set(ws, false);
      try {
        ws.ping();
      } catch {
        // ignore
      }
    }
  }, 30_000);

  function logLifecycle(params: {
    message: string;
    requestId?: string;
    connectionId: string;
    conversationId?: string;
    ws: WebSocket;
  }) {
    append({
      level: 'info',
      message: params.message,
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId: params.requestId,
      context: {
        connectionId: params.connectionId,
        ...(params.conversationId
          ? { conversationId: params.conversationId }
          : {}),
        subscribedSidebar: isSidebarSubscribed(params.ws),
        subscribedConversationCount: subscribedConversationCount(params.ws),
      },
    });
  }

  function handleMessage(ws: WebSocket, message: WsClientMessage) {
    const connectionId = connectionIdBySocket.get(ws);
    if (!connectionId) return;

    switch (message.type) {
      case 'subscribe_sidebar':
        subscribeSidebar(ws);
        logLifecycle({
          message: 'chat.ws.subscribe_sidebar',
          requestId: message.requestId,
          connectionId,
          ws,
        });
        return;
      case 'unsubscribe_sidebar':
        unsubscribeSidebar(ws);
        logLifecycle({
          message: 'chat.ws.unsubscribe_sidebar',
          requestId: message.requestId,
          connectionId,
          ws,
        });
        return;
      case 'subscribe_conversation':
        subscribeConversation(ws, message.conversationId);
        logLifecycle({
          message: 'chat.ws.subscribe_conversation',
          requestId: message.requestId,
          connectionId,
          conversationId: message.conversationId,
          ws,
        });
        return;
      case 'unsubscribe_conversation':
        unsubscribeConversation(ws, message.conversationId);
        logLifecycle({
          message: 'chat.ws.unsubscribe_conversation',
          requestId: message.requestId,
          connectionId,
          conversationId: message.conversationId,
          ws,
        });
        return;
      case 'cancel_inflight':
        // Wired in Task 4.
        return;
      case 'unknown':
        // Unknown type is ignored for forward compatibility.
        return;
    }
  }

  params.httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    const { pathname } = new URL(url, 'http://localhost');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws, req) => {
      wss.emit('connection', ws, req);
    });
  });

  function rawDataToString(raw: RawData): string {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    return raw.toString('utf8');
  }

  wss.on('connection', (ws) => {
    registerSocket(ws);
    isAlive.set(ws, true);
    missedPongs.set(ws, 0);

    const connectionId = crypto.randomUUID();
    connectionIdBySocket.set(ws, connectionId);
    logLifecycle({
      message: 'chat.ws.connect',
      connectionId,
      ws,
    });

    ws.on('pong', () => {
      isAlive.set(ws, true);
      missedPongs.set(ws, 0);
    });

    ws.on('message', (raw) => {
      const payload = rawDataToString(raw);
      const parsed = parseClientMessage(payload);
      if (!parsed.ok) {
        ws.close(1008, parsed.message);
        return;
      }

      handleMessage(ws, parsed.message);
    });

    ws.on('close', () => {
      logLifecycle({
        message: 'chat.ws.disconnect',
        connectionId,
        ws,
      });
      unregisterSocket(ws);
    });
  });

  return {
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeatInterval);
        sidebarPublisher.close();
        wss.close(() => resolve());
      }),
  };
}
