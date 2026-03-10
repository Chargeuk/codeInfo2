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

async function postRaw(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.text();
}

test('tools/list returns tool definitions when Codex is available', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const payload = { jsonrpc: '2.0', id: 10, method: 'tools/list' };
    const body = await postJson(port, payload);
    assert.ok(body.result, 'expected tools/list response to include a result');
    assert.ok(
      Array.isArray(body.result.tools),
      'expected tools/list response to include a tools array',
    );

    const tool = body.result.tools.find(
      (entry: { name: string }) => entry.name === 'codebase_question',
    ) as {
      name: string;
      description: string;
      inputSchema: {
        required: string[];
        properties: Record<string, unknown>;
      };
    } | undefined;

    assert.ok(tool, 'expected codebase_question tool to be present');
    assert.equal(tool.name, 'codebase_question');
    assert.ok(tool.inputSchema);
    assert.match(tool.description, /repository facts/i);
    assert.match(tool.description, /likely file locations/i);
    assert.match(tool.description, /summaries of existing implementations/i);
    assert.match(tool.description, /current contracts/i);
    assert.match(tool.description, /inspect .*source files directly/i);
    assert.match(tool.description, /do your own reasoning/i);
    assert.deepEqual(tool.inputSchema.required, ['question']);
    assert.ok(tool.inputSchema.properties.question);
    assert.ok(tool.inputSchema.properties.conversationId);
    assert.ok(tool.inputSchema.properties.provider);
    assert.ok(tool.inputSchema.properties.model);
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});

test('tools/list does not emit keepalive preamble bytes', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const payload = { jsonrpc: '2.0', id: 20, method: 'tools/list' };
    const raw = await postRaw(port, payload);
    assert.equal(raw.startsWith(' '), false);
    const body = JSON.parse(raw) as {
      result: { tools: Array<{ name: string }> };
    };
    assert.equal(Array.isArray(body.result.tools), true);
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});

test('tools/call emits keepalive preamble before JSON payload', async () => {
  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const raw = await postRaw(port, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: '__unknown_tool__', arguments: {} },
    });
    assert.equal(raw.startsWith(' '), true);
    const body = JSON.parse(raw.trimStart()) as { error: { code: number } };
    assert.equal(body.error.code, -32601);
  } finally {
    server.close();
  }
});
