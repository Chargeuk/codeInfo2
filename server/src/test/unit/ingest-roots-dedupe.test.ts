import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import {
  __resetIngestJobsForTest,
  __setJobInputForTest,
  __setStatusForTest,
} from '../../ingest/ingestJob.js';
import { query, resetStore } from '../../logStore.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { dedupeRootsByPath } from '../../routes/ingestRoots.js';

const ORIGINAL_HOST = process.env.HOST_INGEST_DIR;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function createRootsApp(
  roots: { ids: string[]; metadatas: Record<string, unknown>[] },
  lockedModelId: string | null,
) {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestRootsRouter({
      getLockedModel: async () => lockedModelId,
      getRootsCollection: async () =>
        ({
          get: async () => roots,
        }) as never,
    }),
  );
  return app;
}

beforeEach(() => {
  process.env.HOST_INGEST_DIR = '/host/base';
  process.env.NODE_ENV = 'test';
  resetStore();
  __resetIngestJobsForTest();
});

afterEach(() => {
  if (ORIGINAL_HOST === undefined) {
    delete process.env.HOST_INGEST_DIR;
  } else {
    process.env.HOST_INGEST_DIR = ORIGINAL_HOST;
  }
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

test('dedupeRootsByPath: keeps newest by lastIngestAt when path duplicates', () => {
  const lock = {
    embeddingProvider: 'lmstudio' as const,
    embeddingModel: 'embed-1',
    embeddingDimensions: 0,
    lockedModelId: 'embed-1',
    modelId: 'embed-1',
  };
  const roots = [
    {
      runId: 'r1',
      name: 'old',
      description: null,
      path: '/data/repo',
      embeddingProvider: 'lmstudio' as const,
      embeddingModel: 'embed-1',
      embeddingDimensions: 0,
      model: 'embed-1',
      modelId: 'embed-1',
      lock,
      status: 'completed',
      lastIngestAt: '2026-01-01T00:00:00Z',
      counts: { files: 1, chunks: 1, embedded: 1 },
      lastError: null,
    },
    {
      runId: 'r2',
      name: 'new',
      description: null,
      path: '/data/repo',
      embeddingProvider: 'lmstudio' as const,
      embeddingModel: 'embed-1',
      embeddingDimensions: 0,
      model: 'embed-1',
      modelId: 'embed-1',
      lock,
      status: 'completed',
      lastIngestAt: '2026-01-02T00:00:00Z',
      counts: { files: 1, chunks: 1, embedded: 1 },
      lastError: null,
    },
  ];

  const deduped = dedupeRootsByPath(roots);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.runId, 'r2');
  assert.equal(deduped[0]?.name, 'new');
});

test('dedupeRootsByPath: falls back to runId when lastIngestAt is missing', () => {
  const lock = {
    embeddingProvider: 'lmstudio' as const,
    embeddingModel: 'embed-1',
    embeddingDimensions: 0,
    lockedModelId: 'embed-1',
    modelId: 'embed-1',
  };
  const roots = [
    {
      runId: 'r1',
      name: 'old',
      description: null,
      path: '/data/repo',
      embeddingProvider: 'lmstudio' as const,
      embeddingModel: 'embed-1',
      embeddingDimensions: 0,
      model: 'embed-1',
      modelId: 'embed-1',
      lock,
      status: 'completed',
      lastIngestAt: null,
      counts: { files: 1, chunks: 1, embedded: 1 },
      lastError: null,
    },
    {
      runId: 'r9',
      name: 'newer',
      description: null,
      path: '/data/repo',
      embeddingProvider: 'lmstudio' as const,
      embeddingModel: 'embed-1',
      embeddingDimensions: 0,
      model: 'embed-1',
      modelId: 'embed-1',
      lock,
      status: 'completed',
      lastIngestAt: null,
      counts: { files: 1, chunks: 1, embedded: 1 },
      lastError: null,
    },
  ];

  const deduped = dedupeRootsByPath(roots);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.runId, 'r9');
  assert.equal(deduped[0]?.name, 'newer');
});

