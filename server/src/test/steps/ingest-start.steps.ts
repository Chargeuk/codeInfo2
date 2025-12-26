import '../support/chromaContainer.js';
import '../support/mockLmStudioSdk.js';
import assert from 'assert';
import fs from 'fs/promises';
import type { Server } from 'http';
import os from 'os';
import path from 'path';
import {
  After,
  Before,
  Given,
  Then,
  When,
  setDefaultTimeout,
} from '@cucumber/cucumber';
import type { LMStudioClient } from '@lmstudio/sdk';
setDefaultTimeout(10000);
import cors from 'cors';
import express from 'express';
import { clearLockedModel, setLockedModel } from '../../ingest/chromaClient.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { createLogsRouter } from '../../routes/logs.js';
import {
  MockLMStudioClient,
  type MockScenario,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

let server: Server | null = null;
let baseUrl = '';
let response: { status: number; body: unknown } | null = null;
let lastRunId: string | null = null;
let tempDir: string | null = null;

Before(async () => {
  setDefaultTimeout(10000);
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(createRequestLogger());
  app.use((req, res, next) => {
    const requestId = (req as unknown as { id?: string }).id;
    if (requestId) res.locals.requestId = requestId;
    next();
  });

  setIngestDeps({
    lmClientFactory: () =>
      new MockLMStudioClient() as unknown as LMStudioClient,
    baseUrl: process.env.LMSTUDIO_BASE_URL ?? '',
  });

  app.use(
    '/',
    createIngestStartRouter({
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

After(async () => {
  stopMock();
  if (server) {
    server.close();
    server = null;
  }
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  await clearLockedModel();
});

Given('chroma stub is empty', async () => {
  await clearLockedModel();
});

Given('chroma stub locked to {string}', async (modelId: string) => {
  await setLockedModel(modelId);
});

Given('ingest start models scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

Given(
  'temp repo with file {string} containing {string}',
  async (rel: string, content: string) => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-start-'));
    const filePath = path.join(tempDir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  },
);

When('I POST ingest start with model {string}', async (model: string) => {
  if (!tempDir) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-start-'));
  }
  const res = await fetch(`${baseUrl}/ingest/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: tempDir, name: 'tmp', model }),
  });
  response = { status: res.status, body: await res.json() };
  if (response.status === 202) {
    lastRunId = (response.body as { runId?: string }).runId ?? null;
  }
});

When(
  'I POST ingest start with model {string} and dryRun',
  async (model: string) => {
    if (!tempDir) {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-start-'));
    }
    const res = await fetch(`${baseUrl}/ingest/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tempDir, name: 'tmp', model, dryRun: true }),
    });
    response = { status: res.status, body: await res.json() };
    if (response.status === 202) {
      lastRunId = (response.body as { runId?: string }).runId ?? null;
    }
  },
);

Then('the ingest start status code is {int}', (status: number) => {
  assert(response, 'expected response');
  assert.equal(response.status, status);
});

Then(
  'ingest status for the last run becomes {string}',
  async (state: string) => {
    assert(lastRunId, 'runId missing');
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
      const body = await res.json();
      if (body.state === state || body.state === 'error') return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`did not reach state ${state}`);
  },
);

Then('ingest status embedded count is {int}', async (expected: number) => {
  assert(lastRunId, 'runId missing');
  const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
  const body = await res.json();
  assert.equal(body.counts.embedded, expected);
});
