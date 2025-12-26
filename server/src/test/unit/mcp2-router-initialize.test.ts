import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import serverPackage from '../../../package.json' with { type: 'json' };
import { handleRpc } from '../../mcp2/router.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('initialize returns protocolVersion, capabilities, and serverInfo', async () => {
  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const payload = { jsonrpc: '2.0', id: 99, method: 'initialize' };
    const body = await postJson(port, payload);

    assert.equal(body.result.protocolVersion, '2024-11-05');
    assert.deepEqual(body.result.capabilities, {
      tools: { listChanged: false },
    });
    assert.deepEqual(body.result.serverInfo, {
      name: 'codeinfo2-mcp',
      version: serverPackage.version,
    });
  } finally {
    server.close();
  }
});

test('initialize still returns capabilities when Codex is unavailable', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'false';
  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const payload = { jsonrpc: '2.0', id: 100, method: 'initialize' };
    const body = await postJson(port, payload);

    assert.equal(body.result.protocolVersion, '2024-11-05');
    assert.deepEqual(body.result.capabilities, {
      tools: { listChanged: false },
    });
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});
