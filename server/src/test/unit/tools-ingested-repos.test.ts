import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import {
  __resetIngestJobsForTest,
  __setJobInputForTest,
  __setStatusForTest,
} from '../../ingest/ingestJob.js';
import { createToolsIngestedReposRouter } from '../../routes/toolsIngestedRepos.js';

const ORIGINAL_HOST = process.env.HOST_INGEST_DIR;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  delete process.env.HOST_INGEST_DIR;
  process.env.NODE_ENV = 'test';
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

function buildApp(
  roots: { ids?: string[]; metadatas?: Record<string, unknown>[] },
  lockedModelId: string | null,
) {
  const app = express();
  app.use(express.json());
  const canonicalLock = lockedModelId
    ? {
        embeddingProvider: 'lmstudio' as const,
        embeddingModel: lockedModelId,
        embeddingDimensions: 0,
        lockedModelId,
        source: 'legacy' as const,
      }
    : null;
  app.use(
    createToolsIngestedReposRouter({
      getRootsCollection: async () =>
        ({
          get: async () => roots,
        }) as unknown as import('chromadb').Collection,
      getLockedModel: async () => lockedModelId,
      getLockedEmbeddingModel: async () => canonicalLock,
    }),
  );
  return app;
}

test('returns empty repos list with null lock when no roots exist', async () => {
  const res = await request(buildApp({ ids: [], metadatas: [] }, null)).get(
    '/tools/ingested-repos',
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    repos: [],
    lock: null,
    lockedModelId: null,
    schemaVersion: '0000038-status-phase-v1',
  });
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
  assert.equal(res.body.lock.embeddingModel, 'text-embed');
  assert.equal(res.body.lock.modelId, 'text-embed');
  assert.equal(res.body.schemaVersion, '0000038-status-phase-v1');
  assert.equal(res.body.repos.length, 1);
  const repo = res.body.repos[0];
  assert.equal(repo.id, 'repo-one');
  assert.equal(repo.containerPath, '/data/repo-one');
  assert.equal(repo.hostPath, '/host/base/repo-one');
  assert.equal(repo.embeddingProvider, 'lmstudio');
  assert.equal(repo.embeddingModel, 'text-embed');
  assert.equal(repo.embeddingDimensions, 0);
  assert.equal(repo.model, 'text-embed');
  assert.equal(repo.modelId, 'text-embed');
  assert.equal(repo.lock.embeddingModel, 'text-embed');
  assert.equal(repo.description, 'sample');
  assert.deepEqual(repo.counts, { files: 3, chunks: 12, embedded: 12 });
  assert.equal(repo.lastError, null);
  assert.equal(repo.status, 'completed');
  assert.equal(repo.phase, undefined);
});

test('preserves provider-qualified identity when providers share model ids', async () => {
  const res = await request(
    buildApp(
      {
        ids: ['openai-run', 'lmstudio-run'],
        metadatas: [
          {
            root: '/data/openai-repo',
            name: 'openai-repo',
            model: 'shared-id',
            embeddingProvider: 'openai',
            embeddingModel: 'shared-id',
            embeddingDimensions: 1536,
            files: 1,
            chunks: 1,
            embedded: 1,
          },
          {
            root: '/data/lmstudio-repo',
            name: 'lmstudio-repo',
            model: 'shared-id',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'shared-id',
            embeddingDimensions: 768,
            files: 1,
            chunks: 1,
            embedded: 1,
          },
        ],
      },
      'shared-id',
    ),
  ).get('/tools/ingested-repos');

  assert.equal(res.status, 200);
  const openaiRepo = res.body.repos.find(
    (repo: { id: string }) => repo.id === 'openai-repo',
  );
  const lmstudioRepo = res.body.repos.find(
    (repo: { id: string }) => repo.id === 'lmstudio-repo',
  );
  assert.equal(openaiRepo.embeddingProvider, 'openai');
  assert.equal(openaiRepo.embeddingModel, 'shared-id');
  assert.equal(openaiRepo.modelId, 'shared-id');
  assert.equal(lmstudioRepo.embeddingProvider, 'lmstudio');
  assert.equal(lmstudioRepo.embeddingModel, 'shared-id');
  assert.equal(lmstudioRepo.modelId, 'shared-id');
});

