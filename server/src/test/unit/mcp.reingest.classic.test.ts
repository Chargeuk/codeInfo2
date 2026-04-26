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
  resolvedRepositoryId: 'repo-a',
  completionMode: 'reingested',
  durationMs: 321,
  files: 9,
  chunks: 20,
  embedded: 15,
  errorCode: null,
} as const;

const terminalCancelled = {
  ...terminalCompleted,
  status: 'cancelled',
  completionMode: null,
} as const;

const terminalError = {
  ...terminalCompleted,
  status: 'error',
  completionMode: null,
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

const parityQueueUnavailableError: Extract<ReingestError, { code: 503 }> = {
  code: 503,
  message: 'QUEUE_UNAVAILABLE',
  data: {
    tool: 'reingest_repository',
    code: 'QUEUE_UNAVAILABLE',
    retryable: true,
    retryMessage:
      'The AI can retry using one of the provided re-ingestable repository ids/sourceIds.',
    fieldErrors: [
      {
        field: 'sourceId',
        reason: 'invalid_state',
        message:
          'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
      },
    ],
    reingestableRepositoryIds: ['repo-a'],
    reingestableSourceIds: ['/data/repo-a'],
  },
};

const waitTimeQueueUnavailableError: Extract<ReingestError, { code: 503 }> = {
  ...parityQueueUnavailableError,
  data: {
    ...parityQueueUnavailableError.data,
    queueFailureStage: 'wait',
    waitReason: 'queue-read-failed',
    fieldErrors: [
      {
        field: 'sourceId',
        reason: 'invalid_state',
        message:
          'Mongo-backed ingest queue is unavailable while waiting for re-ingest completion',
      },
    ],
  },
};

const mixedShapeInvalidStateError: Extract<ReingestError, { code: -32602 }> = {
  ...parityInvalidParamsError,
  data: {
    ...parityInvalidParamsError.data,
    fieldErrors: [
      {
        field: 'sourceId',
        reason: 'invalid_state',
        message:
          'sourceId points to a repository that cannot be re-embedded in its current state',
      },
    ],
  },
};

function createApp(result: ReingestResult, onRun?: (args: unknown) => void) {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-a',
            description: null,
            containerPath: '/data/repo-a',
            hostPath: '/host/repo-a',
            lastIngestAt: '2025-01-01T00:00:00.000Z',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-model',
            embeddingDimensions: 768,
            model: 'embed-model',
            modelId: 'embed-model',
            lock: {
              embeddingProvider: 'lmstudio',
              embeddingModel: 'embed-model',
              embeddingDimensions: 768,
              lockedModelId: 'embed-model',
              modelId: 'embed-model',
            },
            counts: { files: 1, chunks: 2, embedded: 2 },
            lastError: null,
          },
        ],
        lockedModelId: 'embed-model',
      }),
      runReingestRepository: async (args) => {
        onRun?.(args);
        return result;
      },
    }),
  );
  return app;
}

async function callClassicReingestWithArguments(args: unknown) {
  let runCalled = false;
  const app = createApp({ ok: true, value: terminalCompleted }, () => {
    runCalled = true;
  });

  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'malformed-arguments',
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: args,
      },
    });

  return { res, runCalled };
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

test('classic MCP canonicalizes reingest sourceId selectors and preserves shared default wait dispatch', async () => {
  let capturedArgs: unknown;
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-a',
            description: null,
            containerPath: '/data/repo-a',
            hostPath: '/host/repo-a',
            lastIngestAt: '2025-01-01T00:00:00.000Z',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-model',
            embeddingDimensions: 768,
            model: 'embed-model',
            modelId: 'embed-model',
            lock: {
              embeddingProvider: 'lmstudio',
              embeddingModel: 'embed-model',
              embeddingDimensions: 768,
              lockedModelId: 'embed-model',
              modelId: 'embed-model',
            },
            counts: { files: 1, chunks: 2, embedded: 2 },
            lastError: null,
          },
        ],
        lockedModelId: 'embed-model',
      }),
      runReingestRepository: async (args) => {
        capturedArgs = args;
        return { ok: true, value: terminalCompleted } as ReingestResult;
      },
    }),
  );

  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 2.1,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/host/repo-a' },
      },
    });

  assert.equal(res.status, 200);
  assert.deepEqual(capturedArgs, { sourceId: '/data/repo-a' });
  assert.equal(
    typeof capturedArgs === 'object' &&
      capturedArgs !== null &&
      'waitOptions' in capturedArgs,
    false,
  );
});

