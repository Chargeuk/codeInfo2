import crypto from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';

import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';

import { baseLogger } from '../logger.js';
import { getWsHub, type WsSocketContext } from './hub.js';
import { clientMessageSchema, type ServerErrorEvent } from './types.js';

export type ChatWsServerHandle = {
  close: () => Promise<void>;
};

function safeSend(socket: WsSocketContext, payload: unknown) {
  if (socket.ws.readyState !== socket.ws.OPEN) return;
  try {
    socket.ws.send(JSON.stringify(payload));
  } catch (err) {
    baseLogger.warn({ err, socketId: socket.id }, 'ws send failed');
  }
}

function sendError(socket: WsSocketContext, error: ServerErrorEvent) {
  safeSend(socket, error);
}

export function startChatWsServer(params: {
  server: HttpServer;
  path?: string;
}): ChatWsServerHandle {
  const path = params.path ?? '/ws';
  const wss = new WebSocketServer({ server: params.server, path });

  const hub = getWsHub();

  const sockets = new Map<WebSocket, WsSocketContext>();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const socket: WsSocketContext = {
      id: crypto.randomUUID(),
      ws,
      subscribedSidebar: false,
      subscribedConversations: new Set(),
      sidebarSeq: 0,
    };
    sockets.set(ws, socket);

    baseLogger.info(
      {
        socketId: socket.id,
        wsPath: path,
        url: req.url,
        remote: req.socket.remoteAddress,
      },
      'ws connection',
    );

    ws.on('error', (err: Error) => {
      baseLogger.warn({ err, socketId: socket.id }, 'ws socket error');
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendError(socket, {
          type: 'error',
          code: 'invalid_json',
          message: 'Invalid JSON',
        });
        baseLogger.warn({ socketId: socket.id }, 'ws invalid json');
        return;
      }

      const parsed = clientMessageSchema.safeParse(msg);
      if (!parsed.success) {
        const reqId =
          msg &&
          typeof msg === 'object' &&
          typeof (msg as { requestId?: unknown }).requestId === 'string'
            ? (msg as { requestId: string }).requestId
            : undefined;
        sendError(socket, {
          type: 'error',
          requestId: reqId,
          code: 'validation_error',
          message: 'Invalid message',
          details: parsed.error.format(),
        });
        baseLogger.warn(
          { socketId: socket.id, requestId: reqId },
          'ws validation error',
        );
        return;
      }

      const message = parsed.data;
      baseLogger.debug(
        {
          socketId: socket.id,
          requestId: message.requestId,
          type: message.type,
        },
        'ws message received',
      );

      try {
        switch (message.type) {
          case 'subscribe_sidebar':
            hub.subscribeSidebar(socket, message.requestId);
            break;
          case 'unsubscribe_sidebar':
            hub.unsubscribeSidebar(socket, message.requestId);
            break;
          case 'subscribe_conversation':
            hub.subscribeConversation(
              socket,
              message.requestId,
              message.conversationId,
            );
            break;
          case 'unsubscribe_conversation':
            hub.unsubscribeConversation(
              socket,
              message.requestId,
              message.conversationId,
            );
            break;
          case 'cancel_inflight':
            hub.cancelInflight({
              socket,
              requestId: message.requestId,
              conversationId: message.conversationId,
              inflightId: message.inflightId,
            });
            break;
        }
      } catch (err) {
        baseLogger.error(
          { err, socketId: socket.id, requestId: message.requestId },
          'ws handler error',
        );
        sendError(socket, {
          type: 'error',
          requestId: message.requestId,
          code: 'internal_error',
          message: 'Internal error',
        });
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      sockets.delete(ws);
      hub.onSocketClose(socket);
      baseLogger.info(
        { socketId: socket.id, wsPath: path, code, reason: reason.toString() },
        'ws connection closed',
      );
    });
  });

  wss.on('error', (err: Error) => {
    baseLogger.error({ err, wsPath: path }, 'ws server error');
  });

  return {
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch {
            // best-effort
          }
        }
        wss.close(() => resolve());
      }),
  };
}
