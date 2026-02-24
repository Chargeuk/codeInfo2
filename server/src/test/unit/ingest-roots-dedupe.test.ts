import assert from 'node:assert/strict';
import express from 'express';
import test, { afterEach, beforeEach } from 'node:test';
import request from 'supertest';
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
});

afterEach(() => {
  if (ORIGINAL_HOST === undefined) {
    delete process.env.HOST_INGEST_DIR;
  } else {
    process.env.HOST_INGEST_DIR = ORIGINAL_HOST;
  }
});

test('dedupeRootsByPath: keeps newest by lastIngestAt when path duplicates', () => {
  const roots = [
    {
      runId: 'r1',
      name: 'old',
      description: null,
      path: '/data/repo',
      model: 'embed-1',
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
      model: 'embed-1',
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
  const roots = [
    {
      runId: 'r1',
      name: 'old',
      description: null,
      path: '/data/repo',
      model: 'embed-1',
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
      model: 'embed-1',
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
  assert.equal(response.body.roots.length, 1);
  assert.equal(response.body.roots[0].runId, 'run-1');
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
