import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { createMcpRouter } from '../../mcp/server.js';

const payload = {
  results: [
    {
      repo: 'repo-one',
      relPath: 'docs/readme.md',
      containerPath: '/data/repo-one/docs/readme.md',
      hostPath: '/host/base/repo-one/docs/readme.md',
      score: 0.12,
      chunk: 'chunk body',
      chunkId: 'hash-1',
      modelId: 'text-embed',
      lineCount: 1,
    },
  ],
  modelId: 'text-embed',
  files: [
    {
      hostPath: '/host/base/repo-one/docs/readme.md',
      highestMatch: 0.12,
      chunkCount: 1,
      lineCount: 1,
      repo: 'repo-one',
      modelId: 'text-embed',
    },
  ],
};

test('classic MCP VectorSearch returns stable payload wrapped as tool text JSON', async () => {
  let capturedQuery: string | undefined;
  let capturedLimit: number | undefined;
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      vectorSearch: async (params) => {
        capturedQuery = params.query;
        capturedLimit = params.limit;
        return payload;
      },
    }),
  );

  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'VectorSearch',
        arguments: { query: 'hello world', limit: 5 },
      },
    });

  assert.equal(res.status, 200);
  assert.equal(capturedQuery, 'hello world');
  assert.equal(capturedLimit, 5);

  const content = res.body.result?.content?.[0];
  assert.equal(content?.type, 'text');
  const parsed = JSON.parse(content?.text as string);
  assert.equal(parsed.modelId, 'text-embed');
  assert.equal(parsed.results.length, 1);
  const result = parsed.results[0];
  assert.equal(result.repo, 'repo-one');
  assert.equal(result.hostPath, '/host/base/repo-one/docs/readme.md');
  assert.equal(result.modelId, 'text-embed');
  assert.equal(parsed.files.length, 1);
});

test('classic MCP VectorSearch validation error uses JSON-RPC error envelope', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      vectorSearch: async () => payload,
    }),
  );

  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'VectorSearch',
        arguments: {},
      },
    });

  assert.equal(res.status, 200);
  assert.ok(res.body.error, 'expected JSON-RPC error envelope');
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.data?.details?.length > 0, true);
});
