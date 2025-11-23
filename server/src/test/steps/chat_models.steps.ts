import assert from 'assert';
import type { Server } from 'http';
import { mockModels } from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { createRequestLogger } from '../../logger.js';
import { createChatModelsRouter } from '../../routes/chatModels.js';
import { createLogsRouter } from '../../routes/logs.js';
import {
  MockLMStudioClient,
  type MockScenario,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

let server: Server | null = null;
let baseUrl = '';
let response: { status: number; body: unknown | null } | null = null;

Before(async () => {
  process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
  const app = express();
  app.use(cors());
  app.use(createRequestLogger());
  app.use((req, res, next) => {
    const requestId = (req as unknown as { id?: string }).id;
    if (requestId) res.locals.requestId = requestId;
    next();
  });
  app.use(
    '/chat',
    createChatModelsRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
    }),
  );
  app.use('/logs', createLogsRouter());

  await new Promise<void>((resolve) => {
    const listener = app.listen(0, () => {
      server = listener;
      const address = listener.address();
      if (!address || typeof address === 'string') {
        throw new Error('Unable to start test server');
      }
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });
});

After(() => {
  stopMock();
  if (server) {
    server.close();
    server = null;
  }
});

Given('chat models scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

When('I request chat models', async () => {
  const res = await fetch(`${baseUrl}/chat/models`);
  response = { status: res.status, body: await res.json() };
});

Then('the chat models response status code is {int}', (status: number) => {
  assert(response, 'expected response');
  assert.equal(response.status, status);
});

Then('the chat models body equals the mock models fixture', () => {
  assert(response, 'expected response');
  assert.deepStrictEqual(response.body, mockModels);
});

Then(
  'the chat models field {string} equals {string}',
  (field: string, expected: string) => {
    assert(response?.body, 'expected response body');
    const value = (response.body as Record<string, unknown>)[field];
    assert.equal(String(value), expected);
  },
);
