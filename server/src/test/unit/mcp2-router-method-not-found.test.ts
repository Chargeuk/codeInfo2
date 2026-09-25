import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { handleRpc } from '../../mcp2/router.js';
import {
  closeHttpServer,
  waitForHttpServerPort,
} from '../support/httpServer.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('unknown JSON-RPC method returns -32601 Method not found', async () => {
  const server = http.createServer(handleRpc);
  server.listen(0);
  const port = await waitForHttpServerPort(server);

  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 9,
      method: 'nope',
    });
    assert.equal(body.id, 9);
    assert.deepEqual(body.error, { code: -32601, message: 'Method not found' });
  } finally {
    await closeHttpServer(server);
  }
});
