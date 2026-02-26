import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import { OpenAiEmbeddingError } from '../../ingest/providers/index.js';
import {
  __resetIngestJobsForTest,
  __setStatusForTest,
} from '../../ingest/ingestJob.js';
import { createMcpRouter } from '../../mcp/server.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { createToolsVectorSearchRouter } from '../../routes/toolsVectorSearch.js';

afterEach(() => {
  __resetIngestJobsForTest();
});

process.env.NODE_ENV = 'test';

function openAiRateLimitError() {
  return new OpenAiEmbeddingError(
    'OPENAI_RATE_LIMITED',
    'rate limited',
    true,
    429,
    1500,
  );
}

test('equivalent OpenAI failures map to the same normalized code/retryability across REST, MCP, and ingest status', async () => {
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
        throw openAiRateLimitError();
      },
    }),
  );

  const rest = await request(restApp)
    .post('/tools/vector-search')
    .send({ query: 'hello' });
  assert.equal(rest.status, 429);
  assert.equal(rest.body.error, 'OPENAI_RATE_LIMITED');
  assert.equal(rest.body.retryable, true);
  assert.equal(rest.body.provider, 'openai');

  const mcpApp = express();
  mcpApp.use(express.json());
  mcpApp.use(
    '/',
    createMcpRouter({
      vectorSearch: async () => {
        throw openAiRateLimitError();
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
  assert.equal(mcp.body.error.code, 429);
  assert.equal(mcp.body.error.data.error, 'OPENAI_RATE_LIMITED');
  assert.equal(mcp.body.error.data.retryable, true);
  assert.equal(mcp.body.error.data.provider, 'openai');

  __setStatusForTest('run-openai-rate-limit', {
    runId: 'run-openai-rate-limit',
    state: 'error',
    counts: { files: 2, chunks: 4, embedded: 1 },
    message: 'Failed',
    lastError: 'rate limited',
    error: {
      error: 'OPENAI_RATE_LIMITED',
      message: 'rate limited',
      retryable: true,
      provider: 'openai',
      upstreamStatus: 429,
      retryAfterMs: 1500,
    },
  });

  const statusApp = express();
  statusApp.use(express.json());
  statusApp.use(
    createIngestStartRouter({
      clientFactory: () => ({}) as never,
    }),
  );

  const status = await request(statusApp).get(
    '/ingest/status/run-openai-rate-limit',
  );
  assert.equal(status.status, 200);
  assert.equal(status.body.error.error, 'OPENAI_RATE_LIMITED');
  assert.equal(status.body.error.retryable, true);
  assert.equal(status.body.error.provider, 'openai');
});
