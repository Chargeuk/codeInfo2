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
import cors from 'cors';
import express from 'express';
import {
  clearLockedModel,
  clearRootsCollection,
} from '../../ingest/chromaClient.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import {
  MockLMStudioClient,
  type MockScenario,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

let server: Server | null = null;
let baseUrl = '';
let response: { status: number; body: unknown } | null = null;
let tempDir: string | null = null;
let lastRunId: string | null = null;

Before(async () => {
  setDefaultTimeout(10000);
  process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
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
  app.use('/', createIngestRootsRouter());

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
  response = null;
  lastRunId = null;
  await clearRootsCollection();
  await clearLockedModel();
});

Given('ingest roots chroma stub is empty', async () => {
  await clearRootsCollection();
  await clearLockedModel();
});

Given('ingest roots models scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

Given(
  'ingest roots temp repo with file {string} containing {string}',
  async (rel: string, content: string) => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-roots-'));
    const filePath = path.join(tempDir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  },
);

When('I POST ingest roots start with model {string}', async (model: string) => {
  if (!tempDir) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-roots-'));
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

When('I GET ingest roots', async () => {
  const res = await fetch(`${baseUrl}/ingest/roots`);
  response = { status: res.status, body: await res.json() };
});

Then(
  'ingest roots status for the last run becomes {string}',
  async (state: string) => {
    assert(lastRunId, 'runId missing');
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
      const body = await res.json();
      console.log(
        `[ingest-roots] poll ${i} runId=${lastRunId} state=${body.state} message=${body.message ?? ''}`,
      );
      if (body.state === state || body.state === 'error') return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`did not reach state ${state}`);
  },
);

Then('ingest roots response status is {int}', (status: number) => {
  assert(response, 'expected response');
  assert.equal(response.status, status);
});

Then('ingest roots response has {int} root', (count: number) => {
  assert(response, 'expected response');
  const roots = (response.body as { roots?: unknown[] }).roots ?? [];
  assert.equal(roots.length, count);
});

Then('ingest roots response has {int} roots', (count: number) => {
  assert(response, 'expected response');
  const roots = (response.body as { roots?: unknown[] }).roots ?? [];
  assert.equal(roots.length, count);
});

Then('ingest roots first item path is the temp repo', () => {
  assert(response, 'expected response');
  const roots = (response.body as { roots?: unknown[] }).roots ?? [];
  assert(roots.length > 0, 'no roots returned');
  assert(tempDir, 'temp dir missing');
  assert.equal((roots[0] as { path?: string }).path, tempDir);
});

Then('ingest roots first item status is {string}', (status: string) => {
  assert(response, 'expected response');
  const roots = (response.body as { roots?: unknown[] }).roots ?? [];
  assert(roots.length > 0, 'no roots returned');
  assert.equal((roots[0] as { status?: string }).status, status);
});
