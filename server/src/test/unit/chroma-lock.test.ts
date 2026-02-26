import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { ChromaClient } from 'chromadb';
import {
  getLockedEmbeddingModel,
  InvalidLockMetadataError,
  resetCollectionsForTests,
  setLockedModel,
} from '../../ingest/chromaClient.js';

type MutableVectors = {
  metadata?: Record<string, unknown>;
  modify: (opts: { metadata?: Record<string, unknown> }) => Promise<void>;
  count: () => Promise<number>;
};

function mockVectorsCollection(initialMetadata: Record<string, unknown>) {
  let metadata = { ...initialMetadata };
  const vectors: MutableVectors = {
    metadata,
    modify: async (opts) => {
      metadata = { ...(opts.metadata ?? {}) };
      vectors.metadata = metadata;
    },
    count: async () => 0,
  };

  mock.method(
    ChromaClient.prototype,
    'getOrCreateCollection',
    async (opts: { name?: string }) => {
      if (opts.name === 'ingest_roots') {
        return { get: async () => ({ ids: [], metadatas: [] }) } as never;
      }
      return vectors as never;
    },
  );

  mock.method(ChromaClient.prototype, 'deleteCollection', async () => {});

  return {
    getMetadata: () => metadata,
  };
}

beforeEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
});

afterEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
});

test('legacy lock metadata infers lmstudio provider', async () => {
  mockVectorsCollection({ lockedModelId: 'legacy-embed-model' });

  const lock = await getLockedEmbeddingModel();
  assert.ok(lock);
  assert.equal(lock.embeddingProvider, 'lmstudio');
  assert.equal(lock.embeddingModel, 'legacy-embed-model');
  assert.equal(lock.lockedModelId, 'legacy-embed-model');
  assert.equal(lock.source, 'legacy');
});

test('canonical lock write persists provider/model/dimensions deterministically', async () => {
  const vectors = mockVectorsCollection({});

  await setLockedModel({
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
  });

  const metadata = vectors.getMetadata();
  assert.equal(metadata.embeddingProvider, 'openai');
  assert.equal(metadata.embeddingModel, 'text-embedding-3-small');
  assert.equal(metadata.embeddingDimensions, 1536);
  assert.equal(metadata.lockedModelId, 'text-embedding-3-small');
});

test('partial canonical metadata is rejected deterministically', async () => {
  mockVectorsCollection({
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
  });

  await assert.rejects(
    () => getLockedEmbeddingModel(),
    (err) => err instanceof InvalidLockMetadataError,
  );
});
