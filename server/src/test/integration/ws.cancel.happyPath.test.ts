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

test('cancel_inflight aborts and emits turn_final stopped', async () => {
  const server = await startWsTestServer();
  try {
    let cancelCalled = false;
    const inflight = getInflightRegistry();
    inflight.createOrGetActive({
      conversationId: 'c1',
      inflightId: 'i1',
      cancelFn: () => {
        cancelCalled = true;
      },
    });

    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);

    sendJson(ws, {
      type: 'subscribe_conversation',
      requestId: 'r1',
      conversationId: 'c1',
    });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r1',
    );
    await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'inflight_snapshot' && m.conversationId === 'c1',
    );

    sendJson(ws, {
      type: 'cancel_inflight',
      requestId: 'r2',
      conversationId: 'c1',
      inflightId: 'i1',
    });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r2',
    );
    const final = await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'turn_final' && m.status === 'stopped',
    );

    assert.equal(final.inflightId, 'i1');
    assert.equal(cancelCalled, true);
  } finally {
    await server.close();
  }
});
