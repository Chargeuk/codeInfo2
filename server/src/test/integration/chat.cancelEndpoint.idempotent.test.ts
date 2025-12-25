import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatCancelRouter } from '../../routes/chatCancel.js';
import { getInflightRegistry } from '../../ws/inflightRegistry.js';
import { startWsTestServer } from './wsTestUtils.js';

test('POST /chat/cancel is idempotent', async () => {
  const server = await startWsTestServer({
    mount: (app) => {
      app.use('/chat', createChatCancelRouter());
    },
  });

  try {
    const inflight = getInflightRegistry();
    inflight.createOrGetActive({
      conversationId: 'c1',
      inflightId: 'i1',
      cancelFn: () => undefined,
    });

    const first = await fetch(`${server.baseUrl}/chat/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'c1', inflightId: 'i1' }),
    });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { status: 'ok' });

    const second = await fetch(`${server.baseUrl}/chat/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'c1', inflightId: 'i1' }),
    });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { status: 'ok' });
  } finally {
    await server.close();
  }
});
