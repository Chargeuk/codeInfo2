import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { handleAgentsRpc } from '../../mcpAgents/router.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('tools/list returns exactly list_agents and run_agent_instruction', async () => {
  const server = http.createServer(handleAgentsRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const payload = { jsonrpc: '2.0', id: 10, method: 'tools/list' };
    const body = await postJson(port, payload);

    const names = (body.result.tools as Array<{ name: string }>).map(
      (tool) => tool.name,
    );
    assert.deepEqual(names.sort(), ['list_agents', 'run_agent_instruction']);
  } finally {
    server.close();
  }
});
