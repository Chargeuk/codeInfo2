import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { handleRpc } from '../../mcp2/router.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('tools/list returns CODE_INFO_LLM_UNAVAILABLE when Codex is missing', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'false';
  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const body = await postJson(port, payload);

    assert.equal(body.error.code, -32001);
    assert.equal(body.error.message, 'CODE_INFO_LLM_UNAVAILABLE');
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});

test('resources/list and resources/listTemplates return empty arrays', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'false';
  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const listPayload = { jsonrpc: '2.0', id: 2, method: 'resources/list' };
    const templatesPayload = {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/listTemplates',
    };

    const resources = await postJson(port, listPayload);
    const templates = await postJson(port, templatesPayload);

    assert.deepEqual(resources.result, { resources: [] });
    assert.deepEqual(templates.result, { resource_templates: [] });
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});
