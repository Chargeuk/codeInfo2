import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import request from 'supertest';

import { handleRpc } from '../../mcp2/router.js';

test('MCP tools/call rejects actually unsupported provider names', async () => {
  const server = http.createServer((req, res) => void handleRpc(req, res));

  const res = await request(server)
    .post('/')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'hi there', provider: 'bad-provider' },
      },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32602);
  assert.equal(String(res.body.error.message), 'Invalid params');
});
