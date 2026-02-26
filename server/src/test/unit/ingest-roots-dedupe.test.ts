import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import { query, resetStore } from '../../logStore.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { dedupeRootsByPath } from '../../routes/ingestRoots.js';

const ORIGINAL_HOST = process.env.HOST_INGEST_DIR;

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
  resetStore();
});

afterEach(() => {
  if (ORIGINAL_HOST === undefined) {
    delete process.env.HOST_INGEST_DIR;
  } else {
    process.env.HOST_INGEST_DIR = ORIGINAL_HOST;
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
