import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { createMcpRouter } from '../../mcp/server.js';

test('classic MCP VectorSearch enforces locked provider/model path like REST', async () => {
  let queryEmbeddingSeen: number[] | null = null;

  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      getRootsCollection: async () =>
        ({
          get: async () => ({
            ids: ['run-1'],
            metadatas: [
              {
                root: '/data/repo-one',
                name: 'repo-one',
                model: 'text-embedding-3-small',
              },
            ],
          }),
        }) as unknown as import('chromadb').Collection,
      getVectorsCollection: async () =>
        ({
          query: async (opts: { queryEmbeddings?: number[][] }) => {
            queryEmbeddingSeen = opts.queryEmbeddings?.[0] ?? null;
            return {
              ids: [['chunk-1']],
              documents: [['chunk text']],
              metadatas: [
                [
                  {
                    root: '/data/repo-one',
                    relPath: 'README.md',
                    model: 'text-embedding-3-small',
                    chunkHash: 'chunk-1',
                  },
                ],
              ],
              distances: [[0.25]],
            };
          },
        }) as unknown as import('chromadb').Collection,
      getLockedModel: async () => 'text-embedding-3-small',
      getLockedEmbeddingModel: async () => ({
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 1536,
        lockedModelId: 'text-embedding-3-small',
        source: 'canonical',
      }),
      generateLockedQueryEmbedding: async (query: string) => {
        assert.equal(query, 'hello');
        return {
          embedding: [0.1, 0.2, 0.3],
          lock: {
            embeddingProvider: 'openai' as const,
            embeddingModel: 'text-embedding-3-small',
            embeddingDimensions: 3,
            lockedModelId: 'text-embedding-3-small',
            source: 'canonical' as const,
          },
        };
      },
    }),
  );

  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'VectorSearch',
        arguments: {
          query: 'hello',
        },
      },
    })
    .expect(200);

  assert.deepEqual(queryEmbeddingSeen, [0.1, 0.2, 0.3]);
  const payload = JSON.parse(response.body.result.content[0].text as string);
  assert.equal(payload.modelId, 'text-embedding-3-small');
});
