import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { handleRpc } from '../../../mcp2/router.js';
import { resetToolDeps, setToolDeps } from '../../../mcp2/tools.js';

type ThreadEvent = {
  type: string;
  item?: Record<string, unknown>;
  thread_id?: string;
};

class MockThread {
  id: string;

  constructor(id: string) {
    this.id = id;
  }

  async runStreamed() {
    const threadId = this.id;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: threadId };
      yield {
        type: 'item.updated',
        item: { type: 'reasoning', text: 'Thinking about the repo' },
      };
      yield {
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
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
      };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Here you go' },
      };
      yield { type: 'turn.completed', thread_id: threadId };
    }

    return { events: generator() };
  }
}

class MockCodex {
  lastStartOptions?: unknown;
  lastResumeOptions?: unknown;
  lastResumeId?: string;
  threadId: string;

  constructor(id = 'thread-abc') {
    this.threadId = id;
  }

  startThread(opts?: unknown) {
    this.lastStartOptions = opts;
    return new MockThread(this.threadId);
  }

  resumeThread(threadId: string, opts?: unknown) {
    this.lastResumeId = threadId;
    this.lastResumeOptions = opts;
    return new MockThread(threadId);
  }
}

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('codebase_question returns answer-only payloads and preserves conversationId', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  const mockCodex = new MockCodex('thread-abc');
  setToolDeps({ codexFactory: () => mockCodex });

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const firstCall = await postJson(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'What is up?' },
      },
    });

    assert.equal(firstCall.result.content[0].type, 'text');
    const firstPayload = JSON.parse(firstCall.result.content[0].text);

    assert.equal(firstPayload.conversationId, 'thread-abc');
    assert.equal(firstPayload.modelId, 'gpt-5.1-codex-max');
    assert.deepEqual(
      firstPayload.segments.map((s: { type: string }) => s.type),
      ['answer'],
    );
    assert.equal(firstPayload.segments[0].text, 'Here you go');

    const secondCall = await postJson(port, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'And next?',
          conversationId: firstPayload.conversationId,
        },
      },
    });

    const secondPayload = JSON.parse(secondCall.result.content[0].text);
    assert.equal(secondPayload.conversationId, 'thread-abc');
    assert.equal(mockCodex.lastResumeId, 'thread-abc');
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});

class MockThreadNoAnswer {
  id: string;

  constructor(id: string) {
    this.id = id;
  }

  async runStreamed() {
    const threadId = this.id;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: threadId };
      yield {
        type: 'item.updated',
        item: { type: 'reasoning', text: 'Thinking about the repo' },
      };
      yield { type: 'turn.completed', thread_id: threadId };
    }

    return { events: generator() };
  }
}

class MockCodexNoAnswer {
  threadId: string;

  constructor(id = 'thread-empty') {
    this.threadId = id;
  }

  startThread() {
    return new MockThreadNoAnswer(this.threadId);
  }

  resumeThread(threadId: string) {
    return new MockThreadNoAnswer(threadId);
  }
}

test('codebase_question returns an empty answer segment when no answer emitted', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  setToolDeps({ codexFactory: () => new MockCodexNoAnswer() });

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const response = await postJson(port, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'What is up?' },
      },
    });

    const payload = JSON.parse(response.result.content[0].text);
    assert.deepEqual(
      payload.segments.map((s: { type: string }) => s.type),
      ['answer'],
    );
    assert.equal(payload.segments[0].text, '');
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.close();
  }
});
