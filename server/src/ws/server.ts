import crypto from 'node:crypto';
import type http from 'node:http';

import WebSocket, { type RawData, WebSocketServer } from 'ws';

import {
  abortInflight,
  bumpSeq,
  snapshotInflight,
} from '../chat/inflightRegistry.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import {
  isSidebarSubscribed,
  registerSocket,
  socketsSubscribedToConversation,
  subscribeConversation,
  subscribeSidebar,
  subscribedConversationCount,
  unregisterSocket,
  unsubscribeConversation,
  unsubscribeSidebar,
} from './registry.js';
import { startSidebarPublisher, type SidebarPublisher } from './sidebar.js';
import {
  WS_PROTOCOL_VERSION,
  parseClientMessage,
  type WsAssistantDeltaEvent,
  type WsAnalysisDeltaEvent,
  type WsClientMessage,
  type WsInflightSnapshotEvent,
  type WsStreamWarningEvent,
  type WsToolEventEvent,
  type WsTurnFinalEvent,
  type WsUserTurnEvent,
} from './types.js';

export type WsServerHandle = {
  close: () => Promise<void>;
};

function rawDataToString(raw: RawData): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return raw.toString('utf8');
}

function safeSend(ws: WebSocket, event: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const data = JSON.stringify(event);
  try {
    ws.send(data);
  } catch {
    // Ignore send failures; the connection will be cleaned up on close/error.
  }
}

function broadcastConversation(conversationId: string, event: unknown) {
  const data = JSON.stringify(event);
  for (const ws of socketsSubscribedToConversation(conversationId)) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(data);
    } catch {
      // Ignore send failures; the connection will be cleaned up on close/error.
    }
  }
}

function logPublish(message: string, context: Record<string, unknown>) {
  append({
    level: 'info',
    message,
    timestamp: new Date().toISOString(),
    source: 'server',
    context,
  });
  baseLogger.info(context, message);
}

export function publishInflightSnapshot(conversationId: string) {
  const snapshot = snapshotInflight(conversationId);
  if (!snapshot) return;

  const event: WsInflightSnapshotEvent = {
    protocolVersion: WS_PROTOCOL_VERSION,
    type: 'inflight_snapshot',
    conversationId,
    seq: bumpSeq(conversationId),
    inflight: {
      inflightId: snapshot.inflightId,
      assistantText: snapshot.assistantText,
      assistantThink: snapshot.assistantThink,
      toolEvents: snapshot.toolEvents,
      startedAt: snapshot.startedAt,
    },
  };

  broadcastConversation(conversationId, event);
}

export function publishUserTurn(params: {
  conversationId: string;
  inflightId: string;
  content: string;
  createdAt: string;
}) {
  const event: WsUserTurnEvent = {
    protocolVersion: WS_PROTOCOL_VERSION,
    type: 'user_turn',
    conversationId: params.conversationId,
    seq: bumpSeq(params.conversationId),
    inflightId: params.inflightId,
    content: params.content,
    createdAt: params.createdAt,
  };

  logPublish('chat.ws.server_publish_user_turn', {
    conversationId: params.conversationId,
    inflightId: params.inflightId,
    seq: event.seq,
    contentLen: params.content.length,
  });

  broadcastConversation(params.conversationId, event);
}

export function publishAssistantDelta(params: {
  conversationId: string;
  inflightId: string;
  delta: string;
}) {
  const event: WsAssistantDeltaEvent = {
    protocolVersion: WS_PROTOCOL_VERSION,
    type: 'assistant_delta',
    conversationId: params.conversationId,
    seq: bumpSeq(params.conversationId),
    inflightId: params.inflightId,
    delta: params.delta,
  };

  logPublish('chat.ws.server_publish_assistant_delta', {
    conversationId: params.conversationId,
    inflightId: params.inflightId,
    seq: event.seq,
    deltaLen: params.delta.length,
  });

  broadcastConversation(params.conversationId, event);
}

export function publishAnalysisDelta(params: {
  conversationId: string;
  inflightId: string;
  delta: string;
}) {
  const event: WsAnalysisDeltaEvent = {
    protocolVersion: WS_PROTOCOL_VERSION,
    type: 'analysis_delta',
    conversationId: params.conversationId,
    seq: bumpSeq(params.conversationId),
    inflightId: params.inflightId,
    delta: params.delta,
  };
  broadcastConversation(params.conversationId, event);
}

