import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { query, resetStore } from '../../../logStore.js';
import { handleRpc } from '../../../mcp2/router.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function withTempCodexHome(chatToml: string): Promise<{
  codexHome: string;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-task8-validation-'),
  );
  const codexHome = path.join(root, 'codex');
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    chatToml,
    'utf8',
  );
  return {
    codexHome,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
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

test('codebase_question emits field-specific warning fields when falling back to legacy env defaults', async () => {
  const originalForce = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalCodeHome = process.env.CODEX_HOME;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  resetStore();
  const tempHome = await withTempCodexHome('# empty config\n');
  process.env.CODEX_HOME = tempHome.codexHome;
  process.env.Codex_sandbox_mode = 'workspace-write';
  process.env.Codex_approval_policy = 'on-request';
  process.env.Codex_reasoning_effort = 'medium';
  process.env.Codex_web_search_enabled = 'false';

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 201,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'warn-fields?' },
      },
    });
    assert.equal(body.id, 201);
    const markerLogs = query({
      source: ['server'],
      text: 'DEV_0000040_T08_MCP_DEFAULTS_APPLIED',
    });
    const context = markerLogs.at(-1)?.context as
      | { warningFields?: string[] }
      | undefined;
    assert.ok(Array.isArray(context?.warningFields));
    assert.ok(context?.warningFields?.includes('sandbox_mode'));
    assert.ok(context?.warningFields?.includes('approval_policy'));
    assert.ok(context?.warningFields?.includes('model_reasoning_effort'));
    assert.ok(context?.warningFields?.includes('web_search'));
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = originalForce;
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    delete process.env.Codex_sandbox_mode;
    delete process.env.Codex_approval_policy;
    delete process.env.Codex_reasoning_effort;
    delete process.env.Codex_web_search_enabled;
    await tempHome.cleanup();
    server.close();
  }
});

test('codebase_question validation rejects invalid provider values deterministically', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 202,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'invalid provider?', provider: 'bad-provider' },
      },
    });
    assert.equal(body.error.code, -32602);
    assert.equal(body.error.message, 'Invalid params');
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});
