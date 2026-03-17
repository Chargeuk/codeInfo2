import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { ChromaClient } from 'chromadb';
import express from 'express';
import request from 'supertest';
import {
  resetCollectionsForTests,
  setLockedModel,
} from '../../ingest/chromaClient.js';
import { OpenAiEmbeddingError } from '../../ingest/providers/index.js';
import { createMcpRouter } from '../../mcp/server.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { createToolsVectorSearchRouter } from '../../routes/toolsVectorSearch.js';

beforeEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
});

afterEach(() => {
  mock.restoreAll();
  resetCollectionsForTests();
});

test('POST /ingest/start rejects non-allowlisted OpenAI model with OPENAI_MODEL_UNAVAILABLE', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestStartRouter({
      clientFactory: () => ({}) as never,
      collectionIsEmpty: async () => true,
      getLockedEmbeddingModel: async () => null,
      startIngest: async () => '00000000-0000-0000-0000-000000000001',
    }),
  );

  const response = await request(app).post('/ingest/start').send({
    path: '/tmp/repo',
    name: 'repo',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-ada-002',
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'OPENAI_MODEL_UNAVAILABLE');
});

test('POST /ingest/reembed rejects lock-derived non-allowlisted OpenAI model with OPENAI_MODEL_UNAVAILABLE', async () => {
  const roots = {
    get: async () => ({
      ids: ['run-1'],
      metadatas: [
        {
          root: '/data/repo-openai',
          name: 'repo-openai',
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-ada-002',
          embeddingDimensions: 1536,
          model: 'text-embedding-ada-002',
          state: 'completed',
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
      embeddingModel: 'text-embedding-ada-002',
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

  await setLockedModel({
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-ada-002',
    embeddingDimensions: 1536,
  });

  const app = express();
  app.use(express.json());
  app.use(createIngestReembedRouter({ clientFactory: () => ({}) as never }));

  const response = await request(app).post(
    '/ingest/reembed/%2Fdata%2Frepo-openai',
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'OPENAI_MODEL_UNAVAILABLE');
});

test('REST and classic MCP vector-search keep deterministic OPENAI_MODEL_UNAVAILABLE mapping with no silent fallback', async () => {
  const restApp = express();
  restApp.use(express.json());
  restApp.use(
    createToolsVectorSearchRouter({
      getRootsCollection: async () =>
        ({
          get: async () => ({
            ids: ['repo-1'],
            metadatas: [
              {
                root: '/data/repo',
                name: 'repo',
                model: 'text-embedding-3-small',
              },
            ],
          }),
        }) as never,
      getLockedEmbeddingModel: async () => ({
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 1536,
        lockedModelId: 'text-embedding-3-small',
        source: 'canonical',
      }),
      getLockedModel: async () => 'text-embedding-3-small',
      getVectorsCollection: async () =>
        ({
          query: async () => ({ ids: [[]], metadatas: [[]], documents: [[]] }),
        }) as never,
      generateLockedQueryEmbedding: async () => {
        throw new OpenAiEmbeddingError(
          'OPENAI_MODEL_UNAVAILABLE',
          'model unavailable',
          false,
          404,
        );
      },
    }),
  );

  const rest = await request(restApp)
    .post('/tools/vector-search')
    .send({ query: 'hello' });
  assert.equal(rest.status, 404);
  assert.equal(rest.body.error, 'OPENAI_MODEL_UNAVAILABLE');

  const mcpApp = express();
  mcpApp.use(express.json());
  mcpApp.use(
    '/',
    createMcpRouter({
      vectorSearch: async () => {
        throw new OpenAiEmbeddingError(
          'OPENAI_MODEL_UNAVAILABLE',
          'model unavailable',
          false,
          404,
        );
      },
    }),
  );

  const mcp = await request(mcpApp)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'VectorSearch',
        arguments: { query: 'hello' },
      },
    });

  assert.equal(mcp.status, 200);
  assert.equal(mcp.body.error.code, 404);
  assert.equal(mcp.body.error.message, 'OPENAI_MODEL_UNAVAILABLE');
  assert.equal(mcp.body.error.data.error, 'OPENAI_MODEL_UNAVAILABLE');
});
