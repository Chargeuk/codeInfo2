import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createToolsIngestedReposRouter } from '../../routes/toolsIngestedRepos.js';

const ORIGINAL_HOST = process.env.HOST_INGEST_DIR;

beforeEach(() => {
  delete process.env.HOST_INGEST_DIR;
});

afterEach(() => {
  if (ORIGINAL_HOST === undefined) {
    delete process.env.HOST_INGEST_DIR;
  } else {
    process.env.HOST_INGEST_DIR = ORIGINAL_HOST;
  }
});

function buildApp(
  roots: { ids?: string[]; metadatas?: Record<string, unknown>[] },
  lockedModelId: string | null,
) {
  const app = express();
  app.use(express.json());
  app.use(
    createToolsIngestedReposRouter({
      getRootsCollection: async () =>
        ({
          get: async () => roots,
        }) as unknown as import('chromadb').Collection,
      getLockedModel: async () => lockedModelId,
    }),
  );
  return app;
}

test('returns empty repos list with null lock when no roots exist', async () => {
  const res = await request(buildApp({ ids: [], metadatas: [] }, null)).get(
    '/tools/ingested-repos',
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { repos: [], lockedModelId: null });
});

test('maps repo metadata and host path with locked model id', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  const res = await request(
    buildApp(
      {
        ids: ['run-1'],
        metadatas: [
          {
            root: '/data/repo-one',
            name: 'repo-one',
            description: 'sample',
            model: 'text-embed',
            files: 3,
            chunks: 12,
            embedded: 12,
            state: 'completed',
            lastIngestAt: '2025-01-01T00:00:00.000Z',
            lastError: null,
          },
        ],
      },
      'text-embed',
    ),
  ).get('/tools/ingested-repos');

  assert.equal(res.status, 200);
  assert.equal(res.body.lockedModelId, 'text-embed');
  assert.equal(res.body.repos.length, 1);
  const repo = res.body.repos[0];
  assert.equal(repo.id, 'repo-one');
  assert.equal(repo.containerPath, '/data/repo-one');
  assert.equal(repo.hostPath, '/host/base/repo-one');
  assert.equal(repo.description, 'sample');
  assert.deepEqual(repo.counts, { files: 3, chunks: 12, embedded: 12 });
  assert.equal(repo.lastError, null);
});
