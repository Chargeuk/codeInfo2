import assert from 'node:assert/strict';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';

test('REST /chat rejects actually unsupported provider names', async () => {
  const originalBase = process.env.CODEINFO_LMSTUDIO_BASE_URL;
  process.env.CODEINFO_LMSTUDIO_BASE_URL = 'http://localhost:1234';

  const { createChatRouter } = await import('../../routes/chat.js');

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: () =>
        ({
          system: {
            listDownloadedModels: async () => [{ modelKey: 'm', type: 'llm' }],
          },
        }) as unknown as LMStudioClient,
      toolFactory: () => ({ tools: [] }),
      codexFactory: undefined,
    }),
  );

  const res = await request(app).post('/chat').send({
    model: 'm',
    message: 'hi',
    conversationId: 'c1',
    provider: 'bad-provider',
  });

  if (originalBase === undefined) {
    delete process.env.CODEINFO_LMSTUDIO_BASE_URL;
  } else {
    process.env.CODEINFO_LMSTUDIO_BASE_URL = originalBase;
  }

  assert.equal(res.status, 400);
  assert.equal(res.body.status, 'error');
  assert.equal(res.body.code, 'VALIDATION_FAILED');
  assert.match(
    res.body.message,
    /provider must be one of: codex, copilot, lmstudio/,
  );
});
