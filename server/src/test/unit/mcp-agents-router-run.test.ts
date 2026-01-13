import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import {
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../../agents/runLock.js';
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

test('tools/call run_agent_instruction returns JSON text content with answer-only segments', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  let receivedWorkingFolder: string | undefined;

  setToolDeps({
    runAgentInstruction: async (params) => {
      receivedWorkingFolder = (params as { working_folder?: string })
        .working_folder;
      return {
        agentName: 'coding_agent',
        conversationId: 'c1',
        modelId: 'model-from-config',
        segments: [
          { type: 'thinking', text: 't' },
          { type: 'answer', text: 'a' },
        ],
      };
    },
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
        arguments: {
          agentName: 'coding_agent',
          instruction: 'Say hello',
          working_folder: '/host/base/repo',
        },
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
    assert.equal(typeof parsed.modelId, 'string');
    assert.equal(parsed.modelId.length > 0, true);
    assert.equal(Array.isArray(parsed.segments), true);
    assert.deepEqual(
      parsed.segments.map((segment) => (segment as { type: string }).type),
      ['answer'],
    );
    assert.equal(receivedWorkingFolder, '/host/base/repo');
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    resetToolDeps();
    server.close();
  }
});

test('tools/call run_agent_instruction returns stable JSON-RPC error for RUN_IN_PROGRESS', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  assert.equal(tryAcquireConversationLock('c1'), true);

  const server = http.createServer(handleAgentsRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'run_agent_instruction',
        arguments: {
          agentName: '__nonexistent__',
          instruction: 'Say hello',
          conversationId: 'c1',
        },
      },
    });

    assert.equal(body.id, 22);
    assert.equal(body.error.code, 409);
    assert.equal(body.error.message, 'RUN_IN_PROGRESS');
    assert.equal(body.error.data.code, 'RUN_IN_PROGRESS');
  } finally {
    releaseConversationLock('c1');
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});

test('tools/call run_agent_instruction aborts tool call on disconnect (AbortSignal propagation)', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  let startedResolve: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });

  let abortedResolve: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => {
    abortedResolve = resolve;
  });

  setToolDeps({
    runAgentInstruction: async (params) => {
      const signal = (params as { signal?: AbortSignal }).signal;
      assert.equal(
        Boolean(signal && typeof signal.aborted === 'boolean'),
        true,
      );
      startedResolve?.();

      await new Promise<void>((resolve) => {
        if (!signal) return resolve();
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });

      abortedResolve?.();

      return {
        agentName: 'coding_agent',
        conversationId: 'c1',
        modelId: 'm1',
        segments: [{ type: 'answer', text: 'stopped' }],
      };
    },
  });

  const server = http.createServer(handleAgentsRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const url = `http://127.0.0.1:${port}`;
    const controller = new AbortController();

    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 33,
        method: 'tools/call',
        params: {
          name: 'run_agent_instruction',
          arguments: { agentName: 'coding_agent', instruction: 'Say hello' },
        },
      }),
      signal: controller.signal,
    });

    await started;
    controller.abort();

    await assert.rejects(fetchPromise, (err) => {
      return Boolean(
        err && typeof err === 'object' && (err as Error).name === 'AbortError',
      );
    });

    await aborted;
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    resetToolDeps();
    server.close();
  }
});

test('tools/call run_command aborts tool call on disconnect (AbortSignal propagation)', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  let startedResolve: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });

  let abortedResolve: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => {
    abortedResolve = resolve;
  });

  setToolDeps({
    runAgentCommand: async (params) => {
      const signal = (params as { signal?: AbortSignal }).signal;
      assert.equal(
        Boolean(signal && typeof signal.aborted === 'boolean'),
        true,
      );
      startedResolve?.();

      await new Promise<void>((resolve) => {
        if (!signal) return resolve();
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });

      abortedResolve?.();

      return {
        agentName: 'planning_agent',
        commandName: 'improve_plan',
        conversationId: 'c1',
        modelId: 'm1',
      };
    },
  });

  const server = http.createServer(handleAgentsRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const url = `http://127.0.0.1:${port}`;
    const controller = new AbortController();

    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 44,
        method: 'tools/call',
        params: {
          name: 'run_command',
          arguments: {
            agentName: 'planning_agent',
            commandName: 'improve_plan',
          },
        },
      }),
      signal: controller.signal,
    });

    await started;
    controller.abort();

    await assert.rejects(fetchPromise, (err) => {
      return Boolean(
        err && typeof err === 'object' && (err as Error).name === 'AbortError',
      );
    });

    await aborted;
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    resetToolDeps();
    server.close();
  }
});
