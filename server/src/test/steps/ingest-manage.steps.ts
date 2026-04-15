import '../support/chromaContainer.js';
import '../support/mockLmStudioSdk.js';
import '../support/mongoContainer.js';
import assert from 'assert';
import fs from 'fs/promises';
import type { Server } from 'http';
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
import mongoose from 'mongoose';
import {
  clearLockedModel,
  clearRootsCollection,
  clearVectorsCollection,
  getRootsCollection,
  setLockedModel,
} from '../../ingest/chromaClient.js';
import {
  __resetIngestJobsForTest,
  __setQueueRuntimeOpsForTest,
  __setRunProcessorForTest,
  pumpIngestQueue,
  recoverIngestQueueOnStartup,
  setIngestDeps,
} from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import { query, resetStore } from '../../logStore.js';
import { createRequestLogger } from '../../logger.js';
import { IngestQueueRequestModel } from '../../mongo/ingestQueueRequest.js';
import { createIngestCancelRouter } from '../../routes/ingestCancel.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
import { createIngestRemoveRouter } from '../../routes/ingestRemove.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import {
  MockLMStudioClient,
  type MockScenario,
  releaseControlledEmbeddingCall,
  waitForControlledEmbeddingCalls,
  startMock,
  stopMock,
} from '../support/mockLmStudioSdk.js';
import { createTempRepoRoot } from '../support/tempRepoRoot.js';

let server: Server | null = null;
let baseUrl = '';
let response: { status: number; body: unknown } | null = null;
let tempDir: string | null = null;
let lastRunId: string | null = null;
let queueRuntimeStartedPaths: string[] = [];
let lastQueuePumpResult: {
  started: boolean;
  blockedByCleanup: boolean;
  requestId: string | null;
} | null = null;

function getRootsPayload() {
  assert(response, 'expected response');
  return (response.body as { roots?: unknown[] }).roots ?? [];
}

function findRootByPath(rootPath: string) {
  const roots = getRootsPayload();
  const entry = roots.find(
    (root) => (root as { path?: string }).path === rootPath,
  ) as
    | {
        path?: string;
        name?: string;
        requestId?: string | null;
        runId?: string | null;
        queueState?: string | null;
        queuePosition?: number | null;
      }
    | undefined;
  assert(entry, `expected root entry for ${rootPath}`);
  return entry;
}

async function seedQueuedReembedRequest(params: {
  rootPath: string;
  queueState: 'waiting' | 'running' | 'cleanup-blocked';
  runId?: string | null;
  requestPayloadPath?: string | null;
  nonReplayableAt?: Date;
  terminalPublishedAt?: Date;
  name?: string;
}) {
  const requestPayload: Record<string, unknown> = {
    name:
      params.name ?? (path.posix.basename(params.rootPath) || 'repo'),
    model: 'embed-1',
  };
  if (params.requestPayloadPath !== null) {
    requestPayload.path =
      params.requestPayloadPath ?? params.rootPath;
  }

  await IngestQueueRequestModel.create({
    canonicalTargetPath: params.rootPath,
    operation: 'reembed',
    queueState: params.queueState,
    requestPayload,
    sourceSurface: 'cucumber',
    runId: params.runId ?? null,
    ...(params.nonReplayableAt
      ? { nonReplayableAt: params.nonReplayableAt }
      : {}),
    ...(params.terminalPublishedAt
      ? { terminalPublishedAt: params.terminalPublishedAt }
      : {}),
  });
}

