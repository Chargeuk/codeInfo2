import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import {
  ValidationError,
  validateVectorSearch,
} from '../../lmstudio/toolService.js';
import { createMcpRouter } from '../../mcp/server.js';

const baseApp = (
  overrides: Partial<Parameters<typeof createMcpRouter>[0]> = {},
) => {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-1',
            description: null,
            containerPath: '/data/repo-1',
            hostPath: '/host/repo-1',
            hostPathWarning: undefined,
            lastIngestAt: null,
            modelId: 'embed-model',
            counts: { files: 1, chunks: 2, embedded: 2 },
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
            score: 0.25,
            chunk: 'hello world',
            chunkId: 'chunk-1',
            modelId: 'embed-model',
            lineCount: 1,
          },
        ],
        modelId: 'embed-model',
        files: [],
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

test('initialize returns protocol and capabilities', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

  assert.equal(res.status, 200);
  assert.equal(res.body.jsonrpc, '2.0');
  assert.equal(res.body.id, 1);
  assert.equal(res.body.result.protocolVersion, '2024-11-05');
  assert.deepEqual(res.body.result.capabilities, {
    tools: { listChanged: false },
  });
});

test('tools/list returns MCP tool definitions', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

  assert.equal(res.status, 200);
  const tools = res.body.result.tools as { name: string }[];
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('ListIngestedRepositories'));
  assert.ok(names.includes('VectorSearch'));
});

test('tools/call executes ListIngestedRepositories', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'ListIngestedRepositories', arguments: {} },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.id, 3);
  const content = res.body.result.content[0];
  assert.equal(content.type, 'text');
  const parsed = JSON.parse(content.text as string);
  assert.equal(parsed.repos[0].id, 'repo-1');
});

test('tools/call validates VectorSearch arguments', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'VectorSearch', arguments: {} },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.message, 'VALIDATION_FAILED');
  assert.ok(
    (res.body.error.data.details as string[]).includes('query is required'),
  );
});

test('unknown tool returns invalid params error', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'Nope', arguments: {} },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.message, 'Unknown tool Nope');
});

test('method not found returns -32601', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 6, method: 'unknown' });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32601);
  assert.equal(res.body.error.message, 'Method not found');
});

test('invalid request shape returns -32600', async () => {
  const res = await request(baseApp()).post('/mcp').send({ wrong: true });

  assert.equal(res.status, 200);
  assert.equal(res.body.id, undefined);
  assert.equal(res.body.error.code, -32600);
  assert.equal(res.body.error.message, 'Invalid Request');
});

test('tools/call surfaces internal errors', async () => {
  const res = await request(
    baseApp({
      vectorSearch: async () => {
        throw new Error('boom');
      },
      validateVectorSearch: () => ({ query: 'hi', limit: 5 }),
    }),
  )
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'VectorSearch', arguments: { query: 'hi' } },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32603);
  assert.equal(res.body.error.message, 'Internal error');
  assert.deepEqual(res.body.error.data, { message: 'Error: boom' });
});

test('tools/call propagates validation error instances', async () => {
  const res = await request(
    baseApp({
      validateVectorSearch: () => {
        throw new ValidationError(['bad']);
      },
    }),
  )
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'VectorSearch', arguments: {} },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.message, 'VALIDATION_FAILED');
  assert.deepEqual(res.body.error.data, { details: ['bad'] });
});
