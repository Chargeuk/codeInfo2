import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { handleAgentsRpc } from '../../mcpAgents/router.js';
import { resetToolDeps, setToolDeps } from '../../mcpAgents/tools.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('tools/call run_agent_instruction returns JSON text content with segments', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  setToolDeps({
    runAgentInstruction: async () => ({
      agentName: 'coding_agent',
      conversationId: 'c1',
      modelId: 'gpt-5.1-codex-max',
      segments: [
        { type: 'thinking', text: 't' },
        { type: 'answer', text: 'a' },
      ],
    }),
  });

  const server = http.createServer(handleAgentsRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'run_agent_instruction',
        arguments: { agentName: 'coding_agent', instruction: 'Say hello' },
      },
    });

    assert.equal(body.id, 11);
    const text = body.result.content[0].text as string;
    const parsed = JSON.parse(text) as {
      agentName: string;
      conversationId: string;
      modelId: string;
      segments: unknown[];
    };
    assert.equal(parsed.agentName, 'coding_agent');
    assert.equal(parsed.conversationId, 'c1');
    assert.equal(parsed.modelId, 'gpt-5.1-codex-max');
    assert.equal(Array.isArray(parsed.segments), true);
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    resetToolDeps();
    server.close();
  }
});
