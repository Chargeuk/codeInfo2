import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { ChromaClient } from 'chromadb';
import { resetCollectionsForTests } from '../../ingest/chromaClient.js';
import { reembed } from '../../ingest/ingestJob.js';

function mockCollections(opts: {
  lockMetadata: Record<string, unknown>;
  rootMetadata: Record<string, unknown>;
}) {
  const vectors = {
    metadata: opts.lockMetadata,
    count: async () => 1,
    modify: async () => {},
    delete: async () => {},
  } as const;

  const roots = {
    get: async () => ({
      ids: ['run-1'],
      metadatas: [opts.rootMetadata],
    }),
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
}

beforeEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
});

afterEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
});

test('reembed rejects provider/model switching away from active lock', async () => {
  mockCollections({
    lockMetadata: {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
      lockedModelId: 'text-embedding-3-small',
    },
    rootMetadata: {
      root: '/data/repo-one',
      name: 'repo-one',
      model: 'legacy-lm-model',
      state: 'completed',
      lastIngestAt: '2026-01-01T00:00:00.000Z',
    },
  });

  await assert.rejects(
    () =>
      reembed('/data/repo-one', {
        lmClientFactory: () => ({}) as never,
        baseUrl: 'ws://host.docker.internal:1234',
      }),
    (err) => (err as { code?: string }).code === 'MODEL_LOCKED',
  );
});

test('reembed rejects invalid terminal root states before starting run', async () => {
  mockCollections({
    lockMetadata: {
      embeddingProvider: 'lmstudio',
      embeddingModel: 'embed-model',
      embeddingDimensions: 384,
      lockedModelId: 'embed-model',
    },
    rootMetadata: {
      root: '/data/repo-one',
      name: 'repo-one',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'embed-model',
      embeddingDimensions: 384,
      state: 'cancelled',
      lastIngestAt: '2026-01-01T00:00:00.000Z',
    },
  });

  await assert.rejects(
    () =>
      reembed('/data/repo-one', {
        lmClientFactory: () => ({}) as never,
        baseUrl: 'ws://host.docker.internal:1234',
      }),
    (err) => (err as { code?: string }).code === 'INVALID_REEMBED_STATE',
  );
});
