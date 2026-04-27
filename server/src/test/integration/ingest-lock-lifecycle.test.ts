import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { ChromaClient } from 'chromadb';
import express from 'express';
import request from 'supertest';
import {
  clearLockedModel,
  getLockedEmbeddingModel,
  resetCollectionsForTests,
  setLockedModel,
} from '../../ingest/chromaClient.js';
import {
  reembed,
  startIngest,
  __resetIngestJobsForTest,
} from '../../ingest/ingestJob.js';
import * as ingestLock from '../../ingest/lock.js';
import { createIngestRemoveRouter } from '../../routes/ingestRemove.js';

function mockCollections(metadata: Record<string, unknown> = {}) {
  let vectorsMetadata = { ...metadata };
  const vectors: {
    metadata?: Record<string, unknown>;
    count: () => Promise<number>;
    modify: (opts: { metadata?: Record<string, unknown> }) => Promise<void>;
    delete: () => Promise<void>;
  } = {
    metadata: vectorsMetadata,
    count: async () => 0,
    modify: async (opts: { metadata?: Record<string, unknown> }) => {
      vectorsMetadata = { ...(opts.metadata ?? {}) };
      vectors.metadata = vectorsMetadata;
    },
    delete: async () => {},
  };

  const roots = {
    get: async () => ({ ids: [], metadatas: [] }),
    delete: async () => {},
    add: async () => {},
  } as const;

  mock.method(
    ChromaClient.prototype,
    'getOrCreateCollection',
    async (args: { name?: string }) => {
      if (args.name === 'ingest_roots') return roots as never;
      return vectors as never;
    },
  );

  mock.method(ChromaClient.prototype, 'deleteCollection', async () => {});

  return {
    getMetadata: () => vectorsMetadata,
  };
}

beforeEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
  __resetIngestJobsForTest();
  ingestLock.release();
  mockCollections();
});

afterEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
  __resetIngestJobsForTest();
  ingestLock.release();
});

test('concurrent start/reembed/remove operations return deterministic BUSY while lock is held', async () => {
  ingestLock.acquire('run-locked');

  await assert.rejects(
    () =>
      startIngest(
        {
          path: '/data/repo',
          name: 'repo',
          model: 'embed-model',
        },
        {
          lmClientFactory: () => ({}) as never,
          baseUrl: 'ws://host.docker.internal:1234',
        },
      ),
    (err) => (err as { code?: string }).code === 'BUSY',
  );

  await assert.rejects(
    () =>
      reembed('/data/repo', {
        lmClientFactory: () => ({}) as never,
        baseUrl: 'ws://host.docker.internal:1234',
      }),
    (err) => (err as { code?: string }).code === 'BUSY',
  );

  const app = express();
  app.use(express.json());
  app.use(
    createIngestRemoveRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-one',
            description: null,
            containerPath: '/data/repo-one',
            hostPath: '/host/repo-one',
            lastIngestAt: '2026-01-01T00:00:00.000Z',
            embeddingProvider: 'lmstudio' as const,
            embeddingModel: 'embed-1',
            embeddingDimensions: 768,
            model: 'embed-1',
            modelId: 'embed-1',
            lock: {
              embeddingProvider: 'lmstudio' as const,
              embeddingModel: 'embed-1',
              embeddingDimensions: 768,
              lockedModelId: 'embed-1',
              modelId: 'embed-1',
            },
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
            status: 'completed' as const,
          },
        ],
        lockedModelId: 'embed-1',
      }),
      findLiveQueueRequestForTarget: async () => null,
    }),
  );
  const removeResponse = await request(app).post(
    '/ingest/remove/%2Fdata%2Frepo-one',
  );
  assert.equal(removeResponse.status, 429);
  assert.equal(removeResponse.body.code, 'BUSY');

  ingestLock.release('run-locked');
  assert.equal(ingestLock.isHeld(), false);
});

