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
  clearVectorsCollection,
} from '../../ingest/chromaClient.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import {
  MockLMStudioClient,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

setDefaultTimeout(15_000);

let server: Server | null = null;
let baseUrl = '';
let response: { status: number; body: unknown } | null = null;
let tempDir: string | null = null;

Before(async () => {
  process.env.CHROMA_URL = 'mock:';
  process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
  startMock({ scenario: 'many' });

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
  await clearRootsCollection();
  await clearVectorsCollection();
});

Given(
  'the ingest start test server is running with mock chroma and lmstudio',
  () => {
    assert.ok(server, 'server should be running');
  },
);

Given('ingest chroma stores are empty', async () => {
  await clearLockedModel();
  await clearRootsCollection();
  await clearVectorsCollection();
});

When('I POST the ingest start endpoint with JSON body', async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-body-'));
  const filePath = path.join(tempDir, 'readme.md');
  await fs.writeFile(filePath, '# sample');

  const res = await fetch(`${baseUrl}/ingest/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      path: tempDir,
      name: 'tmp',
      model: 'embed-1',
      dryRun: true,
    }),
  });

  response = { status: res.status, body: await res.json() };
});

Then('the response status should be 202', () => {
  assert.ok(response, 'response should be present');
  assert.equal(response?.status, 202);
});

Then('the response body should contain a runId', () => {
  const body = response?.body as { runId?: string } | undefined;
  assert.ok(body?.runId, 'runId should be defined');
  assert.equal(typeof body?.runId, 'string');
});
