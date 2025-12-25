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

test('sidebar seq is monotonically increasing per socket', async () => {
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
      title: 'One',
      provider: 'codex',
      model: 'm',
      source: 'REST',
      lastMessageAt: new Date('2025-01-01T00:00:00Z'),
      archived: false,
    });

    const first = await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'conversation_upsert',
    );
    server.hub.emitConversationUpsert({
      conversationId: 'c2',
      title: 'Two',
      provider: 'codex',
      model: 'm',
      source: 'REST',
      lastMessageAt: new Date('2025-01-02T00:00:00Z'),
      archived: false,
    });
    const second = await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'conversation_upsert' &&
        (m.conversation as Record<string, unknown> | undefined)
          ?.conversationId === 'c2',
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
