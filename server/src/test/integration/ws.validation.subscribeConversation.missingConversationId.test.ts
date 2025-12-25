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

test('ws rejects subscribe_conversation missing conversationId', async () => {
  const server = await startWsTestServer();
  try {
    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);

    sendJson(ws, { type: 'subscribe_conversation', requestId: 'r1' });

    const err = await waitForMessage<WsJson>(
      ws,
      (msg) => messageType(msg) === 'error' && msg.code === 'validation_error',
    );
    assert.equal(messageString(err, 'requestId'), 'r1');
  } finally {
    await server.close();
  }
});
