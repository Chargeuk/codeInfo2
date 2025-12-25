import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  tryAcquireConversationLock,
  releaseConversationLock,
} from '../../../agents/runLock.js';
import { handleRpc } from '../../../mcp2/router.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('codebase_question returns 409 RUN_IN_PROGRESS when conversation is locked', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  assert.equal(tryAcquireConversationLock('conv-locked'), true);

  try {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'Hello?', conversationId: 'conv-locked' },
      },
    };

    const res = await postJson(port, payload);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 409);
    assert.equal(res.body.error.message, 'RUN_IN_PROGRESS');
  } finally {
    releaseConversationLock('conv-locked');
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});
