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

test('classic MCP VectorSearch accepts host-path repository selectors', async () => {
  const originalHost = process.env.CODEINFO_HOST_INGEST_DIR;
  process.env.CODEINFO_HOST_INGEST_DIR = '/Users/example/dev';

  let capturedWhere: Record<string, unknown> | undefined;

  try {
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createMcpRouter({
        listIngestedRepositories: async () => ({
          repos: [
            {
              id: 'Repo-One',
              description: null,
              containerPath: '/data/repo-one',
              hostPath: '/Users/example/dev/repo-one',
              lastIngestAt: '2025-01-01T00:00:00.000Z',
              embeddingProvider: 'lmstudio',
              embeddingModel: 'text-embedding-3-small',
              embeddingDimensions: 768,
              model: 'text-embedding-3-small',
              modelId: 'text-embedding-3-small',
              lock: {
                embeddingProvider: 'lmstudio',
                embeddingModel: 'text-embedding-3-small',
                embeddingDimensions: 768,
                lockedModelId: 'text-embedding-3-small',
                modelId: 'text-embedding-3-small',
              },
              counts: { files: 1, chunks: 1, embedded: 1 },
              lastError: null,
            },
          ],
          lockedModelId: 'text-embedding-3-small',
        }),
        getRootsCollection: async () =>
          ({
            get: async () => ({
              ids: ['run-1'],
              metadatas: [
                {
                  root: '/data/repo-one',
                  name: 'Repo-One',
                  model: 'text-embedding-3-small',
                },
              ],
            }),
          }) as unknown as import('chromadb').Collection,
        getVectorsCollection: async () =>
          ({
            query: async (opts: { where?: Record<string, unknown> }) => {
              capturedWhere = opts.where;
              return {
                ids: [[]],
                documents: [[]],
                metadatas: [[]],
                distances: [[]],
              };
            },
          }) as unknown as import('chromadb').Collection,
        getLockedModel: async () => 'text-embedding-3-small',
      }),
    );

    await request(app)
      .post('/mcp')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'VectorSearch',
          arguments: {
            query: 'hello',
            repository: '/Users/example/dev/repo-one',
          },
        },
      })
      .expect(200);

    assert.deepEqual(capturedWhere, { root: '/data/repo-one' });
  } finally {
    if (originalHost === undefined) {
      delete process.env.CODEINFO_HOST_INGEST_DIR;
    } else {
      process.env.CODEINFO_HOST_INGEST_DIR = originalHost;
    }
  }
});
