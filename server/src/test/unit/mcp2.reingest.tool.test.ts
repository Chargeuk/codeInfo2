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

const paritySuccessPayload = {
  status: 'started',
  operation: 'reembed',
  runId: 'run-123',
  sourceId: '/data/repo-a',
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

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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

test('MCP v2 success payload contract for reingest_repository', async () => {
  setToolDeps({
    runReingestRepository: async () =>
      ({ ok: true, value: paritySuccessPayload }) as ReingestResult,
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
    assert.deepEqual(parsed, paritySuccessPayload);
    assert.equal(JSON.stringify(parsed), JSON.stringify(paritySuccessPayload));
  });
});

test('MCP v2 failures use JSON-RPC error envelope (not result.isError)', async () => {
  setToolDeps({
    runReingestRepository: async () =>
      ({ ok: false, error: parityInvalidParamsError }) as ReingestResult,
  });

  await runWithServer(async (port) => {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'reingest_repository', arguments: {} },
    });

    assert.equal(body.result, undefined);
    assert.deepEqual(body.error, parityInvalidParamsError);
  });
});

test('MCP v2 INVALID_PARAMS and NOT_FOUND include retry guidance fields', async () => {
  setToolDeps({
    runReingestRepository: async (args) => {
      const sourceId =
        typeof args === 'object' && args
          ? (args as { sourceId?: string }).sourceId
          : undefined;
      if (sourceId === '/data/missing') {
        return { ok: false, error: parityNotFoundError } as ReingestResult;
      }
      return { ok: false, error: parityInvalidParamsError } as ReingestResult;
    },
  });

  await runWithServer(async (port) => {
    const invalid = await postJson(port, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: 'repo-a' },
      },
    });
    assert.equal(invalid.error.code, -32602);
    assert.deepEqual(invalid.error.data.reingestableRepositoryIds, ['repo-a']);
    assert.deepEqual(invalid.error.data.reingestableSourceIds, [
      '/data/repo-a',
    ]);

    const notFound = await postJson(port, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/missing' },
      },
    });
    assert.deepEqual(notFound.error, parityNotFoundError);
    assert.equal(
      JSON.stringify(notFound.error),
      JSON.stringify(parityNotFoundError),
    );
  });
});

test('MCP v2 BUSY mapping uses code 429 and message BUSY', async () => {
  setToolDeps({
    runReingestRepository: async () =>
      ({ ok: false, error: parityBusyError }) as ReingestResult,
  });

  await runWithServer(async (port) => {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'reingest_repository',
        arguments: { sourceId: '/data/repo-a' },
      },
    });

    assert.deepEqual(body.error, parityBusyError);
  });
});