test('GET /ingest/roots returns canonical lock value from the unified resolver', async () => {
  const response = await request(
    createRootsApp(
      {
        ids: ['run-1'],
        metadatas: [
          {
            name: 'repo',
            root: '/data/repo',
            model: 'embed-model',
          },
        ],
      },
      'text-embedding-openai',
    ),
  ).get('/ingest/roots');

  assert.equal(response.status, 200);
  assert.equal(response.body.lockedModelId, 'text-embedding-openai');
  assert.equal(response.body.lock.embeddingModel, 'text-embedding-openai');
  assert.equal(response.body.lock.modelId, 'text-embedding-openai');
  assert.equal(response.body.roots.length, 1);
  assert.equal(response.body.roots[0].runId, 'run-1');
  assert.equal(response.body.roots[0].embeddingModel, 'embed-model');
  assert.equal(response.body.roots[0].model, 'embed-model');
  assert.equal(response.body.roots[0].modelId, 'embed-model');
  assert.equal(response.body.roots[0].lock.embeddingModel, 'embed-model');
  assert.equal(response.body.schemaVersion, '0000038-status-phase-v1');
});

test('GET /ingest/roots preserves legacy lastError string and normalized error payload', async () => {
  const response = await request(
    createRootsApp(
      {
        ids: ['run-2'],
        metadatas: [
          {
            name: 'repo',
            root: '/data/repo',
            model: 'text-embedding-3-small',
            lastError: 'rate limited',
            error: {
              error: 'OPENAI_RATE_LIMITED',
              message: 'rate limited',
              retryable: true,
              provider: 'openai',
              upstreamStatus: 429,
              retryAfterMs: 1000,
            },
          },
        ],
      },
      'text-embedding-3-small',
    ),
  ).get('/ingest/roots');

  assert.equal(response.status, 200);
  assert.equal(response.body.roots[0].lastError, 'rate limited');
  assert.equal(response.body.roots[0].error.error, 'OPENAI_RATE_LIMITED');
  assert.equal(response.body.roots[0].error.retryable, true);
  assert.equal(response.body.roots[0].error.provider, 'openai');
});

test('GET /ingest/roots keeps provider-qualified identity when model ids collide across providers', async () => {
  const response = await request(
    createRootsApp(
      {
        ids: ['openai-run', 'lmstudio-run'],
        metadatas: [
          {
            name: 'repo-openai',
            root: '/data/openai',
            model: 'shared-id',
            embeddingProvider: 'openai',
            embeddingModel: 'shared-id',
            embeddingDimensions: 1536,
          },
          {
            name: 'repo-lmstudio',
            root: '/data/lmstudio',
            model: 'shared-id',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'shared-id',
            embeddingDimensions: 768,
          },
        ],
      },
      'shared-id',
    ),
  ).get('/ingest/roots');

  assert.equal(response.status, 200);
  assert.equal(response.body.roots.length, 2);
  const openaiRoot = response.body.roots.find(
    (root: { embeddingProvider?: string; path?: string }) =>
      root.path === '/data/openai',
  );
  const lmstudioRoot = response.body.roots.find(
    (root: { embeddingProvider?: string; path?: string }) =>
      root.path === '/data/lmstudio',
  );
  assert.equal(openaiRoot?.embeddingProvider, 'openai');
  assert.equal(openaiRoot?.embeddingModel, 'shared-id');
  assert.equal(openaiRoot?.modelId, 'shared-id');
  assert.equal(lmstudioRoot?.embeddingProvider, 'lmstudio');
  assert.equal(lmstudioRoot?.embeddingModel, 'shared-id');
  assert.equal(lmstudioRoot?.modelId, 'shared-id');
});