test('classic MCP resolves stable repository ids even when an active overlay exposes a transient runId', async () => {
  let capturedArgs: unknown;
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-a',
            runId: 'active-run-a',
            description: null,
            containerPath: '/data/repo-a',
            hostPath: '/host/repo-a',
            lastIngestAt: '2025-01-01T00:00:00.000Z',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-model',
            embeddingDimensions: 768,
            model: 'embed-model',
            modelId: 'embed-model',
            lock: {
              embeddingProvider: 'lmstudio',
              embeddingModel: 'embed-model',
              embeddingDimensions: 768,
              lockedModelId: 'embed-model',
              modelId: 'embed-model',
            },
            counts: { files: 1, chunks: 2, embedded: 2 },
            lastError: null,
            status: 'ingesting',
            phase: 'scanning',
          },
        ],
        lockedModelId: 'embed-model',
      }),
      runReingestRepository: async (args) => {
        capturedArgs = args;
        return { ok: true, value: terminalCompleted } as ReingestResult;
      },
    }),
  );

  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 2.15,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: 'repo-a' },
      },
    });

  assert.equal(res.status, 200);
  assert.deepEqual(capturedArgs, { sourceId: '/data/repo-a' });
});

test('classic MCP leaves unresolved reingest selectors unchanged', async () => {
  let capturedArgs: unknown;
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-a',
            description: null,
            containerPath: '/data/repo-a',
            hostPath: '/host/repo-a',
            lastIngestAt: '2025-01-01T00:00:00.000Z',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-model',
            embeddingDimensions: 768,
            model: 'embed-model',
            modelId: 'embed-model',
            lock: {
              embeddingProvider: 'lmstudio',
              embeddingModel: 'embed-model',
              embeddingDimensions: 768,
              lockedModelId: 'embed-model',
              modelId: 'embed-model',
            },
            counts: { files: 1, chunks: 2, embedded: 2 },
            lastError: null,
          },
        ],
        lockedModelId: 'embed-model',
      }),
      runReingestRepository: async (args) => {
        capturedArgs = args;
        return { ok: true, value: terminalCompleted } as ReingestResult;
      },
    }),
  );

  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 2.2,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/host/missing' },
      },
    });

  assert.equal(res.status, 200);
  assert.deepEqual(capturedArgs, { sourceId: '/host/missing' });
});

test('classic MCP uses JSON-RPC envelope for pre-run validation and queue outage errors', async () => {
  for (const error of [
    parityInvalidParamsError,
    parityNotFoundError,
    parityQueueUnavailableError,
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

test('classic MCP preserves degraded-startup QUEUE_UNAVAILABLE diagnostic without rewriting it', async () => {
  const degradedStartupError: Extract<ReingestError, { code: 503 }> = {
    ...parityQueueUnavailableError,
    data: {
      ...parityQueueUnavailableError.data,
      fieldErrors: [
        {
          field: 'sourceId',
          reason: 'invalid_state',
          message:
            'Mongo-backed ingest queue is unavailable because Mongo connection failed during startup',
        },
      ],
    },
  };
  const app = createApp({ ok: false, error: degradedStartupError });
  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'degraded-startup-queue-unavailable',
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/repo-a' },
      },
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.error, degradedStartupError);
  assert.equal(res.body.error.data.retryable, true);
  assert.equal(
    res.body.error.data.fieldErrors[0].message,
    'Mongo-backed ingest queue is unavailable because Mongo connection failed during startup',
  );
});

test('classic MCP propagates wait-time queue-read outage as retryable QUEUE_UNAVAILABLE error envelope', async () => {
  const app = createApp({ ok: false, error: waitTimeQueueUnavailableError });
  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'wait-time-queue-read-unavailable',
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/repo-a' },
      },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.result, undefined);
  assert.deepEqual(res.body.error, waitTimeQueueUnavailableError);
  assert.equal(res.body.error.data.retryable, true);
  assert.equal(res.body.error.data.queueFailureStage, 'wait');
  assert.equal(res.body.error.data.waitReason, 'queue-read-failed');
});

