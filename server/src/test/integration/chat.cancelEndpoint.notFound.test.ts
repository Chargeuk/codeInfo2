import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatCancelRouter } from '../../routes/chatCancel.js';
import { startWsTestServer } from './wsTestUtils.js';

test('POST /chat/cancel returns 404 when inflight not found', async () => {
  const server = await startWsTestServer({
    mount: (app) => {
      app.use('/chat', createChatCancelRouter());
    },
  });

  try {
    const res = await fetch(`${server.baseUrl}/chat/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'c1', inflightId: 'i1' }),
    });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
  } finally {
    await server.close();
  }
});