Before(async () => {
  setDefaultTimeout(10000);
  process.env.NODE_ENV = 'test';
  release();
  __resetIngestJobsForTest();
  if (mongoose.connection.readyState === 1) {
    await IngestQueueRequestModel.deleteMany({}).exec();
  }
  resetStore();
  process.env.CODEINFO_LMSTUDIO_BASE_URL = 'ws://localhost:1234';
  process.env.CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT = '1';
  process.env.CODEINFO_INGEST_MAX_QUEUE_SIZE = '1';
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
    baseUrl: process.env.CODEINFO_LMSTUDIO_BASE_URL ?? '',
  });

  app.use(
    '/',
    createIngestStartRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
    }),
  );
  app.use('/', createIngestCancelRouter());
  app.use(
    '/',
    createIngestReembedRouter({
      clientFactory: () =>
        new MockLMStudioClient() as unknown as LMStudioClient,
    }),
  );
  app.use('/', createIngestRemoveRouter());
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
  release();
  stopMock();
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  response = null;
  lastRunId = null;
  queueRuntimeStartedPaths = [];
  lastQueuePumpResult = null;
  __setQueueRuntimeOpsForTest({
    deleteQueueRequestById: async () => null,
    ensureQueueRequestRunId: async () => null,
    findOldestCleanupBlockedQueueRequest: async () => null,
    findOldestRunningQueueRequest: async () => null,
    getQueueRequestId: () => 'noop',
    markQueueRequestCleanupBlocked: async () => null,
    markQueueRequestTerminalPublished: async () => null,
    promoteOldestWaitingQueueRequest: async () => null,
  });
  __setRunProcessorForTest(null);
  __resetIngestJobsForTest();
  if (mongoose.connection.readyState === 1) {
    await IngestQueueRequestModel.deleteMany({}).exec();
  }
  resetStore();
  await clearRootsCollection();
  await clearVectorsCollection();
  await clearLockedModel();
  delete process.env.CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT;
  delete process.env.CODEINFO_INGEST_MAX_QUEUE_SIZE;
});

Given('ingest manage chroma stub is empty', async () => {
  await clearRootsCollection();
  await clearVectorsCollection();
  await clearLockedModel();
});

Given('ingest manage mongo queue is empty', async () => {
  await IngestQueueRequestModel.deleteMany({}).exec();
});

Given('ingest manage models scenario {string}', (name: string) => {
  startMock({ scenario: name as MockScenario });
});

