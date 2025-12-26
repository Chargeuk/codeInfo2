import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { handleRpc } from '../../../mcp2/router.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('codebase_question validation returns -32602 when question is missing', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const payload = {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { conversationId: 'abc' },
      },
    };

    const body = await postJson(port, payload);

    assert.equal(body.error.code, -32602);
    assert.equal(body.error.message, 'Invalid params');
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});