test('POST /ingest/remove rejects a non-exact selector before destructive lookup or removal', async () => {
  let removeCalled = false;
  let queueLookupCalled = false;
  const app = express();
  app.use(express.json());
  app.use(
    createIngestRemoveRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-one',
            description: null,
            containerPath: '/data/repo-one',
            hostPath: '/host/repo-one',
            lastIngestAt: '2026-01-01T00:00:00.000Z',
            embeddingProvider: 'lmstudio' as const,
            embeddingModel: 'embed-1',
            embeddingDimensions: 768,
            model: 'embed-1',
            modelId: 'embed-1',
            lock: {
              embeddingProvider: 'lmstudio' as const,
              embeddingModel: 'embed-1',
              embeddingDimensions: 768,
              lockedModelId: 'embed-1',
              modelId: 'embed-1',
            },
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
            status: 'completed' as const,
          },
        ],
        lockedModelId: 'embed-1',
      }),
      findLiveQueueRequestForTarget: async () => {
        queueLookupCalled = true;
        return null;
      },
      removeRoot: async () => {
        removeCalled = true;
        return { unlocked: true };
      },
    }),
  );

  const res = await request(app).post(
    '/ingest/remove/%2Fdata%2Frepo-one%2F..%2Frepo-one',
  );

  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
  assert.equal(queueLookupCalled, false);
  assert.equal(removeCalled, false);
});

test('POST /ingest/remove returns target-owned QUEUE_STATE_BLOCKED before unrelated active work can downgrade it to BUSY', async () => {
  let removeCalled = false;
  const app = express();
  app.use(express.json());
  app.use(
    createIngestRemoveRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-target',
            description: null,
            containerPath: '/data/repo-target',
            hostPath: '/host/repo-target',
            lastIngestAt: '2026-01-01T00:00:00.000Z',
            embeddingProvider: 'lmstudio' as const,
            embeddingModel: 'embed-1',
            embeddingDimensions: 768,
            model: 'embed-1',
            modelId: 'embed-1',
            lock: {
              embeddingProvider: 'lmstudio' as const,
              embeddingModel: 'embed-1',
              embeddingDimensions: 768,
              lockedModelId: 'embed-1',
              modelId: 'embed-1',
            },
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
            status: 'completed' as const,
          },
        ],
        lockedModelId: 'embed-1',
      }),
      getActiveRunContexts: () =>
        [
          {
            runId: 'run-unrelated',
            state: 'embedding',
            counts: { files: 0, chunks: 0, embedded: 0 },
            rootPath: '/data/unrelated',
            sourceId: '/data/unrelated',
            name: 'unrelated-active',
            description: null,
          },
        ] as never,
      isBusy: () => true,
      findLiveQueueRequestForTarget: async () =>
        ({
          _id: { toString: () => 'queue-target' },
          canonicalTargetPath: '/data/repo-target',
          queueState: 'waiting',
          runId: null,
        }) as never,
      removeRoot: async () => {
        removeCalled = true;
        return { unlocked: true };
      },
    }),
  );

  const res = await request(app).post('/ingest/remove/%2Fdata%2Frepo-target');

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'QUEUE_STATE_BLOCKED');
  assert.equal(res.body.queueState, 'waiting');
  assert.equal(removeCalled, false);
});

test('lock clear is idempotent and does not clear a newer lock when expected id mismatches', async () => {
  await setLockedModel({
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
  });

  await clearLockedModel({
    reason: 'cleanup',
    expectedLockId: 'text-embedding-3-large',
  });

  const stillLocked = await getLockedEmbeddingModel();
  assert.ok(stillLocked);
  assert.equal(stillLocked.embeddingModel, 'text-embedding-3-small');

  await clearLockedModel({
    reason: 'cleanup',
    expectedLockId: 'text-embedding-3-small',
  });

  const cleared = await getLockedEmbeddingModel();
  assert.equal(cleared, null);
});
