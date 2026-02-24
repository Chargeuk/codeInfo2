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
  app.use(createIngestRemoveRouter());
  const removeResponse = await request(app).post('/ingest/remove/repo-one');
  assert.equal(removeResponse.status, 429);
  assert.equal(removeResponse.body.code, 'BUSY');

  ingestLock.release('run-locked');
  assert.equal(ingestLock.isHeld(), false);
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
