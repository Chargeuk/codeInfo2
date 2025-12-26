import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { validateVectorSearch } from '../../lmstudio/toolService.js';
import { createMcpRouter } from '../../mcp/server.js';

type FixtureDeps = Partial<Parameters<typeof createMcpRouter>[0]>;

const baseApp = (overrides: FixtureDeps = {}) => {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-1',
            description: 'demo repo',
            containerPath: '/data/repo-1',
            hostPath: '/host/repo-1',
            hostPathWarning: undefined,
            lastIngestAt: null,
            modelId: 'embed-model',
            counts: { files: 1, chunks: 1, embedded: 1 },
            lastError: null,
          },
        ],
        lockedModelId: 'embed-model',
      }),
      vectorSearch: async () => ({
        results: [
          {
            repo: 'repo-1',
            relPath: 'file.txt',
            containerPath: '/data/repo-1/file.txt',
            hostPath: '/host/repo-1/file.txt',
            hostPathWarning: undefined,
            score: 0.9,
            chunk: 'hello',
            chunkId: 'chunk-1',
            modelId: 'embed-model',
            lineCount: 1,
          },
        ],
        modelId: 'embed-model',
        files: [
          {
            hostPath: '/host/repo-1/file.txt',
            highestMatch: 0.9,
            chunkCount: 1,
            lineCount: 1,
            hostPathWarning: undefined,
            repo: 'repo-1',
            modelId: 'embed-model',
          },
        ],
      }),
      validateVectorSearch,
      getRootsCollection: async () =>
        ({}) as unknown as import('chromadb').Collection,
      getVectorsCollection: async () =>
        ({}) as unknown as import('chromadb').Collection,
      getLockedModel: async () => 'embed-model',
      ...overrides,
    }),
  );
  return app;
};

test('tools/call responses are returned as text content', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ListIngestedRepositories', arguments: {} },
    });

  assert.equal(res.status, 200);
  const content = res.body.result.content[0];
  assert.equal(content.type, 'text');
  const parsed = JSON.parse(content.text as string);
  assert.equal(parsed.repos[0].id, 'repo-1');
});

test('VectorSearch content is text and parsable', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'VectorSearch', arguments: { query: 'hello' } },
    });

  assert.equal(res.status, 200);
  const content = res.body.result.content[0];
  assert.equal(content.type, 'text');
  const parsed = JSON.parse(content.text as string);
  assert.equal(parsed.results[0].chunk, 'hello');
});

test('resources/list and resources/listTemplates return empty arrays', async () => {
  const listRes = await request(baseApp())
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 3, method: 'resources/list' });

  assert.equal(listRes.status, 200);
  assert.deepEqual(listRes.body.result.resources, []);

  const templatesRes = await request(baseApp())
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 4, method: 'resources/listTemplates' });

  assert.equal(templatesRes.status, 200);
  assert.deepEqual(templatesRes.body.result.resourceTemplates, []);
});
