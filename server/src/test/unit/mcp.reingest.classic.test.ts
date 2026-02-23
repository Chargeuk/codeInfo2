import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import type { ReingestResult } from '../../ingest/reingestService.js';
import { createMcpRouter } from '../../mcp/server.js';

const baseSuccess = {
  status: 'started',
  operation: 'reembed',
  runId: 'run-123',
  sourceId: '/data/repo-a',
} as const;

function createApp(result: ReingestResult) {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      runReingestRepository: async () => result,
    }),
  );
  return app;
}

test('tools/list includes reingest_repository metadata', async () => {
  const app = createApp({ ok: true, value: baseSuccess });
  const res = await request(app)
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  assert.equal(res.status, 200);
  const tools = res.body.result.tools as Array<{ name: string }>;
  assert.ok(tools.some((tool) => tool.name === 'reingest_repository'));
});

test('classic MCP success payload for reingest_repository is wrapped as text JSON', async () => {
  const app = createApp({ ok: true, value: baseSuccess });
  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/repo-a' },
      },
    });

  assert.equal(res.status, 200);
  const content = res.body.result.content[0] as { type: string; text: string };
  assert.equal(content.type, 'text');
  assert.deepEqual(JSON.parse(content.text), baseSuccess);
});

test('classic MCP failures use JSON-RPC error envelope (not result.isError)', async () => {
  const app = createApp({
    ok: false,
    error: {
      code: -32602,
      message: 'INVALID_PARAMS',
      data: {
        tool: 'reingest_repository',
        code: 'INVALID_SOURCE_ID',
        retryable: true,
        retryMessage: 'retry',
        fieldErrors: [
          { field: 'sourceId', reason: 'missing', message: 'required' },
        ],
        reingestableRepositoryIds: ['repo-a'],
        reingestableSourceIds: ['/data/repo-a'],
      },
    },
  });
  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'reingest_repository', arguments: {} },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.result, undefined);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.message, 'INVALID_PARAMS');
});

test('classic MCP INVALID_PARAMS and NOT_FOUND include retry guidance fields', async () => {
  const invalidApp = createApp({
    ok: false,
    error: {
      code: -32602,
      message: 'INVALID_PARAMS',
      data: {
        tool: 'reingest_repository',
        code: 'INVALID_SOURCE_ID',
        retryable: true,
        retryMessage: 'retry',
        fieldErrors: [
          { field: 'sourceId', reason: 'non_absolute', message: 'invalid' },
        ],
        reingestableRepositoryIds: ['repo-a'],
        reingestableSourceIds: ['/data/repo-a'],
      },
    },
  });

  const invalidRes = await request(invalidApp)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: 'repo-a' },
      },
    });

  assert.deepEqual(invalidRes.body.error.data.reingestableRepositoryIds, [
    'repo-a',
  ]);
  assert.deepEqual(invalidRes.body.error.data.reingestableSourceIds, [
    '/data/repo-a',
  ]);

  const notFoundApp = createApp({
    ok: false,
    error: {
      code: 404,
      message: 'NOT_FOUND',
      data: {
        tool: 'reingest_repository',
        code: 'NOT_FOUND',
        retryable: true,
        retryMessage: 'retry',
        fieldErrors: [
          { field: 'sourceId', reason: 'unknown_root', message: 'unknown' },
        ],
        reingestableRepositoryIds: ['repo-a'],
        reingestableSourceIds: ['/data/repo-a'],
      },
    },
  });

  const notFoundRes = await request(notFoundApp)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/missing' },
      },
    });

  assert.equal(notFoundRes.body.error.code, 404);
  assert.equal(notFoundRes.body.error.message, 'NOT_FOUND');
  assert.deepEqual(notFoundRes.body.error.data.reingestableRepositoryIds, [
    'repo-a',
  ]);
  assert.deepEqual(notFoundRes.body.error.data.reingestableSourceIds, [
    '/data/repo-a',
  ]);
});

test('classic MCP maps BUSY to code 429 and message BUSY', async () => {
  const app = createApp({
    ok: false,
    error: {
      code: 429,
      message: 'BUSY',
      data: {
        tool: 'reingest_repository',
        code: 'BUSY',
        retryable: true,
        retryMessage: 'retry',
        fieldErrors: [{ field: 'sourceId', reason: 'busy', message: 'busy' }],
        reingestableRepositoryIds: ['repo-a'],
        reingestableSourceIds: ['/data/repo-a'],
      },
    },
  });

  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/repo-a' },
      },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, 429);
  assert.equal(res.body.error.message, 'BUSY');
});