Given(
  'ingest manage temp repo with file {string} containing {string}',
  async (rel: string, content: string) => {
    tempDir = await createTempRepoRoot('ingest-manage-');
    const filePath = path.join(tempDir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  },
);

When(
  'I POST ingest manage start with model {string}',
  async (model: string) => {
    if (!tempDir) {
      tempDir = await createTempRepoRoot('ingest-manage-');
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
  },
);

When('I POST ingest manage cancel for the last run', async () => {
  assert(lastRunId, 'runId missing');
  const res = await fetch(`${baseUrl}/ingest/cancel/${lastRunId}`, {
    method: 'POST',
  });
  response = { status: res.status, body: await res.json() };
});

When('I POST ingest manage reembed for the temp repo', async () => {
  assert(tempDir, 'temp dir missing');
  const res = await fetch(
    `${baseUrl}/ingest/reembed/${encodeURIComponent(tempDir)}`,
    {
      method: 'POST',
    },
  );
  response = { status: res.status, body: await res.json() };
  if (response.status === 202) {
    lastRunId = (response.body as { runId?: string }).runId ?? null;
  }
});

When('I POST ingest manage reembed for root {string}', async (root: string) => {
  const res = await fetch(
    `${baseUrl}/ingest/reembed/${encodeURIComponent(root)}`,
    {
      method: 'POST',
    },
  );
  response = { status: res.status, body: await res.json() };
  if (response.status === 202) {
    lastRunId = (response.body as { runId?: string }).runId ?? null;
  }
});

When('I POST ingest manage remove for the temp repo', async () => {
  assert(tempDir, 'temp dir missing');
  const res = await fetch(
    `${baseUrl}/ingest/remove/${encodeURIComponent(tempDir)}`,
    {
      method: 'POST',
    },
  );
  response = { status: res.status, body: await res.json() };
});

When(
  'I change ingest manage temp file {string} to {string}',
  async (rel: string, content: string) => {
    assert(tempDir, 'temp dir missing');
    const filePath = path.join(tempDir, rel);
    await fs.writeFile(filePath, content);
  },
);

Then(
  'ingest manage status for the last run becomes {string}',
  async (state: string) => {
    assert(lastRunId, 'runId missing');
    for (let i = 0; i < 120; i += 1) {
      const res = await fetch(`${baseUrl}/ingest/status/${lastRunId}`);
      const body = await res.json();
      console.log(
        `[ingest-manage] poll ${i} runId=${lastRunId} state=${body.state} message=${body.message ?? ''}`,
      );
      if (body.state === state) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`did not reach state ${state}`);
  },
);

Then(
  'ingest manage status for run {string} becomes {string}',
  async (runId: string, state: string) => {
    for (let i = 0; i < 120; i += 1) {
      const res = await fetch(`${baseUrl}/ingest/status/${runId}`);
      const body = await res.json();
      if ((body as { state?: string }).state === state) {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`did not reach state ${state} for run ${runId}`);
  },
);

Then(
  'ingest manage status for run {string} has last error {string}',
  async (runId: string, expectedError: string) => {
    const res = await fetch(`${baseUrl}/ingest/status/${runId}`);
    const body = await res.json();
    assert.equal(
      (body as { lastError?: string | null }).lastError,
      expectedError,
    );
  },
);

Then('ingest manage roots first status is {string}', async (state: string) => {
  assert(response, 'expected response');
  let roots = (response.body as { roots?: unknown[] }).roots ?? [];
  for (
    let i = 0;
    i < 20 &&
    (roots.length === 0 || (roots[0] as { status?: string }).status !== state);
    i += 1
  ) {
    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`${baseUrl}/ingest/roots`);
    const body = await res.json();
    roots = (body as { roots?: unknown[] }).roots ?? [];
    console.log(
      `[ingest-manage] roots poll ${i} count=${roots.length} statuses=${roots
        .map((r) => (r as { status?: string }).status ?? 'unknown')
        .join(',')}`,
    );
  }
  assert(roots.length > 0, 'no roots returned');
  assert.equal((roots[0] as { status?: string }).status, state);
});

Then('ingest manage roots first model is {string}', (model: string) => {
  assert(response, 'expected response');
  const roots = (response.body as { roots?: unknown[] }).roots ?? [];
  assert(roots.length > 0, 'no roots returned');
  assert.equal((roots[0] as { model?: string }).model, model);
});

Then(
  'ingest manage roots first embedding provider is {string}',
  (provider: string) => {
    assert(response, 'expected response');
    const roots = (response.body as { roots?: unknown[] }).roots ?? [];
    assert(roots.length > 0, 'no roots returned');
    assert.equal(
      (roots[0] as { embeddingProvider?: string }).embeddingProvider,
      provider,
    );
  },
);

Then('ingest manage roots first request id is present', () => {
  assert(response, 'expected response');
  const roots = (response.body as { roots?: unknown[] }).roots ?? [];
  assert(roots.length > 0, 'no roots returned');
  assert.equal(
    typeof (roots[0] as { requestId?: string | null }).requestId,
    'string',
  );
});

Then('ingest manage roots first id is {string}', (expectedId: string) => {
  assert(response, 'expected response');
  const roots = (response.body as { roots?: unknown[] }).roots ?? [];
  assert(roots.length > 0, 'no roots returned');
  assert.equal((roots[0] as { id?: string }).id, expectedId);
});

Then('ingest manage roots first run id is null', () => {
  assert(response, 'expected response');
  const roots = (response.body as { roots?: unknown[] }).roots ?? [];
  assert(roots.length > 0, 'no roots returned');
  assert.equal((roots[0] as { runId?: string | null }).runId, null);
});

Then(
  'ingest manage roots entry for {string} has id {string}',
  (rootPath: string, expectedId: string) => {
    const root = findRootByPath(rootPath) as { id?: string };
    assert.equal(root.id, expectedId);
  },
);

Then(
  'ingest manage roots entry for {string} has canonical id {string}',
  (rootPath: string, expectedId: string) => {
    const root = findRootByPath(rootPath) as { id?: string };
    assert.equal(root.id, expectedId);
  },
);

Then(
  'ingest manage roots entry for {string} keeps canonical id {string} when resumed',
  (rootPath: string, expectedId: string) => {
    const root = findRootByPath(rootPath) as { id?: string };
    assert.equal(root.id, expectedId);
  },
);

Then(
  'ingest manage roots entry for {string} has name {string}',
  (rootPath: string, expectedName: string) => {
    const root = findRootByPath(rootPath);
    assert.equal(root.name, expectedName);
  },
);

Then(
  'ingest manage roots entry for {string} has request id present',
  (rootPath: string) => {
    const root = findRootByPath(rootPath);
    assert.equal(typeof root.requestId, 'string');
  },
);

Then(
  'ingest manage roots entry for {string} has run id null',
  (rootPath: string) => {
    const root = findRootByPath(rootPath);
    assert.equal(root.runId, null);
  },
);

Then(
  'ingest manage roots entry for {string} has run id {string}',
  (rootPath: string, expectedRunId: string) => {
    const root = findRootByPath(rootPath);
    assert.equal(root.runId, expectedRunId);
  },
);

Then(
  'ingest manage roots entry for {string} has queue state {string}',
  (rootPath: string, queueState: string) => {
    const root = findRootByPath(rootPath);
    assert.equal(root.queueState, queueState);
  },
);

Then(
  'ingest manage roots entry for {string} has queue position {int}',
  (rootPath: string, queuePosition: number) => {
    const root = findRootByPath(rootPath);
    assert.equal(root.queuePosition, queuePosition);
  },
);

Then(
  'ingest manage roots first queue state is {string}',
  (queueState: string) => {
    assert(response, 'expected response');
    const roots = (response.body as { roots?: unknown[] }).roots ?? [];
    assert(roots.length > 0, 'no roots returned');
    assert.equal((roots[0] as { queueState?: string }).queueState, queueState);
  },
);

Then(
  'ingest manage roots first queue position is {int}',
  (queuePosition: number) => {
    assert(response, 'expected response');
    const roots = (response.body as { roots?: unknown[] }).roots ?? [];
    assert(roots.length > 0, 'no roots returned');
    assert.equal(
      (roots[0] as { queuePosition?: number | null }).queuePosition,
      queuePosition,
    );
  },
);

Then('ingest manage roots count is {int}', async (count: number) => {
  assert(response, 'expected response');
  let roots = (response.body as { roots?: unknown[] }).roots ?? [];
  for (let i = 0; i < 5 && roots.length !== count; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`${baseUrl}/ingest/roots`);
    const body = await res.json();
    roots = (body as { roots?: unknown[] }).roots ?? [];
  }
  assert.equal(roots.length, count);
});

Then('ingest manage locked model id is null', () => {
  assert(response, 'expected response');
  const locked = (response.body as { lockedModelId?: string | null })
    .lockedModelId;
  assert.equal(locked, null);
});

Then(
  'ingest manage roots first entry has canonical and alias lock parity',
  () => {
    assert(response, 'expected response');
    const roots = (response.body as { roots?: unknown[] }).roots ?? [];
    assert(roots.length > 0, 'no roots returned');
    const first = roots[0] as {
      embeddingProvider?: string;
      embeddingModel?: string;
      embeddingDimensions?: number;
      model?: string;
      modelId?: string;
      lock?: {
        embeddingProvider?: string;
        embeddingModel?: string;
        embeddingDimensions?: number;
        lockedModelId?: string;
        modelId?: string;
      };
    };
    assert.equal(typeof first.embeddingProvider, 'string');
    assert.equal(typeof first.embeddingModel, 'string');
    assert.equal(typeof first.embeddingDimensions, 'number');
    assert.equal(first.model, first.embeddingModel);
    assert.equal(first.modelId, first.embeddingModel);
    assert.equal(first.lock?.embeddingProvider, first.embeddingProvider);
    assert.equal(first.lock?.embeddingModel, first.embeddingModel);
    assert.equal(first.lock?.embeddingDimensions, first.embeddingDimensions);
    assert.equal(first.lock?.lockedModelId, first.embeddingModel);
    assert.equal(first.lock?.modelId, first.embeddingModel);
  },
);

Then('ingest manage roots payload is fetched', async () => {
  const res = await fetch(`${baseUrl}/ingest/roots`);
  response = { status: res.status, body: await res.json() };
});

When('I GET ingest manage roots', async () => {
  const res = await fetch(`${baseUrl}/ingest/roots`);
  response = { status: res.status, body: await res.json() };
});

Then(
  'ingest manage waits for {int} controlled embedding calls',
  async (count: number) => {
    await waitForControlledEmbeddingCalls(count);
  },
);

When(
  'ingest manage releases controlled embedding call {int}',
  (index: number) => {
    releaseControlledEmbeddingCall(index);
  },
);

Then('ingest manage logs include {string}', (marker: string) => {
  const matches = query({ text: marker }, 50);
  assert.ok(matches.length > 0, `expected log marker ${marker}`);
});

Given(
  'ingest manage root metadata exists for {string} with legacy model {string}',
  async (rootPath: string, model: string) => {
    const roots = await getRootsCollection();
    await roots.add({
      ids: ['legacy-root-run'],
      embeddings: [[0]],
      metadatas: [
        {
          runId: 'legacy-root-run',
          root: rootPath,
          name: 'legacy-repo',
          model,
          files: 1,
          chunks: 1,
          embedded: 1,
          state: 'completed',
          lastIngestAt: new Date().toISOString(),
          ingestedAtMs: Date.now(),
        },
      ],
    });
  },
);

Given(
  'ingest manage lock is provider {string} model {string} dimensions {int}',
  async (provider: string, model: string, dimensions: number) => {
    await setLockedModel({
      embeddingProvider: provider as 'lmstudio' | 'openai',
      embeddingModel: model,
      embeddingDimensions: dimensions,
    });
  },
);

Then(
  'ingest manage response status is {int} with code {string}',
  (status: number, code: string) => {
    assert(response, 'expected response');
    assert.equal(response.status, status);
    assert.equal((response.body as { code?: string }).code, code);
  },
);

Then('ingest manage response status is {int}', (status: number) => {
  assert(response, 'expected response');
  assert.equal(response.status, status);
});

Given(
  'ingest manage mongo queue has running request for {string} with run id {string}',
  async (rootPath: string, runId: string) => {
    await seedQueuedReembedRequest({
      rootPath,
      queueState: 'running',
      runId,
    });
  },
);

Given(
  'ingest manage mongo queue has running request for {string} with run id {string} and persisted path {string}',
  async (rootPath: string, runId: string, requestPayloadPath: string) => {
    await seedQueuedReembedRequest({
      rootPath,
      queueState: 'running',
      runId,
      requestPayloadPath,
    });
  },
);

Given(
  'ingest manage mongo queue has running request for {string} with run id {string} missing persisted path',
  async (rootPath: string, runId: string) => {
    await seedQueuedReembedRequest({
      rootPath,
      queueState: 'running',
      runId,
      requestPayloadPath: null,
    });
  },
);

Given(
  'ingest manage mongo queue has barrier-backed running request for {string} with run id {string}',
  async (rootPath: string, runId: string) => {
    await seedQueuedReembedRequest({
      rootPath,
      queueState: 'running',
      runId,
      nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
    });
  },
);

Given(
  'ingest manage mongo queue has cleanup-blocked request for {string} with run id {string}',
  async (rootPath: string, runId: string) => {
    await seedQueuedReembedRequest({
      rootPath,
      queueState: 'cleanup-blocked',
      runId,
    });
  },
);

Given(
  'ingest manage mongo queue has waiting request for {string}',
  async (rootPath: string) => {
    await seedQueuedReembedRequest({
      rootPath,
      queueState: 'waiting',
    });
  },
);

Given(
  'ingest manage mongo queue has waiting request for {string} named {string}',
  async (rootPath: string, name: string) => {
    await seedQueuedReembedRequest({
      rootPath,
      queueState: 'waiting',
      name,
    });
  },
);

Given(
  'ingest manage mongo queue has waiting request for {string} named {string} with provider {string} model {string}',
  async (rootPath: string, name: string, provider: string, model: string) => {
    await IngestQueueRequestModel.create({
      canonicalTargetPath: rootPath,
      operation: 'reembed',
      queueState: 'waiting',
      requestPayload: {
        path: rootPath,
        name,
        model,
        embeddingProvider: provider,
        embeddingModel: model,
      },
      sourceSurface: 'cucumber',
      runId: null,
    });
  },
);

Given('ingest manage queue runtime records started paths', () => {
  queueRuntimeStartedPaths = [];
  __setRunProcessorForTest(async (runId, input) => {
    queueRuntimeStartedPaths.push(input.path);
    release(runId);
  });
});

When('ingest manage startup recovery runs', async () => {
  await recoverIngestQueueOnStartup();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
});

When('ingest manage queue pump runs', async () => {
  lastQueuePumpResult = await pumpIngestQueue();
  await new Promise((resolve) => setImmediate(resolve));
});

Then(
  'ingest manage queue runtime started paths are {string}',
  (pathsCsv: string) => {
    const expected =
      pathsCsv.trim().length === 0
        ? []
        : pathsCsv.split(',').map((item) => item.trim());
    assert.deepEqual(queueRuntimeStartedPaths, expected);
  },
);

Then('ingest manage queue runtime started paths are empty', () => {
  assert.deepEqual(queueRuntimeStartedPaths, []);
});

Then('ingest manage queue pump reports cleanup blocked', () => {
  assert(lastQueuePumpResult, 'expected queue pump result');
  assert.equal(lastQueuePumpResult.started, false);
  assert.equal(lastQueuePumpResult.blockedByCleanup, true);
});
