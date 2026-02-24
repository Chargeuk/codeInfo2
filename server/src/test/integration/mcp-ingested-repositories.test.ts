import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import request from 'supertest';
import { createMcpRouter } from '../../mcp/server.js';

function createMcpApp(
  roots: { ids: string[]; metadatas: Record<string, unknown>[] },
  lockedModelId: string | null,
) {
  const app = express();
  app.use(express.json());
  app.use(
    createMcpRouter({
      getRootsCollection: async () =>
        ({
          get: async () => roots,
        }) as never,
      getLockedModel: async () => lockedModelId,
    }),
  );
  return app;
}

test('ListIngestedRepositories returns canonical and compatibility lock fields', async () => {
  const app = createMcpApp(
    {
      ids: ['run-1'],
      metadatas: [
        {
          name: 'repo',
          root: '/data/repo',
          model: 'embed-model',
          files: 3,
          chunks: 12,
          embedded: 12,
          lastIngestAt: '2026-01-01T00:00:00.000Z',
          state: 'completed',
          description: 'sample',
          lastError: null,
        },
      ],
    },
    'text-embedding-openai',
  );
  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'contract-parity',
      method: 'tools/call',
      params: {
        name: 'ListIngestedRepositories',
        arguments: {},
      },
    });

  assert.equal(response.status, 200);
  const parsed = JSON.parse(
    response.body?.result?.content?.[0]?.text ?? '{}',
  ) as {
    lock: {
      embeddingProvider: string;
      embeddingModel: string;
      embeddingDimensions: number;
      lockedModelId: string;
      modelId: string;
    } | null;
    lockedModelId: string | null;
    schemaVersion: string;
    repos: Array<{
      id: string;
      embeddingProvider: string;
      embeddingModel: string;
      embeddingDimensions: number;
      model: string;
      modelId: string;
      lock: { embeddingModel: string; modelId: string; lockedModelId: string };
    }>;
  };
  assert.equal(parsed.lockedModelId, 'text-embedding-openai');
  assert.equal(parsed.lock?.embeddingModel, 'text-embedding-openai');
  assert.equal(parsed.lock?.modelId, 'text-embedding-openai');
  assert.equal(parsed.schemaVersion, '0000036-t10-canonical-alias-v1');
  assert.equal(parsed.repos.length, 1);
  assert.equal(parsed.repos[0].embeddingProvider, 'lmstudio');
  assert.equal(parsed.repos[0].embeddingModel, 'embed-model');
  assert.equal(parsed.repos[0].model, 'embed-model');
  assert.equal(parsed.repos[0].modelId, 'embed-model');
  assert.equal(parsed.repos[0].lock.embeddingModel, 'embed-model');
  assert.equal(parsed.repos[0].lock.modelId, 'embed-model');
  assert.equal(parsed.repos[0].lock.lockedModelId, 'embed-model');
});

test('ListIngestedRepositories keeps provider-qualified identity when model ids collide', async () => {
  const app = createMcpApp(
    {
      ids: ['openai-run', 'lmstudio-run'],
      metadatas: [
        {
          name: 'openai-repo',
          root: '/data/openai',
          model: 'shared-id',
          embeddingProvider: 'openai',
          embeddingModel: 'shared-id',
          embeddingDimensions: 1536,
          files: 1,
          chunks: 1,
          embedded: 1,
        },
        {
          name: 'lmstudio-repo',
          root: '/data/lmstudio',
          model: 'shared-id',
          embeddingProvider: 'lmstudio',
          embeddingModel: 'shared-id',
          embeddingDimensions: 768,
          files: 1,
          chunks: 1,
          embedded: 1,
        },
      ],
    },
    'shared-id',
  );
  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'provider-collision',
      method: 'tools/call',
      params: {
        name: 'ListIngestedRepositories',
        arguments: {},
      },
    });

  assert.equal(response.status, 200);
  const parsed = JSON.parse(
    response.body?.result?.content?.[0]?.text ?? '{}',
  ) as {
    repos: Array<{
      id: string;
      embeddingProvider: string;
      embeddingModel: string;
      modelId: string;
    }>;
  };
  const openai = parsed.repos.find((repo) => repo.id === 'openai-repo');
  const lmstudio = parsed.repos.find((repo) => repo.id === 'lmstudio-repo');
  assert.equal(openai?.embeddingProvider, 'openai');
  assert.equal(openai?.embeddingModel, 'shared-id');
  assert.equal(openai?.modelId, 'shared-id');
  assert.equal(lmstudio?.embeddingProvider, 'lmstudio');
  assert.equal(lmstudio?.embeddingModel, 'shared-id');
  assert.equal(lmstudio?.modelId, 'shared-id');
});
