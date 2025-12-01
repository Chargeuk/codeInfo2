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
import { ChromaClient } from 'chromadb';
import cors from 'cors';
import express from 'express';
import {
  deleteVectorsCollection,
  clearRootsCollection,
} from '../../ingest/chromaClient.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { MockLMStudioClient, stopMock } from '../support/mockLmStudioSdk.js';

const VECTOR_COLLECTION = process.env.INGEST_COLLECTION ?? 'ingest_vectors';

let server: Server | null = null;
let baseUrl = '';
let lastRunId: string | null = null;
let tempDir: string | null = null;
type StatusBody = { state?: string; counts?: { embedded?: number } };

setDefaultTimeout(20_000);

async function vectorsState() {
  const client = new ChromaClient({
    path: process.env.CHROMA_URL ?? 'http://localhost:8000',
  });
  const collections = await client.listCollections();
  const exists = collections.some((c) => c.name === VECTOR_COLLECTION);
  if (!exists) return { exists: false, count: 0 };
  const collection = await client.getCollection({ name: VECTOR_COLLECTION });
  const count = await collection.count();
  return { exists: true, count };
}

Before(async () => {
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(createRequestLogger());

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
  await deleteVectorsCollection();
  await clearRootsCollection();
  lastRunId = null;
});

Given(
  'a temp repo for dry-run with file {string} containing {string}',
  async (rel: string, content: string) => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-dryrun-'));
    const filePath = path.join(tempDir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  },
);

When('I start a dry-run ingest for that repo', async () => {
  assert(tempDir, 'temp dir missing');
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
  const body = await res.json();
  assert.equal(res.status, 202);
  lastRunId = (body as { runId?: string }).runId ?? null;
  assert(lastRunId, 'runId missing');
});

Then(
  'the dry-run run completes with embedded chunks and no vectors stored',
  async () => {
    assert(lastRunId, 'runId missing');
    let finalState: StatusBody | null = null;
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
      const body = await res.json();
      finalState = body as StatusBody;
      if (body.state === 'completed' || body.state === 'error') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(finalState, 'status missing');
    assert.equal(finalState?.state, 'completed');
    assert(finalState?.counts?.embedded && finalState.counts.embedded > 0);

    const state = await vectorsState();
    assert.equal(state.count, 0);
  },
);
