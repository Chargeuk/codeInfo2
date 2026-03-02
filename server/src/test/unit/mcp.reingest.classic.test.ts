import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import type {
  ReingestError,
  ReingestResult,
} from '../../ingest/reingestService.js';
import { createMcpRouter } from '../../mcp/server.js';

const terminalCompleted = {
  status: 'completed',
  operation: 'reembed',
  runId: 'run-123',
  sourceId: '/data/repo-a',
  durationMs: 321,
  files: 9,
  chunks: 20,
  embedded: 15,
  errorCode: null,
} as const;

const terminalCancelled = {
  ...terminalCompleted,
  status: 'cancelled',
} as const;

const terminalError = {
  ...terminalCompleted,
  status: 'error',
  errorCode: 'INGEST_FAIL',
} as const;

const parityInvalidParamsError: Extract<ReingestError, { code: -32602 }> = {
  code: -32602,
  message: 'INVALID_PARAMS',
  data: {
    tool: 'reingest_repository',
    code: 'INVALID_SOURCE_ID',
    retryable: true,
    retryMessage:
      'The AI can retry using one of the provided re-ingestable repository ids/sourceIds.',
    fieldErrors: [
      { field: 'sourceId', reason: 'missing', message: 'required' },
    ],
    reingestableRepositoryIds: ['repo-a'],
    reingestableSourceIds: ['/data/repo-a'],
  },
};

const parityNotFoundError: Extract<ReingestError, { code: 404 }> = {
  code: 404,
  message: 'NOT_FOUND',
  data: {
    tool: 'reingest_repository',
    code: 'NOT_FOUND',
    retryable: true,
    retryMessage:
      'The AI can retry using one of the provided re-ingestable repository ids/sourceIds.',
    fieldErrors: [
      { field: 'sourceId', reason: 'unknown_root', message: 'unknown' },
    ],
    reingestableRepositoryIds: ['repo-a'],
    reingestableSourceIds: ['/data/repo-a'],
  },
};

const parityBusyError: Extract<ReingestError, { code: 429 }> = {
  code: 429,
  message: 'BUSY',
  data: {
    tool: 'reingest_repository',
    code: 'BUSY',
    retryable: true,
    retryMessage:
      'The AI can retry using one of the provided re-ingestable repository ids/sourceIds.',
    fieldErrors: [{ field: 'sourceId', reason: 'busy', message: 'busy' }],
    reingestableRepositoryIds: ['repo-a'],
    reingestableSourceIds: ['/data/repo-a'],
  },
};

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
  const app = createApp({ ok: true, value: terminalCompleted });
  const res = await request(app)
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  assert.equal(res.status, 200);
  const tools = res.body.result.tools as Array<{ name: string }>;
  assert.ok(tools.some((tool) => tool.name === 'reingest_repository'));
});

test('classic MCP wraps terminal payload as text JSON and never returns started', async () => {
  const app = createApp({ ok: true, value: terminalCompleted });
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
  const payload = JSON.parse(content.text);
  assert.equal(payload.status, 'completed');
  assert.notEqual(payload.status, 'started');
  assert.equal(typeof content.text, 'string');
  assert.equal(payload.message, undefined);
});

test('classic MCP success/cancel/error errorCode constraints', async () => {
  for (const payload of [terminalCompleted, terminalCancelled, terminalError]) {
    const app = createApp({ ok: true, value: payload });
    const res = await request(app)
      .post('/mcp')
      .send({
        jsonrpc: '2.0',
        id: `code-${payload.status}`,
        method: 'tools/call',
        params: {
          name: 'reingest_repository',
          arguments: { sourceId: '/data/repo-a' },
        },
      });
    const parsed = JSON.parse(res.body.result.content[0].text);
    if (parsed.status === 'error') {
      assert.notEqual(parsed.errorCode, null);
    } else {
      assert.equal(parsed.errorCode, null);
    }
  }
});

test('classic MCP uses JSON-RPC envelope for pre-run validation errors', async () => {
  for (const error of [
    parityInvalidParamsError,
    parityNotFoundError,
    parityBusyError,
  ]) {
    const app = createApp({ ok: false, error });
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
    assert.deepEqual(res.body.error, error);
  }
});

test('classic MCP post-start failure remains terminal result (not JSON-RPC error)', async () => {
  const app = createApp({ ok: true, value: terminalError });
  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/repo-a' },
      },
    });

  assert.equal(res.body.error, undefined);
  const payload = JSON.parse(res.body.result.content[0].text);
  assert.equal(payload.status, 'error');
  assert.equal(payload.errorCode, 'INGEST_FAIL');
});

test('classic MCP request-shape guards reject wait/blocking args', async () => {
  const app = createApp({
    ok: false,
    error: {
      ...parityInvalidParamsError,
      data: {
        ...parityInvalidParamsError.data,
        fieldErrors: [
          {
            field: 'sourceId',
            reason: 'invalid_state',
            message: 'Unsupported arguments',
          },
        ],
      },
    },
  });

  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: {
          sourceId: '/data/repo-a',
          wait: true,
          blocking: true,
        },
      },
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.result, undefined);
});

test('classic and v2 parity payload baseline can be normalized from terminal fields', () => {
  const normalized = JSON.stringify(terminalCompleted);
  assert.equal(
    normalized,
    JSON.stringify({
      status: 'completed',
      operation: 'reembed',
      runId: 'run-123',
      sourceId: '/data/repo-a',
      durationMs: 321,
      files: 9,
      chunks: 20,
      embedded: 15,
      errorCode: null,
    }),
  );
});

test('classic MCP disconnect during blocking wait does not crash router', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      runReingestRepository: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { ok: true, value: terminalCompleted } as ReingestResult;
      },
    }),
  );

  const server = app.listen(0);
  try {
    const address = server.address();
    const port =
      address && typeof address === 'object' ? Number(address.port) : 0;
    const controller = new AbortController();
    const inflight = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'reingest_repository',
          arguments: { sourceId: '/data/repo-a' },
        },
      }),
      signal: controller.signal,
    }).catch(() => null);
    setTimeout(() => controller.abort(), 10);
    await inflight;

    const health = await request(app)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
    assert.equal(health.status, 200);
    assert.equal(Array.isArray(health.body.result.tools), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
