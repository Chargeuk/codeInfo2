import assert from 'node:assert/strict';
import test from 'node:test';

import {
  messageType,
  openWs,
  startWsTestServer,
  type WsJson,
  waitForMessage,
  waitForOpen,
} from './wsTestUtils.js';

test('ws rejects invalid json with stable error', async () => {
  const server = await startWsTestServer();
  try {
    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);

    ws.send('{');
    const err = await waitForMessage<WsJson>(
      ws,
      (msg) => messageType(msg) === 'error' && msg.code === 'invalid_json',
    );

    assert.equal(err.message, 'Invalid JSON');
  } finally {
    await server.close();
  }
});
