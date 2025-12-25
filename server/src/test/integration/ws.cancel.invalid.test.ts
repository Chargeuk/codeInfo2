import assert from 'node:assert/strict';
import test from 'node:test';

import { getInflightRegistry } from '../../ws/inflightRegistry.js';
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

test('cancel_inflight invalid ids return stable not_found error', async () => {
  const server = await startWsTestServer();
  try {
    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);

    sendJson(ws, {
      type: 'cancel_inflight',
      requestId: 'r1',
      conversationId: 'nope',
      inflightId: 'i1',
    });
    const first = await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'error' && m.code === 'not_found',
    );
    assert.equal(messageString(first, 'requestId'), 'r1');

    const inflight = getInflightRegistry();
    inflight.createOrGetActive({ conversationId: 'c1', inflightId: 'i1' });

    sendJson(ws, {
      type: 'cancel_inflight',
      requestId: 'r2',
      conversationId: 'c1',
      inflightId: 'wrong',
    });
    const second = await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'error' && m.code === 'not_found',
    );
    assert.equal(messageString(second, 'requestId'), 'r2');
  } finally {
    await server.close();
  }
});
