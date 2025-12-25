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

test('subscribe_conversation sends inflight_snapshot catch-up when run in progress', async () => {
  const server = await startWsTestServer();
  try {
    const inflight = getInflightRegistry();
    const started = inflight.createOrGetActive({
      conversationId: 'c1',
      inflightId: 'i1',
    });
    assert.equal(started.inflightId, 'i1');

    inflight.appendAssistantDelta('c1', 'i1', 'Hello');
    inflight.appendAnalysisDelta('c1', 'i1', 'Thinking');
    inflight.updateToolState('c1', 'i1', {
      id: 't1',
      name: 'VectorSearch',
      status: 'requesting',
      stage: 'started',
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

    const snap = await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'inflight_snapshot' && m.conversationId === 'c1',
    );

    assert.equal(typeof snap.inflight, 'object');
    assert.equal(snap.inflight !== null, true);
    const inflightSnap = snap.inflight as Record<string, unknown>;
    assert.equal(inflightSnap.inflightId, 'i1');
    assert.equal(inflightSnap.assistantText, 'Hello');
    assert.equal(inflightSnap.analysisText, 'Thinking');
    assert.equal(Array.isArray(inflightSnap.tools), true);
    const tools = inflightSnap.tools as unknown[];
    assert.equal(
      (tools[0] as Record<string, unknown> | undefined)?.id,
      't1',
    );
  } finally {
    await server.close();
  }
});
