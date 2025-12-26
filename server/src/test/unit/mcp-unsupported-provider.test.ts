import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach } from 'node:test';
import request from 'supertest';

import { UnsupportedProviderError } from '../../chat/factory.js';
import { handleRpc } from '../../mcp2/router.js';
import { resetToolDeps, setToolDeps } from '../../mcp2/tools.js';

const ORIGINAL_FORCE = process.env.MCP_FORCE_CODEX_AVAILABLE;

afterEach(() => {
  if (ORIGINAL_FORCE === undefined) {
    delete process.env.MCP_FORCE_CODEX_AVAILABLE;
  } else {
    process.env.MCP_FORCE_CODEX_AVAILABLE = ORIGINAL_FORCE;
  }
  resetToolDeps();
});

test('MCP tools/call returns JSON-RPC error for unsupported provider', async () => {
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  setToolDeps({
    chatFactory: () => {
      throw new UnsupportedProviderError('bad-provider');
    },
  });

  const server = http.createServer((req, res) => void handleRpc(req, res));

  const res = await request(server)
    .post('/')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'hi there', provider: 'codex' },
      },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32602);
  assert.equal(
    res.body.error.message,
    'Unsupported chat provider: bad-provider',
  );
});
