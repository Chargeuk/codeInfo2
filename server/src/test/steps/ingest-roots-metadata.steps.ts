import '../support/chromaContainer.js';
import '../support/mockLmStudioSdk.js';
import assert from 'assert';
import type { Server } from 'http';
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
  getRootsCollection,
} from '../../ingest/chromaClient.js';
import { setIngestDeps } from '../../ingest/ingestJob.js';
import { createRequestLogger } from '../../logger.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import {
  MockLMStudioClient,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';

setDefaultTimeout(15_000);

let server: Server | null = null;
let baseUrl = '';
let response: { status: number; body: unknown } | null = null;

Before(async () => {
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';
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
  await clearLockedModel();
  await clearRootsCollection();
  await clearVectorsCollection();
});

Given(
  'the ingest roots test server is running with test chroma and lmstudio',
  () => {
    assert.ok(server, 'server should be running');
  },
);

// Alias used in feature text
Given(
  'the ingest roots test server is running with mock chroma and lmstudio',
  () => {
    assert.ok(server, 'server should be running');
  },
);

Given('ingest roots chroma stores are empty', async () => {
  await clearLockedModel();
  await clearRootsCollection();
  await clearVectorsCollection();
});

Given('ingest roots chroma has root metadata with ast counts', async () => {
  const roots = await getRootsCollection();
  const now = new Date().toISOString();
  await roots.add({
    ids: ['run-ast'],
    embeddings: [[0]],
    metadatas: [
      {
        runId: 'run-ast',
        root: '/repo/ast',
        name: 'ast-root',
        model: 'embed-1',
        files: 2,
        chunks: 3,
        embedded: 3,
        state: 'completed',
        lastIngestAt: now,
        ingestedAtMs: Date.now(),
        astSupportedFileCount: 4,
        astSkippedFileCount: 1,
        astFailedFileCount: 2,
        astLastIndexedAt: now,
      },
    ],
  });
});

Given('ingest roots chroma has root metadata without ast counts', async () => {
  const roots = await getRootsCollection();
  const now = new Date().toISOString();
  await roots.add({
    ids: ['run-no-ast'],
    embeddings: [[0]],
    metadatas: [
      {
        runId: 'run-no-ast',
        root: '/repo/no-ast',
        name: 'no-ast-root',
        model: 'embed-1',
        files: 1,
        chunks: 1,
        embedded: 1,
        state: 'completed',
        lastIngestAt: now,
        ingestedAtMs: Date.now(),
      },
    ],
  });
});

When('I GET the ingest roots endpoint', async () => {
  const res = await fetch(`${baseUrl}/ingest/roots`);
  response = { status: res.status, body: await res.json() };
});

Then('the response status should be 200', () => {
  assert.ok(response, 'response should be present');
  assert.equal(response?.status, 200);
});

Then('the response body should include empty roots and no locked model', () => {
  const body = response?.body as { roots?: unknown; lockedModelId?: unknown };
  assert.ok(body, 'response body required');
  assert.ok(Array.isArray(body.roots), 'roots should be array');
  assert.equal((body.roots as unknown[]).length, 0);
  assert.ok(
    body.lockedModelId === null || typeof body.lockedModelId === 'undefined',
    'lockedModelId should be null or undefined',
  );
});

Then('the response body should include ast counts for the root', () => {
  const body = response?.body as { roots?: unknown[] };
  assert.ok(body?.roots, 'roots should be present');
  assert.equal(body.roots?.length, 1);
  const root = body.roots?.[0] as {
    ast?: {
      supportedFileCount?: number;
      skippedFileCount?: number;
      failedFileCount?: number;
      lastIndexedAt?: string | null;
    };
  };
  assert.ok(root.ast, 'ast should be present');
  assert.equal(root.ast?.supportedFileCount, 4);
  assert.equal(root.ast?.skippedFileCount, 1);
  assert.equal(root.ast?.failedFileCount, 2);
  assert.ok(
    typeof root.ast?.lastIndexedAt === 'string',
    'lastIndexedAt should be string',
  );
});

Then(
  'the response body should include root metadata without ast counts',
  () => {
    const body = response?.body as { roots?: unknown[] };
    assert.ok(body?.roots, 'roots should be present');
    assert.equal(body.roots?.length, 1);
    const root = body.roots?.[0] as { ast?: unknown };
    assert.equal(root.ast, undefined);
  },
);
