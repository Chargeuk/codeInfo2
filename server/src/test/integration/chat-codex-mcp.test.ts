import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { SYSTEM_CONTEXT } from '@codeinfo2/common';
import type { LMStudioClient } from '@lmstudio/sdk';
import type {
  ThreadEvent,
  ThreadOptions as CodexThreadOptions,
} from '@openai/codex-sdk';
import express from 'express';
import request from 'supertest';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';

class MockThread {
  id: string | null;
  lastPrompt?: string;

  constructor(id: string) {
    this.id = id;
  }

  async runStreamed(
    input: string,
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    this.lastPrompt = input;
    const threadId = this.id;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield {
        type: 'item.started',
        item: {
          type: 'mcp_tool_call',
          id: 'tool-1',
          name: 'VectorSearch',
          server: 'codeinfo_host',
          tool: 'VectorSearch',
          status: 'started',
          arguments: { query: 'hello', limit: 3 },
        },
      } as unknown as ThreadEvent;

      yield {
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          id: 'tool-1',
          name: 'VectorSearch',
          server: 'codeinfo_host',
          tool: 'VectorSearch',
          status: 'completed',
          arguments: { query: 'hello', limit: 3 },
          result: {
            content: [
              {
                type: 'application/json',
                json: {
                  results: [
                    {
                      repo: 'repo',
                      relPath: 'src/index.ts',
                      containerPath: '/data/repo/src/index.ts',
                      hostPath: '/host/repo/src/index.ts',
                      score: 0.9,
                      chunk: 'chunk text',
                      chunkId: 'c1',
                      modelId: 'embed-1',
                    },
                  ],
                  files: [
                    {
                      hostPath: '/host/repo/src/index.ts',
                      highestMatch: 0.9,
                      chunkCount: 1,
                      lineCount: 1,
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
      } as unknown as ThreadEvent;

      yield {
        type: 'item.updated',
        item: {
          type: 'reasoning',
          id: 'reason-1',
          text: 'Thinking about the answer',
        },
      } as unknown as ThreadEvent;

      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Here you go' },
      } as ThreadEvent;

      yield {
        type: 'turn.completed',
        thread_id: threadId,
        usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 3 },
      } as ThreadEvent;
    }

    return { events: generator() };
  }
}

class MockCodex {
  id: string;
  lastStartOptions?: CodexThreadOptions;
  lastResumeOptions?: CodexThreadOptions;
  lastThread?: MockThread;

  constructor(id = 'thread-mcp') {
    this.id = id;
  }

  startThread(opts?: CodexThreadOptions) {
    this.lastStartOptions = opts;
    this.lastThread = new MockThread(this.id);
    return this.lastThread;
  }

  resumeThread(threadId: string, opts?: CodexThreadOptions) {
    this.lastResumeOptions = opts;
    this.lastThread = new MockThread(threadId);
    return this.lastThread;
  }
}

const dummyClientFactory = () =>
  ({
    llm: { model: async () => ({ act: async () => undefined }) },
  }) as unknown as LMStudioClient;

beforeEach(() => {
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'not detected',
  });
});

test('codex chat injects system context and emits MCP tool request/result', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-mcp');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const res = await request(app)
    .post('/chat')
    .send({
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      messages: [{ role: 'user', content: 'Find the index file' }],
    })
    .expect(200);

  const frames = res.text
    .split('\n\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map(
      (line) =>
        JSON.parse(line.replace(/^data:\s*/, '')) as Record<string, unknown>,
    );

  const toolRequest = frames.find((f) => f.type === 'tool-request');
  assert.ok(toolRequest, 'tool-request frame should exist');
  assert.equal((toolRequest as { callId?: string }).callId, 'tool-1');
  assert.equal((toolRequest as { name?: string }).name, 'VectorSearch');

  const toolResult = frames.find((f) => f.type === 'tool-result');
  assert.ok(toolResult, 'tool-result frame should exist');
  assert.equal((toolResult as { callId?: string }).callId, 'tool-1');
  assert.equal((toolResult as { stage?: string }).stage, 'success');
  assert.deepEqual((toolResult as { parameters?: unknown }).parameters, {
    query: 'hello',
    limit: 3,
  });

  const resultPayload = (toolResult as { result?: Record<string, unknown> })
    .result as Record<string, unknown>;
  assert.ok(Array.isArray(resultPayload?.results));
  assert.ok(Array.isArray(resultPayload?.files));

  const analysisIndex = frames.findIndex((f) => f.type === 'analysis');
  assert.notEqual(analysisIndex, -1, 'analysis frame should be present');
  assert.match(
    String((frames[analysisIndex] as { content?: unknown }).content ?? ''),
    /Thinking about the answer/,
  );

  const finalFrame = frames.find((f) => f.type === 'final');
  assert.ok(finalFrame);
  const finalIndex = frames.findIndex((f) => f.type === 'final');
  assert.ok(
    analysisIndex === -1 || analysisIndex < finalIndex,
    'analysis should arrive before final frame',
  );

  assert.ok(mockCodex.lastThread?.lastPrompt);
  assert.ok(
    mockCodex.lastThread?.lastPrompt?.startsWith(
      `Context:\n${SYSTEM_CONTEXT.trim()}`,
    ),
    'prompt should start with system context',
  );
  assert.ok(
    mockCodex.lastThread?.lastPrompt?.includes('Find the index file'),
    'prompt should include user text',
  );

  assert.equal(mockCodex.lastStartOptions?.workingDirectory, '/data');
  assert.equal(mockCodex.lastStartOptions?.skipGitRepoCheck, true);
});
