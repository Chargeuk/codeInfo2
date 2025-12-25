import assert from 'node:assert/strict';
import test from 'node:test';

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

test('ws connect/disconnect cleans up subscriptions', async () => {
  const server = await startWsTestServer();
  try {
    const ws1 = openWs(server.wsUrl);
    const ws2 = openWs(server.wsUrl);
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    sendJson(ws1, { type: 'subscribe_sidebar', requestId: 'r1' });
    sendJson(ws2, { type: 'subscribe_sidebar', requestId: 'r2' });
    await Promise.all([
      waitForMessage<WsJson>(
        ws1,
        (m) =>
          messageType(m) === 'ack' && messageString(m, 'requestId') === 'r1',
      ),
      waitForMessage<WsJson>(
        ws2,
        (m) =>
          messageType(m) === 'ack' && messageString(m, 'requestId') === 'r2',
      ),
    ]);

    sendJson(ws1, {
      type: 'subscribe_conversation',
      requestId: 'r3',
      conversationId: 'c1',
    });
    sendJson(ws2, {
      type: 'subscribe_conversation',
      requestId: 'r4',
      conversationId: 'c1',
    });

    await Promise.all([
      waitForMessage<WsJson>(
        ws1,
        (m) =>
          messageType(m) === 'ack' && messageString(m, 'requestId') === 'r3',
      ),
      waitForMessage<WsJson>(
        ws2,
        (m) =>
          messageType(m) === 'ack' && messageString(m, 'requestId') === 'r4',
      ),
    ]);

    ws1.close();
    ws2.close();
    await Promise.all([
      new Promise<void>((resolve) => ws1.once('close', () => resolve())),
      new Promise<void>((resolve) => ws2.once('close', () => resolve())),
    ]);

    assert.deepEqual(server.hub.__debugCounts(), {
      sidebarSubscribers: 0,
      conversationTopics: 0,
      conversationSubscriptions: 0,
    });
  } finally {
    await server.close();
  }
});
