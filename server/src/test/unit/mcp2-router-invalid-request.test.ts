import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach, mock } from 'node:test';
import { handleRpc } from '../../mcp2/router.js';
import {
  closeHttpServer,
  waitForHttpServerPort,
} from '../support/httpServer.js';

afterEach(() => {
  mock.restoreAll();
});

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('invalid JSON-RPC request shape returns -32600 Invalid Request', async () => {
  const server = http.createServer(handleRpc);
  server.listen(0);
  const port = await waitForHttpServerPort(server);

  try {
    const body = await postJson(port, { jsonrpc: '2.0', id: 123, method: 42 });
    assert.equal(body.id, 123);
    assert.deepEqual(body.error, { code: -32600, message: 'Invalid Request' });
  } finally {
    await closeHttpServer(server);
  }
});

test('mcp2 router does not dump raw tool errors to console.error', async () => {
  const errorLogCalls: unknown[][] = [];
  const server = http.createServer(handleRpc);
  server.listen(0);
  const port = await waitForHttpServerPort(server);

  mock.method(console, 'error', (...args: unknown[]) => {
    errorLogCalls.push(args);
  });

  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 124,
      method: 'tools/call',
      params: {
        name: 'not_a_real_tool',
        arguments: {},
      },
    });

    assert.deepEqual(body.error, {
      code: -32601,
      message: 'Tool not found: not_a_real_tool',
    });
    assert.deepEqual(errorLogCalls, []);
  } finally {
    await closeHttpServer(server);
  }
});
