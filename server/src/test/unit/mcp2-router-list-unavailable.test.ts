import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import { handleRpc } from '../../mcp2/router.js';
import { resetToolDeps, setToolDeps } from '../../mcp2/tools.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('tools/list remains available when Codex is unavailable', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'false';
  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const body = await postJson(port, payload);

    assert.equal(body.error, undefined);
    assert.equal(Array.isArray(body.result.tools), true);
    assert.equal(body.result.tools[0].name, 'codebase_question');
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});

test('tools/call(codebase_question) is not globally pre-blocked when Codex is unavailable', async () => {
  const originalCodexAvailable = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalLmBaseUrl = process.env.LMSTUDIO_BASE_URL;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'false';
  process.env.LMSTUDIO_BASE_URL = 'ws://localhost:1234';

  setToolDeps({
    clientFactory: () =>
      ({
        system: {
          listDownloadedModels: async () => [
            {
              modelKey: 'mock-model',
              displayName: 'mock-model',
              type: 'gguf',
            },
          ],
        },
        llm: {
          model: async () => ({
            act: async (_chat: unknown, _tools: unknown, opts?: unknown) => {
              const callbacks = opts as {
                onMessage?: (message: unknown) => void;
              };
              callbacks.onMessage?.({
                role: 'assistant',
                content: [{ type: 'text', text: 'lmstudio ok' }],
              });
            },
          }),
        },
      }) as unknown as LMStudioClient,
  });

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'hello?',
          provider: 'lmstudio',
          model: 'mock-model',
        },
      },
    });

    assert.equal(body.error, undefined);
    assert.equal(body.result.content[0].type, 'text');
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = originalCodexAvailable;
    if (originalLmBaseUrl === undefined) {
      delete process.env.LMSTUDIO_BASE_URL;
    } else {
      process.env.LMSTUDIO_BASE_URL = originalLmBaseUrl;
    }
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
