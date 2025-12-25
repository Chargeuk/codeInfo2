import assert from 'node:assert/strict';
import test from 'node:test';

import type WebSocket from 'ws';

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

test('subscribe_sidebar delivers events and unsubscribe_sidebar stops them', async () => {
  const server = await startWsTestServer();
  try {
    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);

    sendJson(ws, { type: 'subscribe_sidebar', requestId: 'r1' });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r1',
    );

    server.hub.emitConversationUpsert({
      conversationId: 'c1',
      title: 'Hello',
      provider: 'codex',
      model: 'm1',
      source: 'REST',
      lastMessageAt: new Date('2025-01-01T00:00:00Z'),
      archived: false,
    });

    const first = await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'conversation_upsert' &&
        (m.conversation as Record<string, unknown> | undefined)
          ?.conversationId === 'c1',
    );
    assert.equal(typeof first.seq, 'number');

    sendJson(ws, { type: 'unsubscribe_sidebar', requestId: 'r2' });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r2',
    );

    server.hub.emitConversationUpsert({
      conversationId: 'c2',
      title: 'Later',
      provider: 'codex',
      model: 'm1',
      source: 'REST',
      lastMessageAt: new Date('2025-01-02T00:00:00Z'),
      archived: false,
    });

    await expectNoMessage(ws);
  } finally {
    await server.close();
  }
});
