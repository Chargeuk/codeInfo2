import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import type {
  ThreadEvent,
  ThreadOptions as CodexThreadOptions,
  TurnOptions as CodexTurnOptions,
} from '@openai/codex-sdk';

import { runCodebaseQuestion } from '../../mcp2/tools/codebaseQuestion.js';
import { handleRpc } from '../../mcp2/router.js';
import {
  getCodexDetection,
  setCodexDetection,
} from '../../providers/codexRegistry.js';

class MockThread {
  id: string;
  private readonly events: ThreadEvent[];

  constructor(id: string, events: ThreadEvent[]) {
    this.id = id;
    this.events = events;
  }

  async runStreamed(
    input: string,
    opts?: CodexTurnOptions,
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    void input;
    void opts;
    const events = this.events;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      for (const ev of events) {
        yield ev;
      }
    }
    return { events: generator() };
  }
}

class MockCodex {
  startThread(opts?: CodexThreadOptions) {
    void opts;
    const events: ThreadEvent[] = [
      {
        type: 'item.updated',
        item: { type: 'reasoning', text: 'Thinking about the repo' },
      } as unknown as ThreadEvent,
      {
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          id: 'tool-1',
          server: 'codeinfo_host',
          tool: 'VectorSearch',
          arguments: { query: 'hello', limit: 3 },
          status: 'completed',
          name: 'VectorSearch',
          result: {
            content: [
              {
                type: 'application/json',
                json: {
                  results: [
                    {
                      repo: 'repo',
                      relPath: 'src/index.ts',
                      hostPath: '/host/repo/src/index.ts',
                      score: 0.9,
                      chunk: 'line1\nline2',
                      chunkId: 'c1',
                      modelId: 'embed-1',
                    },
                  ],
                  files: [
                    {
                      hostPath: '/host/repo/src/index.ts',
                      highestMatch: 0.9,
                      chunkCount: 1,
                      lineCount: 2,
                      repo: 'repo',
                      modelId: 'embed-1',
                    },
                  ],
                  modelId: 'embed-1',
                },
              },
            ],
          },
        },
      } as unknown as ThreadEvent,
      {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Here you go' },
      } as unknown as ThreadEvent,
      {
        type: 'turn.completed',
      } as unknown as ThreadEvent,
    ];

    return new MockThread('thread-wrapper', events);
  }

  resumeThread(threadId: string, opts?: CodexThreadOptions) {
    void threadId;
    void opts;
    return this.startThread();
  }
}

test('MCP responder returns answer-only segments', async () => {
  const prev = getCodexDetection();
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  try {
    const result = await runCodebaseQuestion(
      { question: 'What is up?' },
      { codexFactory: () => new MockCodex() },
    );

    const payload = JSON.parse(result.content[0].text);
    assert.ok(typeof payload.conversationId === 'string');
    assert.ok(payload.conversationId.startsWith('codex-thread-'));
    assert.equal(payload.modelId, 'gpt-5.1-codex-max');
    assert.deepEqual(
      payload.segments.map((s: { type: string }) => s.type),
      ['answer'],
    );
    assert.equal(payload.segments[0].text, 'Here you go');
  } finally {
    setCodexDetection(prev);
  }
});

test('MCP responder only returns the final answer segment', async () => {
  const prev = getCodexDetection();
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  try {
    const result = await runCodebaseQuestion(
      { question: 'Second run' },
      { codexFactory: () => new MockCodex() },
    );

    const payload = JSON.parse(result.content[0].text);
    const segments = payload.segments as Array<{
      type: string;
      [key: string]: unknown;
    }>;
    assert.deepEqual(
      segments.map((s) => s.type),
      ['answer'],
    );
    assert.deepEqual(Object.keys(segments[0]).sort(), ['text', 'type']);
  } finally {
    setCodexDetection(prev);
  }
});

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('MCP JSON-RPC error shape remains stable for invalid params', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const response = await postJson(port, {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: '' },
      },
    });

    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 99);
    assert.equal(response.error.code, -32602);
    assert.equal(response.error.message, 'Invalid params');
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});
