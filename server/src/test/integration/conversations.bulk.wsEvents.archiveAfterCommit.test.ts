import test from 'node:test';

import type WebSocket from 'ws';

import { createConversationsRouter } from '../../routes/conversations.js';
import {
  messageString,
  messageType,
  openWs,
  sendJson,
  startWsTestServer,
  type WsJson,
  waitForMessage,
  waitForOpen,
} from './wsTestUtils.js';

async function expectNoMessage(ws: WebSocket, ms = 200) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      resolve();
    }, ms);

    const onMessage = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      reject(new Error('unexpected message'));
    };

    ws.on('message', onMessage);
  });
}

test('bulk archive emits sidebar upsert only after repo transaction resolves', async () => {
  let allowResolve: (() => void) | undefined;
  const allow = new Promise<void>((resolve) => {
    allowResolve = resolve;
  });

  const server = await startWsTestServer({
    mount: (app) => {
      app.use(
        createConversationsRouter({
          bulkArchiveConversations: async () => {
            await allow;
            return {
              ok: true,
              conversations: [
                {
                  conversationId: 'c1',
                  provider: 'lmstudio',
                  model: 'm1',
                  title: 't1',
                  source: 'REST',
                  lastMessageAt: new Date('2025-01-01T00:00:00Z'),
                  archived: true,
                  flags: {},
                  createdAt: new Date('2025-01-01T00:00:00Z'),
                  updatedAt: new Date('2025-01-01T00:00:00Z'),
                },
              ],
            } as never;
          },
        }),
      );
    },
  });

  try {
    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);
    sendJson(ws, { type: 'subscribe_sidebar', requestId: 'r1' });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r1',
    );

    const httpPromise = fetch(`${server.baseUrl}/conversations/bulk/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationIds: ['c1'] }),
    });

    await expectNoMessage(ws);
    allowResolve?.();

    const res = await httpPromise;
    if (!res.ok) throw new Error(`http ${res.status}`);

    await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'conversation_upsert' &&
        (m.conversation as Record<string, unknown> | undefined)
          ?.conversationId === 'c1',
    );
  } finally {
    await server.close();
  }
});