test('maps queued/scanning/embedding states to ingesting with matching phase', async () => {
  const res = await request(
    buildApp(
      {
        ids: ['queued-run', 'scanning-run', 'embedding-run'],
        metadatas: [
          { root: '/data/queued', name: 'queued', state: 'queued' },
          { root: '/data/scanning', name: 'scanning', state: 'scanning' },
          { root: '/data/embedding', name: 'embedding', state: 'embedding' },
        ],
      },
      'text-embed',
    ),
  ).get('/tools/ingested-repos');

  assert.equal(res.status, 200);
  const queued = res.body.repos.find(
    (repo: { id: string }) => repo.id === 'queued',
  );
  const scanning = res.body.repos.find(
    (repo: { id: string }) => repo.id === 'scanning',
  );
  const embedding = res.body.repos.find(
    (repo: { id: string }) => repo.id === 'embedding',
  );
  assert.deepEqual(
    { status: queued.status, phase: queued.phase },
    { status: 'ingesting', phase: 'queued' },
  );
  assert.deepEqual(
    { status: scanning.status, phase: scanning.phase },
    { status: 'ingesting', phase: 'scanning' },
  );
  assert.deepEqual(
    { status: embedding.status, phase: embedding.phase },
    { status: 'ingesting', phase: 'embedding' },
  );
});

test('maps skipped state to completed and omits phase', async () => {
  const res = await request(
    buildApp(
      {
        ids: ['skipped-run'],
        metadatas: [
          { root: '/data/skipped', name: 'skipped', state: 'skipped' },
        ],
      },
      'text-embed',
    ),
  ).get('/tools/ingested-repos');

  assert.equal(res.status, 200);
  assert.equal(res.body.repos[0].status, 'completed');
  assert.equal(res.body.repos[0].phase, undefined);
});

test('active overlay keeps repo visible and preserves persisted metadata while updating run fields', async () => {
  __setStatusForTest('active-run-1', {
    runId: 'active-run-1',
    state: 'scanning',
    counts: { files: 11, chunks: 22, embedded: 33 },
  });
  __setJobInputForTest('active-run-1', {
    path: '/data/repo-one',
    root: '/data/repo-one',
    name: 'repo-one',
    model: 'text-embed',
  });

  const res = await request(
    buildApp(
      {
        ids: ['persisted-run'],
        metadatas: [
          {
            root: '/data/repo-one',
            name: 'repo-one',
            state: 'completed',
            lastIngestAt: '2026-01-01T00:00:00.000Z',
            files: 1,
            chunks: 2,
            embedded: 3,
          },
        ],
      },
      'text-embed',
    ),
  ).get('/tools/ingested-repos');

  assert.equal(res.status, 200);
  assert.equal(res.body.repos.length, 1);
  const repo = res.body.repos[0];
  assert.equal(repo.status, 'ingesting');
  assert.equal(repo.phase, 'scanning');
  assert.deepEqual(repo.counts, { files: 11, chunks: 22, embedded: 33 });
  assert.equal(repo.lastIngestAt, '2026-01-01T00:00:00.000Z');
});

test('synthesizes active entry when persisted metadata is missing', async () => {
  process.env.HOST_INGEST_DIR = '/host/base';
  __setStatusForTest('active-run-2', {
    runId: 'active-run-2',
    state: 'queued',
    counts: { files: 0, chunks: 0, embedded: 0 },
  });
  __setJobInputForTest('active-run-2', {
    path: '/container/missing/repo',
    root: '/container/missing/repo',
    name: 'missing-repo',
    model: 'text-embed',
  });

  const res = await request(
    buildApp({ ids: [], metadatas: [] }, 'text-embed'),
  ).get('/tools/ingested-repos');
  assert.equal(res.status, 200);
  assert.equal(res.body.repos.length, 1);
  const repo = res.body.repos[0];
  assert.equal(repo.id, 'active-run-2');
  assert.equal(repo.containerPath, '/container/missing/repo');
  assert.equal(repo.hostPath, '/host/base/container/missing/repo');
  assert.equal(repo.status, 'ingesting');
  assert.equal(repo.phase, 'queued');
});
