import '../support/chromaContainer.js';
import '../support/mockLmStudioSdk.js';
import assert from 'assert';
import type { Server } from 'http';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { OpenAiEmbeddingError } from '../../ingest/providers/index.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestModelsRouter } from '../../routes/ingestModels.js';
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
let openAiScenario:
  | 'ok'
  | 'disabled'
  | 'transient-failure'
  | 'allowlist-no-match' = 'ok';

Before(async () => {
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';
  process.env.OPENAI_EMBEDDING_KEY = 'sk-test';
  openAiScenario = 'ok';
  const app = express();
  app.use(cors());
  app.use(createRequestLogger());
  app.use((req, res, next) => {
    const requestId = (req as unknown as { id?: string }).id;
    if (requestId) res.locals.requestId = requestId;
    next();
  });

  app.use(
    '/',
    createIngestModelsRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
      openAiListModels: async () => {
        if (openAiScenario === 'disabled') {
          throw new Error('OpenAI list should not be called when disabled');
        }
        if (openAiScenario === 'transient-failure') {
          throw new OpenAiEmbeddingError(
            'OPENAI_TIMEOUT',
            'timeout',
            true,
            408,
            2000,
          );
        }
        if (openAiScenario === 'allowlist-no-match') {
          return [{ id: 'text-embedding-ada-002' }];
        }
        return [{ id: 'text-embedding-3-small' }];
      },
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

Given('ingest models scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

Given('ingest models OpenAI scenario {string}', (name: string) => {
  const next = name as typeof openAiScenario;
  openAiScenario = next;
  if (next === 'disabled') {
    process.env.OPENAI_EMBEDDING_KEY = '   ';
  } else {
    process.env.OPENAI_EMBEDDING_KEY = 'sk-test';
  }
});

When('I request ingest models', async () => {
  const res = await fetch(`${baseUrl}/ingest/models`);
  response = { status: res.status, body: await res.json() };
});

Then('the ingest models response status code is {int}', (status: number) => {
  assert(response, 'expected response');
  assert.equal(response.status, status);
});

Then('the ingest models body has {int} model', (count: number) => {
  assert(response?.body, 'expected response body');
  const models = (response.body as { models?: unknown[] }).models;
  assert(Array.isArray(models), 'models should be array');
  assert.equal(models.length, count);
});

Then(
  'the ingest models field {string} equals {string}',
  (field: string, expected: string) => {
    assert(response?.body, 'expected response body');
    const value = (response.body as Record<string, unknown>)[field];
    assert.equal(String(value), expected);
  },
);

Then(
  'the ingest models path {string} equals {string}',
  (path: string, expected: string) => {
    assert(response?.body, 'expected response body');
    const value = path
      .split('.')
      .reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[key]
            : undefined,
        response.body as unknown,
      );
    assert.equal(String(value), expected);
  },
);