export function publishToolEvent(params: {
  conversationId: string;
  inflightId: string;
  event: WsToolEventEvent['event'];
}) {
  const outbound: WsToolEventEvent = {
    protocolVersion: WS_PROTOCOL_VERSION,
    type: 'tool_event',
    conversationId: params.conversationId,
    seq: bumpSeq(params.conversationId),
    inflightId: params.inflightId,
    event: params.event,
  };
  broadcastConversation(params.conversationId, outbound);
}

export function publishStreamWarning(params: {
  conversationId: string;
  inflightId: string;
  message: string;
}) {
  const event: WsStreamWarningEvent = {
    protocolVersion: WS_PROTOCOL_VERSION,
    type: 'stream_warning',
    conversationId: params.conversationId,
    seq: bumpSeq(params.conversationId),
    inflightId: params.inflightId,
    message: params.message,
  };
  broadcastConversation(params.conversationId, event);
}

export function publishTurnFinal(params: {
  conversationId: string;
  inflightId: string;
  status: WsTurnFinalEvent['status'];
  threadId?: string | null;
  error?: WsTurnFinalEvent['error'];
  seq?: number;
}) {
  const seq = params.seq ?? (bumpSeq(params.conversationId) || 1);

  const event: WsTurnFinalEvent = {
    protocolVersion: WS_PROTOCOL_VERSION,
    type: 'turn_final',
    conversationId: params.conversationId,
    seq,
    inflightId: params.inflightId,
    status: params.status,
    ...(params.threadId !== undefined ? { threadId: params.threadId } : {}),
    ...(params.error !== undefined ? { error: params.error } : {}),
  };

  logPublish('chat.ws.server_publish_turn_final', {
    conversationId: params.conversationId,
    inflightId: params.inflightId,
    seq,
    status: params.status,
    errorCode: params.error?.code,
  });

  broadcastConversation(params.conversationId, event);
}

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
    baseLogger.info(
      {
        requestId: params.requestId,
        connectionId: params.connectionId,
        conversationId: params.conversationId,
        subscribedSidebar: isSidebarSubscribed(params.ws),
        subscribedConversationCount: subscribedConversationCount(params.ws),
      },
      params.message,
    );
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
      case 'subscribe_conversation': {
        subscribeConversation(ws, message.conversationId);
        logLifecycle({
          message: 'chat.ws.subscribe_conversation',
          requestId: message.requestId,
          connectionId,
          conversationId: message.conversationId,
          ws,
        });

        const snapshot = snapshotInflight(message.conversationId);
        if (snapshot) {
          const event: WsInflightSnapshotEvent = {
            protocolVersion: WS_PROTOCOL_VERSION,
            type: 'inflight_snapshot',
            conversationId: message.conversationId,
            seq: bumpSeq(message.conversationId),
            inflight: {
              inflightId: snapshot.inflightId,
              assistantText: snapshot.assistantText,
              assistantThink: snapshot.assistantThink,
              toolEvents: snapshot.toolEvents,
              startedAt: snapshot.startedAt,
            },
          };
          safeSend(ws, event);
        }

        return;
      }
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
      case 'cancel_inflight': {
        append({
          level: 'info',
          message: 'chat.stream.cancel',
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId: message.requestId,
          context: {
            connectionId,
            conversationId: message.conversationId,
            inflightId: message.inflightId,
          },
        });
        baseLogger.info(
          {
            requestId: message.requestId,
            connectionId,
            conversationId: message.conversationId,
            inflightId: message.inflightId,
          },
          'chat.stream.cancel',
        );

        const cancelled = abortInflight({
          conversationId: message.conversationId,
          inflightId: message.inflightId,
        });

        if (!cancelled.ok) {
          publishTurnFinal({
            conversationId: message.conversationId,
            inflightId: message.inflightId,
            status: 'failed',
            threadId: null,
            error: {
              code: 'INFLIGHT_NOT_FOUND',
              message: 'No active in-flight run found for conversation.',
            },
          });
        }
        return;
      }
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
