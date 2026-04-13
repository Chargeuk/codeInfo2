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

function createAppForInvalidReembedState(status: 'cancelled' | 'error') {
  let enqueueCalls = 0;
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
            lastError: status === 'error' ? 'boom' : null,
            status,
          },
        ],
        lockedModelId: 'text-embedding-3-small',
      }),
      enqueueOrReuseIngestRequest: async () => {
        enqueueCalls += 1;
        return {
          requestId: 'unexpected-queue-request',
          canonicalTargetPath: '/data/repo-invalid',
          queueState: 'waiting' as const,
          queuePosition: 1,
          runId: null,
          reusedExisting: false,
          updatedExisting: false,
          queueRequest: {} as never,
        };
      },
    }),
  );
  return { app, getEnqueueCalls: () => enqueueCalls };
}

test('POST /ingest/reembed keeps the immediate cancelled-root INVALID_REEMBED_STATE contract aligned with deferred execution rejection', async () => {
  const { app, getEnqueueCalls } = createAppForInvalidReembedState('cancelled');

  const res = await request(app).post('/ingest/reembed/%2Fdata%2Frepo-invalid');
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'INVALID_REEMBED_STATE');
  assert.equal(getEnqueueCalls(), 0);
});

test('POST /ingest/reembed keeps the immediate error-root INVALID_REEMBED_STATE contract aligned with startup-recovery rejection', async () => {
  const { app, getEnqueueCalls } = createAppForInvalidReembedState('error');

  const res = await request(app).post('/ingest/reembed/%2Fdata%2Frepo-invalid');
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'INVALID_REEMBED_STATE');
  assert.equal(getEnqueueCalls(), 0);
});
