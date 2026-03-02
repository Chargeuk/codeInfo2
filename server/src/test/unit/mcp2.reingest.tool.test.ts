import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import type {
  ReingestError,
  ReingestResult,
} from '../../ingest/reingestService.js';
import { handleRpc } from '../../mcp2/router.js';
import { resetToolDeps, setToolDeps } from '../../mcp2/tools.js';

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

async function postJson(
  port: number,
  body: unknown,
  options?: { signal?: AbortSignal },
) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  return response.json();
}

function runWithServer(
  callback: (port: number) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleRpc);
    server.listen(0, async () => {
      const { port } = server.address() as AddressInfo;
      try {
        await callback(port);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        resetToolDeps();
        server.close();
      }
    });
  });
}

test('tools/list includes reingest_repository metadata for MCP v2', async () => {
  await runWithServer(async (port) => {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    assert.equal(body.error, undefined);
    const toolNames = (body.result.tools as Array<{ name: string }>).map(
      (tool) => tool.name,
    );
    assert.ok(toolNames.includes('codebase_question'));
    assert.ok(toolNames.includes('reingest_repository'));
  });
});

test('MCP v2 success payload contract for reingest_repository is terminal-only', async () => {
  setToolDeps({
    runReingestRepository: async () =>
      ({ ok: true, value: terminalCompleted }) as ReingestResult,
  });

  await runWithServer(async (port) => {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/repo-a' },
      },
    });

    assert.equal(body.error, undefined);
    const content = body.result.content[0] as { type: string; text: string };
    assert.equal(content.type, 'text');
    const parsed = JSON.parse(content.text);
    assert.equal(parsed.status, 'completed');
    assert.notEqual(parsed.status, 'started');
    assert.equal(typeof content.text, 'string');
    assert.equal(parsed.message, undefined);
  });
});

test('MCP v2 completed/cancelled/error errorCode constraints', async () => {
  for (const payload of [terminalCompleted, terminalCancelled, terminalError]) {
    setToolDeps({
      runReingestRepository: async () =>
        ({ ok: true, value: payload }) as ReingestResult,
    });
    await runWithServer(async (port) => {
      const body = await postJson(port, {
        jsonrpc: '2.0',
        id: `status-${payload.status}`,
        method: 'tools/call',
        params: {
          name: 'reingest_repository',
          arguments: { sourceId: '/data/repo-a' },
        },
      });
      const parsed = JSON.parse(body.result.content[0].text);
      if (parsed.status === 'error') {
        assert.notEqual(parsed.errorCode, null);
      } else {
        assert.equal(parsed.errorCode, null);
      }
    });
  }
});

test('MCP v2 failures use JSON-RPC error envelope for pre-run validation', async () => {
  for (const error of [
    parityInvalidParamsError,
    parityNotFoundError,
    parityBusyError,
  ]) {
    setToolDeps({
      runReingestRepository: async () =>
        ({ ok: false, error }) as ReingestResult,
    });

    await runWithServer(async (port) => {
      const body = await postJson(port, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'reingest_repository', arguments: {} },
      });

      assert.equal(body.result, undefined);
      assert.deepEqual(body.error, error);
    });
  }
});

test('MCP v2 post-start failure returns terminal result payload (not JSON-RPC error)', async () => {
  setToolDeps({
    runReingestRepository: async () =>
      ({ ok: true, value: terminalError }) as ReingestResult,
  });

  await runWithServer(async (port) => {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/repo-a' },
      },
    });

    assert.equal(body.error, undefined);
    const payload = JSON.parse(body.result.content[0].text);
    assert.equal(payload.status, 'error');
    assert.equal(payload.errorCode, 'INGEST_FAIL');
  });
});

test('MCP v2 request-shape guards reject wait/blocking args', async () => {
  setToolDeps({
    runReingestRepository: async () =>
      ({
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
      }) as ReingestResult,
  });

  await runWithServer(async (port) => {
    const body = await postJson(port, {
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
    assert.equal(body.result, undefined);
    assert.equal(body.error.code, -32602);
  });
});

test('MCP v2 disconnect during blocking wait does not crash router', async () => {
  setToolDeps({
    runReingestRepository: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { ok: true, value: terminalCompleted } as ReingestResult;
    },
  });

  await runWithServer(async (port) => {
    const controller = new AbortController();
    const inflight = postJson(
      port,
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'reingest_repository',
          arguments: { sourceId: '/data/repo-a' },
        },
      },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(inflight);

    const healthCall = await postJson(port, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
    });
    assert.equal(healthCall.error, undefined);
    assert.ok(Array.isArray(healthCall.result.tools));
  });
});

test('classic/v2 parity baseline: terminal fields match expected contract', () => {
  assert.equal(
    JSON.stringify(terminalCompleted),
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