test('GET /ingest/roots maps ingesting phase states and omits phase for terminal statuses', async () => {
  const response = await request(
    createRootsApp(
      {
        ids: ['queued', 'done', 'cancelled', 'errored', 'skipped'],
        metadatas: [
          { root: '/data/queued', name: 'queued', state: 'queued' },
          { root: '/data/done', name: 'done', state: 'completed' },
          { root: '/data/cancelled', name: 'cancelled', state: 'cancelled' },
          { root: '/data/errored', name: 'errored', state: 'error' },
          { root: '/data/skipped', name: 'skipped', state: 'skipped' },
        ],
      },
      'text-embed',
    ),
  ).get('/ingest/roots');

  assert.equal(response.status, 200);
  const roots = response.body.roots as Array<{
    path: string;
    status: string;
    phase?: string;
  }>;
  const byPath = new Map(roots.map((root) => [root.path, root]));
  const queued = byPath.get('/data/queued');
  const done = byPath.get('/data/done');
  const cancelled = byPath.get('/data/cancelled');
  const errored = byPath.get('/data/errored');
  const skipped = byPath.get('/data/skipped');
  assert.ok(queued);
  assert.ok(done);
  assert.ok(cancelled);
  assert.ok(errored);
  assert.ok(skipped);
  assert.deepEqual(
    { status: queued.status, phase: queued.phase },
    { status: 'ingesting', phase: 'queued' },
  );
  assert.equal(done.status, 'completed');
  assert.equal(done.phase, undefined);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.phase, undefined);
  assert.equal(errored.status, 'error');
  assert.equal(errored.phase, undefined);
  assert.equal(skipped.status, 'completed');
  assert.equal(skipped.phase, undefined);
});

test('GET /ingest/roots applies active overlay and synthesizes missing active roots', async () => {
  __setStatusForTest('active-root-run', {
    runId: 'active-root-run',
    state: 'embedding',
    counts: { files: 4, chunks: 8, embedded: 2 },
  });
  __setJobInputForTest('active-root-run', {
    path: '/data/repo',
    root: '/data/repo',
    name: 'repo',
    model: 'text-embed',
  });

  const response = await request(
    createRootsApp(
      {
        ids: ['persisted-run'],
        metadatas: [
          {
            root: '/data/repo',
            name: 'repo',
            state: 'completed',
            lastIngestAt: '2026-01-02T00:00:00.000Z',
            files: 1,
            chunks: 2,
            embedded: 3,
          },
        ],
      },
      'text-embed',
    ),
  ).get('/ingest/roots');

  assert.equal(response.status, 200);
  const overlaid = response.body.roots.find(
    (root: { path: string }) => root.path === '/data/repo',
  );
  assert.equal(overlaid.status, 'ingesting');
  assert.equal(overlaid.phase, 'embedding');
  assert.deepEqual(overlaid.counts, { files: 4, chunks: 8, embedded: 2 });
  assert.equal(overlaid.lastIngestAt, '2026-01-02T00:00:00.000Z');
});

test('GET /ingest/roots synthesizes active root when persisted metadata is missing', async () => {
  __setStatusForTest('active-synth-run', {
    runId: 'active-synth-run',
    state: 'scanning',
    counts: { files: 1, chunks: 1, embedded: 0 },
  });
  __setJobInputForTest('active-synth-run', {
    path: '/data/only-active',
    root: '/data/only-active',
    name: 'only-active',
    model: 'text-embed',
  });

  const response = await request(
    createRootsApp(
      {
        ids: [],
        metadatas: [],
      },
      'text-embed',
    ),
  ).get('/ingest/roots');
  assert.equal(response.status, 200);
  assert.equal(response.body.roots.length, 1);
  assert.equal(response.body.roots[0].status, 'ingesting');
  assert.equal(response.body.roots[0].phase, 'scanning');
  assert.equal(response.body.roots[0].runId, 'active-synth-run');
  assert.equal(response.body.roots[0].path, '/data/only-active');
});

test('GET /ingest/roots catch path emits structured failure log entry', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestRootsRouter({
      getLockedModel: async () => null,
      getRootsCollection: async () => {
        throw new Error('db read failed');
      },
    }),
  );

  const response = await request(app).get('/ingest/roots');
  assert.equal(response.status, 502);
  assert.equal(response.body.code, 'INGEST_ROOTS_LOOKUP_FAILED');

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const errorEntry = entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.context?.surface === 'ingest/roots' &&
      entry.context?.code === 'INGEST_ROOTS_LOOKUP_FAILED',
  );
  assert.ok(errorEntry, 'expected roots lookup failure log entry');
});
