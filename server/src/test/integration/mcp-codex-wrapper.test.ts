import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ThreadEvent,
  ThreadOptions as CodexThreadOptions,
  TurnOptions as CodexTurnOptions,
} from '@openai/codex-sdk';

import { runCodebaseQuestion } from '../../mcp2/tools/codebaseQuestion.js';
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

test('MCP responder builds snapshot-compatible segments', async () => {
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
      ['thinking', 'vector_summary', 'answer'],
    );
    const summary = payload.segments[1];
    assert.equal(summary.files[0].relPath, 'src/index.ts');
    assert.equal(summary.files[0].chunks, 1);
    assert.equal(summary.files[0].lines, 2);
  } finally {
    setCodexDetection(prev);
  }
});

test('MCP responder keeps segment order and omits extras', async () => {
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
      ['thinking', 'vector_summary', 'answer'],
    );
    // ensure vector_summary only has expected keys
    const summary = segments[1];
    assert.deepEqual(Object.keys(summary).sort(), ['files', 'type']);
  } finally {
    setCodexDetection(prev);
  }
});
