import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { ChromaClient } from 'chromadb';
import {
  EmbedModelMissingError,
  IngestRequiredError,
  deleteVectorsCollection,
  getVectorsCollection,
  resetCollectionsForTests,
  resetLmClientResolver,
  setLmClientResolver,
} from '../../ingest/chromaClient.js';
import { vectorSearch } from '../../lmstudio/toolService.js';

const ORIGINAL_BASE_URL = process.env.LMSTUDIO_BASE_URL;

const defaultRoots = {
  ids: ['root-1'],
  metadatas: [
    {
      root: '/data/repo-one',
      name: 'repo-one',
      model: 'embed-model',
    },
  ],
};

function mockLmStudio({ fail }: { fail?: boolean } = {}) {
  const calls: Array<{ model: string; text?: string }> = [];
  setLmClientResolver(() => {
    return {
      embedding: {
        model: async (key: string) => {
          calls.push({ model: key });
          if (fail) {
            throw new Error('model missing');
          }
          return {
            embed: async (text: string) => {
              calls.push({ model: key, text });
              return { embedding: [0, 1, 2] } as const;
            },
          };
        },
      },
    } as never;
  });
  return calls;
}

function mockChromaCollections(
  options: {
    lockedModelId?: string | null;
    onEmbeddingFunction?: (fn: unknown) => void;
    queryResult?: Record<string, unknown>;
    roots?: { ids?: string[]; metadatas?: Record<string, unknown>[] };
  } = {},
) {
  const vectors = {
    metadata: { lockedModelId: options.lockedModelId ?? null },
    count: async () => 0,
    query: async () =>
      options.queryResult ?? {
        ids: [['chunk-1']],
        documents: [['hello chunk']],
        metadatas: [
          [
            {
              root: '/data/repo-one',
              relPath: 'docs/readme.md',
              model: options.lockedModelId ?? 'embed-model',
              chunkHash: 'chunk-1',
            },
          ],
        ],
        distances: [[0.42]],
      },
  } as const;

  const rootsCollection = {
    get: async () => options.roots ?? defaultRoots,
  } as const;

  mock.method(
    ChromaClient.prototype,
    'getOrCreateCollection',
    async (opts: { name?: string; embeddingFunction?: unknown }) => {
      options.onEmbeddingFunction?.(opts.embeddingFunction);
      if (opts.name === 'ingest_roots') return rootsCollection as never;
      return vectors as never;
    },
  );

  mock.method(ChromaClient.prototype, 'deleteCollection', async () => {});

  return { vectors, rootsCollection };
}

beforeEach(() => {
  mock.restoreAll();
  mock.reset();
  resetCollectionsForTests();
  process.env.LMSTUDIO_BASE_URL =
    ORIGINAL_BASE_URL ?? 'http://host.docker.internal:1234';
});

afterEach(() => {
  mock.restoreAll();
  mock.reset();
  resetCollectionsForTests();
  resetLmClientResolver();
  if (ORIGINAL_BASE_URL === undefined) {
    delete process.env.LMSTUDIO_BASE_URL;
  } else {
    process.env.LMSTUDIO_BASE_URL = ORIGINAL_BASE_URL;
  }
});

test('throws ingest-required when no locked model exists', async () => {
  mockChromaCollections({ lockedModelId: null });
  const lmCalls = mockLmStudio();

  await assert.rejects(
    () => getVectorsCollection({ requireEmbedding: true }),
    (err) => err instanceof IngestRequiredError,
  );

  assert.equal(lmCalls.length, 0);

  await assert.rejects(
    () =>
      vectorSearch(
        { query: 'hello' },
        {
          getVectorsCollection,
          getRootsCollection: async () =>
            ({ get: async () => defaultRoots }) as never,
          getLockedModel: async () => null,
        },
      ),
    (err) => err instanceof IngestRequiredError,
  );
});

test('derives embedding function from locked model and calls LM Studio embed', async () => {
  let capturedEmbedding: unknown;
  mockChromaCollections({
    lockedModelId: 'embed-model',
    onEmbeddingFunction: (fn) => {
      capturedEmbedding = fn;
    },
  });
  const lmCalls = mockLmStudio();

  await getVectorsCollection({ requireEmbedding: true });
  assert.ok(capturedEmbedding, 'embedding function should be provided');

  const embeddingFn = capturedEmbedding as {
    generate: (texts: string[]) => Promise<number[][]>;
  };
  const generated = await embeddingFn.generate(['hello world']);

  assert.equal(lmCalls[0]?.model, 'embed-model');
  const embedCall = lmCalls.find((c) => c.text);
  assert.equal(embedCall?.text, 'hello world');
  assert.deepEqual(generated[0], [0, 1, 2]);
});

test('throws embed-model-missing when locked model is absent in LM Studio', async () => {
  mockChromaCollections({ lockedModelId: 'embed-model' });
  mockLmStudio({ fail: true });

  await assert.rejects(
    () => getVectorsCollection({ requireEmbedding: true }),
    (err) => err instanceof EmbedModelMissingError,
  );
});

test('recreates embedding function after collection reset with preserved lock', async () => {
  mockChromaCollections({ lockedModelId: 'embed-model' });
  const lmCalls = mockLmStudio();

  await getVectorsCollection({ requireEmbedding: true });
  await deleteVectorsCollection();
  await getVectorsCollection({ requireEmbedding: true });

  const modelCalls = lmCalls.filter((c) => c.text === undefined);
  assert.equal(modelCalls.length, 2, 'model lookup should run after reset');
});
