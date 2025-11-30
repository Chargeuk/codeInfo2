import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { type LMStudioClient, type Tool } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';
import { createChatRouter } from '../../routes/chat.js';

const fakeTool = {
  name: 'FakeTool',
  description: 'fake',
  parameters: {},
  implementation: async () => ({ ok: true }),
} as unknown as Tool;

test('chat router injects LM Studio tools into act call', async () => {
  const act = mock.fn(async () => undefined);
  const toolFactory = mock.fn(() => ({
    listIngestedRepositoriesTool: fakeTool,
    vectorSearchTool: fakeTool,
    tools: [fakeTool, fakeTool] as const,
  }));

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: () =>
        ({
          llm: {
            model: async () => ({ act }),
          },
        }) as unknown as LMStudioClient,
      toolFactory,
    }),
  );

  process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';

  const res = await request(app)
    .post('/chat')
    .send({ model: 'demo', messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(res.status, 200);
  assert.equal(toolFactory.mock.calls.length, 1);
  const actCalls = act.mock.calls as unknown as Array<{ arguments: unknown[] }>;
  const passedTools = (actCalls[0]?.arguments?.[1] ?? []) as unknown[];
  assert.equal(Array.isArray(passedTools), true);
  assert.equal(passedTools.length, 3);
});
