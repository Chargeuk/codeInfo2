import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import request from 'supertest';
import { createMcpRouter } from '../../mcp/server.js';

function createMcpApp({ lockedModelId }: { lockedModelId: string | null }) {
  const app = express();
  app.use(express.json());
  app.use(
    createMcpRouter({
      getRootsCollection: async () =>
        ({
          get: async () => ({
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
          }),
        }) as never,
      getLockedModel: async () => lockedModelId,
    }),
  );
  return app;
}

test('ListIngestedRepositories returns canonical lock from resolver', async () => {
  const app = createMcpApp({ lockedModelId: 'text-embedding-openai' });
  const response = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'lock-parity',
      method: 'tools/call',
      params: {
        name: 'ListIngestedRepositories',
        arguments: {},
      },
    });

  assert.equal(response.status, 200);
  assert.equal(typeof response.body?.result?.content?.[0]?.text, 'string');
  const parsed = JSON.parse(
    response.body?.result?.content?.[0]?.text ?? '{}',
  ) as {
    lockedModelId: string | null;
    repos: Array<{ id: string; modelId: string; hostPath: string }>;
  };
  assert.equal(parsed.lockedModelId, 'text-embedding-openai');
  assert.equal(parsed.repos.length, 1);
  assert.equal(parsed.repos[0].id, 'repo');
  assert.equal(parsed.repos[0].modelId, 'embed-model');
});
