import assert from 'node:assert/strict';
import test from 'node:test';

import type { LMStudioClient } from '@lmstudio/sdk';

import { createChatRouter } from '../../routes/chat.js';
import { startWsTestServer } from './wsTestUtils.js';

test('POST /chat rejects invalid cancelOnDisconnect types', async () => {
  const server = await startWsTestServer({
    mount: (app) => {
      app.use(
        '/chat',
        createChatRouter({
          clientFactory: () => ({}) as unknown as LMStudioClient,
        }),
      );
    },
  });

  try {
    const res = await fetch(`${server.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        conversationId: 'c1',
        message: 'Hi',
        cancelOnDisconnect: 'nope',
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid request');
  } finally {
    await server.close();
  }
});
