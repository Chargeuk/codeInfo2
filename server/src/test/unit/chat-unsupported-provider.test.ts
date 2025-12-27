import assert from 'node:assert/strict';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';

import { UnsupportedProviderError } from '../../chat/factory.js';

test('REST /chat responds 400 for unsupported provider from factory', async () => {
  const originalBase = process.env.LMSTUDIO_BASE_URL;
  process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';

  const { createChatRouter } = await import('../../routes/chat.js');

  const app = express();
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: () => ({}) as unknown as LMStudioClient,
      toolFactory: () => ({ tools: [] }),
      codexFactory: undefined,
      chatFactory: () => {
        throw new UnsupportedProviderError('bogus');
      },
    }),
  );

  const res = await request(app).post('/chat').send({
    model: 'm',
    message: 'hi',
    conversationId: 'c1',
    provider: 'lmstudio',
  });

  if (originalBase === undefined) {
    delete process.env.LMSTUDIO_BASE_URL;
  } else {
    process.env.LMSTUDIO_BASE_URL = originalBase;
  }

  assert.equal(res.status, 400);
  assert.equal(res.body.status, 'error');
  assert.equal(res.body.code, 'UNSUPPORTED_PROVIDER');
  assert.match(res.body.message, /Unsupported chat provider: bogus/);
});