test('classic MCP rejects string arguments as malformed request shape before domain validation', async () => {
  const { res, runCalled } =
    await callClassicReingestWithArguments('/data/repo-a');

  assert.equal(res.status, 200);
  assert.equal(runCalled, false);
  assert.equal(res.body.result, undefined);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.message, 'arguments must be an object');
});

test('classic MCP rejects array arguments as malformed request shape before domain validation', async () => {
  const { res, runCalled } = await callClassicReingestWithArguments([
    ['sourceId', '/data/repo-a'],
  ]);

  assert.equal(res.status, 200);
  assert.equal(runCalled, false);
  assert.equal(res.body.result, undefined);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.message, 'arguments must be an object');
});

test('classic MCP malformed arguments use dispatcher envelope instead of tool field errors', async () => {
  const { res } = await callClassicReingestWithArguments(
    'sourceId=/data/repo-a',
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.result, undefined);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.message, 'arguments must be an object');
  assert.equal(res.body.error.data, undefined);
});

test('classic MCP well-formed object arguments still reach reingest happy path', async () => {
  let capturedArgs: unknown;
  const app = createApp({ ok: true, value: terminalCompleted }, (args) => {
    capturedArgs = args;
  });
  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'well-formed-success',
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/repo-a' },
      },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error, undefined);
  assert.deepEqual(capturedArgs, { sourceId: '/data/repo-a' });
  const payload = JSON.parse(res.body.result.content[0].text);
  assert.equal(payload.status, 'completed');
});

test('classic MCP well-formed object arguments still reach domain error mapping', async () => {
  let runCalled = false;
  const app = createApp({ ok: false, error: parityInvalidParamsError }, () => {
    runCalled = true;
  });
  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'well-formed-domain-error',
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: {},
      },
    });

  assert.equal(res.status, 200);
  assert.equal(runCalled, true);
  assert.equal(res.body.result, undefined);
  assert.deepEqual(res.body.error, parityInvalidParamsError);
});

test('classic MCP returns the shared mixed-shape invalid-state tool error without throwing a transport-level exception', async () => {
  const app = createApp({ ok: false, error: mixedShapeInvalidStateError });
  const res = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 'mixed-shape-invalid-state',
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/repo-a' },
      },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.result, undefined);
  assert.deepEqual(res.body.error, mixedShapeInvalidStateError);
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

test('classic MCP reingest_repository advertises a sourceId-only schema without working/plan_scope targets', async () => {
  const app = createApp({ ok: true, value: terminalCompleted });
  const res = await request(app)
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 'schema-check', method: 'tools/list' });

  assert.equal(res.status, 200);
  const tools = res.body.result.tools as Array<{
    name: string;
    inputSchema: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
  }>;
  const reingestTool = tools.find(
    (tool) => tool.name === 'reingest_repository',
  );
  assert.ok(reingestTool);
  assert.deepEqual(reingestTool.inputSchema.required, ['sourceId']);
  assert.equal(reingestTool.inputSchema.additionalProperties, false);
  assert.deepEqual(
    Object.keys(reingestTool.inputSchema.properties ?? {}).sort((a, b) =>
      a.localeCompare(b),
    ),
    ['sourceId'],
  );
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
      resolvedRepositoryId: 'repo-a',
      completionMode: 'reingested',
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
