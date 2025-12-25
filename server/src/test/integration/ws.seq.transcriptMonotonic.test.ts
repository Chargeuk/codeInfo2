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

test('transcript seq is monotonically increasing per conversation', async () => {
  const server = await startWsTestServer();
  try {
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

    server.hub.assistantDelta({
      conversationId: 'c1',
      inflightId: 'i1',
      delta: 'a',
    });
    const first = await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'assistant_delta',
    );

    server.hub.assistantDelta({
      conversationId: 'c1',
      inflightId: 'i1',
      delta: 'b',
    });
    const second = await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'assistant_delta' && m.delta === 'b',
    );

    assert.equal(typeof first.seq, 'number');
    assert.equal(typeof second.seq, 'number');
    const firstSeq = first.seq as number;
    const secondSeq = second.seq as number;
    assert.equal(secondSeq > firstSeq, true);
  } finally {
    await server.close();
  }
});
