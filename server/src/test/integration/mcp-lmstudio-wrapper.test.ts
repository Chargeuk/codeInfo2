import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage, LMStudioClient } from '@lmstudio/sdk';

import { runCodebaseQuestion } from '../../mcp2/tools/codebaseQuestion.js';

class MockModel {
  async act(
    _chat: unknown,
    _tools: ReadonlyArray<unknown>,
    opts: Record<string, unknown>,
  ): Promise<void> {
    const onToolCallRequestStart = opts.onToolCallRequestStart as
      | ((roundIndex: number, callId: number) => void)
      | undefined;
    const onToolCallRequestNameReceived = opts.onToolCallRequestNameReceived as
      | ((roundIndex: number, callId: number, name: string) => void)
      | undefined;
    const onToolCallRequestEnd = opts.onToolCallRequestEnd as
      | ((roundIndex: number, callId: number, info?: unknown) => void)
      | undefined;
    const onToolCallResult = opts.onToolCallResult as
      | ((roundIndex: number, callId: number, info: unknown) => void)
      | undefined;
    const onPredictionFragment = opts.onPredictionFragment as
      | ((fragment: { content?: string; roundIndex?: number }) => void)
      | undefined;
    const onMessage = opts.onMessage as
      | ((message: ChatMessage) => void)
      | undefined;

    onToolCallRequestStart?.(0, 1);
    onToolCallRequestNameReceived?.(0, 1, 'VectorSearch');
    onToolCallRequestEnd?.(0, 1, { parameters: { query: 'hello' } });
    onToolCallResult?.(0, 1, {
      name: 'VectorSearch',
      result: {
        results: [
          {
            repo: 'repo',
            relPath: 'src/index.ts',
            hostPath: '/host/repo/src/index.ts',
            score: 0.8,
            chunk: 'line1\nline2',
            chunkId: 'c1',
            modelId: 'embed-1',
          },
        ],
        files: [
          {
            hostPath: '/host/repo/src/index.ts',
            highestMatch: 0.8,
            chunkCount: 1,
            lineCount: 2,
            repo: 'repo',
            modelId: 'embed-1',
          },
        ],
        modelId: 'embed-1',
      },
    });
    onPredictionFragment?.({ content: 'Tok' });
    onMessage?.({
      data: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Here you go' }],
      },
    } as unknown as ChatMessage);
  }
}

const makeMockClientFactory = () => (baseUrl: string) => {
  void baseUrl;
  return {
    llm: {
      model: (model: string) => {
        void model;
        return new MockModel();
      },
    },
  } as unknown as LMStudioClient;
};

const makeToolFactory = () => () => ({ tools: [] });

test('MCP LM Studio responder builds snapshot-compatible segments', async () => {
  const result = await runCodebaseQuestion(
    { question: 'What is up?', provider: 'lmstudio', model: 'mock-model' },
    {
      clientFactory: makeMockClientFactory(),
      toolFactory: makeToolFactory(),
    },
  );

  const payload = JSON.parse(result.content[0].text);
  assert.ok(typeof payload.conversationId === 'string');
  assert.ok(payload.conversationId.startsWith('lmstudio-thread-'));
  assert.equal(payload.modelId, 'mock-model');
  assert.deepEqual(
    payload.segments.map((s: { type: string }) => s.type),
    ['vector_summary', 'answer'],
  );
  const summary = payload.segments[0];
  assert.equal(summary.files[0].relPath, 'src/index.ts');
  assert.equal(summary.files[0].chunks, 1);
  assert.equal(summary.files[0].lines, 2);
});

test('MCP LM Studio responder keeps segment order and omits extras', async () => {
  const result = await runCodebaseQuestion(
    { question: 'Second run', provider: 'lmstudio', model: 'mock-model' },
    {
      clientFactory: makeMockClientFactory(),
      toolFactory: makeToolFactory(),
    },
  );

  const payload = JSON.parse(result.content[0].text);
  const segments = payload.segments as Array<{ type: string }>;
  assert.deepEqual(
    segments.map((s) => s.type),
    ['vector_summary', 'answer'],
  );
  const summary = segments[0] as { [key: string]: unknown };
  assert.deepEqual(Object.keys(summary).sort(), ['files', 'type']);
});
