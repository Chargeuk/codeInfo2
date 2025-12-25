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

test('bulk delete emits sidebar delete only after repo transaction resolves', async () => {
  let allowResolve: (() => void) | undefined;
  const allow = new Promise<void>((resolve) => {
    allowResolve = resolve;
  });

  const server = await startWsTestServer({
    mount: (app) => {
      app.use(
        createConversationsRouter({
          bulkDeleteArchivedConversations: async () => {
            await allow;
            return { ok: true, deletedConversationIds: ['c1'] } as never;
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

    const httpPromise = fetch(`${server.baseUrl}/conversations/bulk/delete`, {
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
        messageType(m) === 'conversation_delete' &&
        messageString(m, 'conversationId') === 'c1',
    );
  } finally {
    await server.close();
  }
});
