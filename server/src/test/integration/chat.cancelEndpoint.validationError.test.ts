import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatCancelRouter } from '../../routes/chatCancel.js';
import { startWsTestServer } from './wsTestUtils.js';

test('POST /chat/cancel rejects invalid body with validation_error', async () => {
  const server = await startWsTestServer({
    mount: (app) => {
      app.use('/chat', createChatCancelRouter());
    },
  });

  try {
    const res = await fetch(`${server.baseUrl}/chat/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'c1' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'validation_error');
  } finally {
    await server.close();
  }
});
