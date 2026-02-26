import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { ChromaClient } from 'chromadb';
import express from 'express';
import request from 'supertest';
import {
  resetCollectionsForTests,
  setLockedModel,
} from '../../ingest/chromaClient.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';

beforeEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
});

afterEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
});

function mockRootsWithState(state: 'cancelled' | 'error') {
  const roots = {
    get: async () => ({
      ids: ['run-1'],
      metadatas: [
        {
          root: '/data/repo-invalid',
          name: 'repo-invalid',
          model: 'text-embedding-3-small',
          state,
          lastIngestAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
    add: async () => {},
    delete: async () => {},
  } as const;

  const vectors = {
    metadata: {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
    },
    count: async () => 1,
    modify: async () => {},
    delete: async () => {},
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

test('POST /ingest/reembed rejects cancelled root state deterministically before run start', async () => {
  mockRootsWithState('cancelled');
  await setLockedModel({
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
  });

  const app = express();
  app.use(express.json());
  app.use(createIngestReembedRouter({ clientFactory: () => ({}) as never }));

  const res = await request(app).post('/ingest/reembed/%2Fdata%2Frepo-invalid');
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'INVALID_REEMBED_STATE');
});

test('POST /ingest/reembed rejects error root state deterministically before run start', async () => {
  mockRootsWithState('error');
  await setLockedModel({
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
  });

  const app = express();
  app.use(express.json());
  app.use(createIngestReembedRouter({ clientFactory: () => ({}) as never }));

  const res = await request(app).post('/ingest/reembed/%2Fdata%2Frepo-invalid');
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'INVALID_REEMBED_STATE');
});
