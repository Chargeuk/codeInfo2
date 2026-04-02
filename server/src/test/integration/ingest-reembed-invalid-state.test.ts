import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';

beforeEach(() => {
  mock.restoreAll();
});

afterEach(() => {
  mock.restoreAll();
});

function createAppForInvalidReembedState() {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestReembedRouter({
      clientFactory: () => ({}) as never,
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-invalid',
            description: null,
            containerPath: '/data/repo-invalid',
            hostPath: '/host/data/repo-invalid',
            lastIngestAt: '2026-01-01T00:00:00.000Z',
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
            embeddingDimensions: 1536,
            model: 'text-embedding-3-small',
            modelId: 'text-embedding-3-small',
            lock: {
              embeddingProvider: 'openai',
              embeddingModel: 'text-embedding-3-small',
              embeddingDimensions: 1536,
              lockedModelId: 'text-embedding-3-small',
              modelId: 'text-embedding-3-small',
            },
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
          },
        ],
        lockedModelId: 'text-embedding-3-small',
      }),
      enqueueOrReuseIngestRequest: async () => {
        const error = new Error('invalid reembed state');
        (error as { code?: string }).code = 'INVALID_REEMBED_STATE';
        throw error;
      },
    }),
  );
  return app;
}

test('POST /ingest/reembed rejects cancelled root state deterministically before queue admission starts a run', async () => {
  const app = createAppForInvalidReembedState();

  const res = await request(app).post('/ingest/reembed/%2Fdata%2Frepo-invalid');
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'INVALID_REEMBED_STATE');
});

test('POST /ingest/reembed rejects error root state deterministically before queue admission starts a run', async () => {
  const app = createAppForInvalidReembedState();

  const res = await request(app).post('/ingest/reembed/%2Fdata%2Frepo-invalid');
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'INVALID_REEMBED_STATE');
});
