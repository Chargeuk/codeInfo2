import assert from 'assert';
import type { Server } from 'http';
import {
  fetchLmStudioStatus,
  type LmStudioStatusResponse,
} from '@codeinfo2/common';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import express from 'express';
import { createLmStudioRouter } from '../../routes/lmstudio.ts';
import {
  MockLMStudioClient,
  type MockScenario,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.ts';

let server: Server | null = null;
let baseUrl = '';
let response: { status: number; body: LmStudioStatusResponse | null } | null =
  null;

Before(async () => {
  const app = express();
  app.use(cors());
  app.use(
    '/',
    createLmStudioRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
    }),
  );

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

Given('LM Studio scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

When('I GET {string}', async (path: string) => {
  assert.equal(path, '/lmstudio/status');
  try {
    const body = await fetchLmStudioStatus({
      serverBaseUrl: baseUrl,
      lmBaseUrl: 'http://localhost:1234',
    });
    response = { status: 200, body };
  } catch (err) {
    const error = err as { status?: unknown; body?: unknown };
    response = {
      status:
        typeof error.status === 'number'
          ? error.status
          : Number(error.status) || 500,
      body: (error.body as LmStudioStatusResponse | undefined) ?? null,
    };
  }
});

Then('the response status code is {int}', (status: number) => {
  assert(response, 'expected response');
  assert.equal(response.status, status);
});

Then(
  'the JSON field {string} equals {string}',
  (field: string, expected: string) => {
    assert(response?.body, 'expected response body');
    const value = (response.body as Record<string, unknown>)[field];
    assert.equal(String(value), expected);
  },
);

Then(
  'the JSON array {string} has length {int}',
  (field: string, expected: number) => {
    assert(response?.body, 'expected response body');
    const arr = (response.body as Record<string, unknown>)[field];
    assert(Array.isArray(arr), `expected ${field} to be array`);
    assert.equal((arr as unknown[]).length, expected);
  },
);
