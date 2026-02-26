import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import {
  __resetIngestJobsForTest,
  __setStatusForTest,
} from '../../ingest/ingestJob.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';

afterEach(() => {
  __resetIngestJobsForTest();
});

process.env.NODE_ENV = 'test';

test('ingest status keeps partial-write progress counts and normalized error payload on failure', async () => {
  __setStatusForTest('run-partial-write-failure', {
    runId: 'run-partial-write-failure',
    state: 'error',
    counts: { files: 7, chunks: 14, embedded: 6 },
    message: 'Failed',
    lastError: 'quota exhausted',
    error: {
      error: 'OPENAI_QUOTA_EXCEEDED',
      message: 'quota exhausted',
      retryable: false,
      provider: 'openai',
      upstreamStatus: 429,
    },
    fileIndex: 7,
    fileTotal: 10,
    percent: 70,
  });

  const app = express();
  app.use(express.json());
  app.use(createIngestStartRouter({ clientFactory: () => ({}) as never }));

  const status = await request(app).get(
    '/ingest/status/run-partial-write-failure',
  );
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.counts, { files: 7, chunks: 14, embedded: 6 });
  assert.equal(status.body.lastError, 'quota exhausted');
  assert.equal(status.body.error.error, 'OPENAI_QUOTA_EXCEEDED');
  assert.equal(status.body.error.retryable, false);
});

test('ingest roots preserves persisted partial-write diagnostics with legacy and normalized error fields', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestRootsRouter({
      getRootsCollection: async () =>
        ({
          get: async () => ({
            ids: ['run-partial-write-failure'],
            metadatas: [
              {
                root: '/data/repo',
                name: 'repo',
                model: 'text-embedding-3-small',
                files: 7,
                chunks: 14,
                embedded: 6,
                lastError: 'quota exhausted',
                error: {
                  error: 'OPENAI_QUOTA_EXCEEDED',
                  message: 'quota exhausted',
                  retryable: false,
                  provider: 'openai',
                  upstreamStatus: 429,
                },
              },
            ],
          }),
        }) as never,
      getLockedModel: async () => 'text-embedding-3-small',
    }),
  );

  const res = await request(app).get('/ingest/roots');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.roots[0].counts, {
    files: 7,
    chunks: 14,
    embedded: 6,
  });
  assert.equal(res.body.roots[0].lastError, 'quota exhausted');
  assert.equal(res.body.roots[0].error.error, 'OPENAI_QUOTA_EXCEEDED');
});
