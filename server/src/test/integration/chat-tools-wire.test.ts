import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  Chat,
  type LMStudioClient,
  type LLMPredictionFragment,
  type Tool,
  type ToolCallContext,
} from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';
import { createLmStudioTools } from '../../lmstudio/tools.js';
import { createChatRouter } from '../../routes/chat.js';

const toolDeps = {
  getRootsCollection: async () =>
    ({
      get: async () => ({
        ids: ['repo-id'],
        metadatas: [
          {
            root: '/data/repo-id',
            name: 'repo-name',
            model: 'embed-model',
            relPath: 'docs/readme.md',
          },
        ],
      }),
    }) as unknown as import('chromadb').Collection,
  getVectorsCollection: async () =>
    ({
      query: async () => ({
        ids: [['chunk-1']],
        documents: [['chunk body']],
        metadatas: [
          [
            {
              root: '/data/repo-id',
              relPath: 'docs/readme.md',
              model: 'embed-model',
              chunkHash: 'chunk-1',
            },
          ],
        ],
        distances: [[0.25]],
      }),
    }) as unknown as import('chromadb').Collection,
  getLockedModel: async () => 'embed-model',
};

type ActCallbacks = {
  onRoundStart?: (roundIndex: number) => void;
  onPredictionFragment?: (
    fragment: LLMPredictionFragment & { roundIndex?: number },
  ) => void;
  onToolCallRequestStart?: (...args: unknown[]) => void;
  onToolCallRequestNameReceived?: (...args: unknown[]) => void;
  onToolCallRequestEnd?: (...args: unknown[]) => void;
  onToolCallResult?: (
    roundIndex: number,
    callId: number,
    info: unknown,
  ) => void;
  onMessage?: (message: { role: string; content: string }) => void;
};

beforeEach(() => {
  process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
  process.env.HOST_INGEST_DIR = '/host/base';
});

test('chat route streams tool-result with hostPath/relPath from LM Studio tools', async () => {
  const act = async (chat: Chat, tools: Tool[], opts: ActCallbacks) => {
    opts.onRoundStart?.(0);
    opts.onPredictionFragment?.({
      content: 'partial',
      roundIndex: 0,
      tokensCount: 1,
      containsDrafted: false,
      reasoningType: 'none',
      isStructural: false,
    });

    const vectorTool = tools.find((t) => t.name === 'VectorSearch');
    if (!vectorTool) throw new Error('VectorSearch tool missing');
    const toolCtx: ToolCallContext = {
      status: () => undefined,
      warn: () => undefined,
      signal: new AbortController().signal,
      callId: 1,
    };
    const toolResult = await (
      vectorTool as unknown as {
        implementation: (
          params: unknown,
          ctx: ToolCallContext,
        ) => Promise<unknown>;
      }
    ).implementation({ query: 'hi' }, toolCtx);

    opts.onToolCallRequestStart?.(0, 1);
    opts.onToolCallRequestNameReceived?.(0, 1, 'VectorSearch');
    opts.onToolCallRequestEnd?.(0, 1);
    opts.onToolCallResult?.(0, 1, toolResult);
    opts.onMessage?.({ role: 'assistant', content: 'done' });
    return Promise.resolve();
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: () =>
        ({
          llm: {
            model: async () => ({ act }),
          },
        }) as unknown as LMStudioClient,
      toolFactory: (opts) => createLmStudioTools({ ...opts, deps: toolDeps }),
    }),
  );

  const res = await request(app)
    .post('/chat')
    .send({
      model: 'dummy-model',
      messages: [{ role: 'user', content: 'hello' }],
    })
    .expect(200);

  const events = res.text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.replace('data: ', '')));

  const toolResultEvent = events.find((e) => e.type === 'tool-result');
  const toolRequestEvent = events.find(
    (e) => e.type === 'tool-request' && typeof e.name === 'string',
  );

  assert.ok(toolRequestEvent, 'expected tool-request event');
  assert.equal(toolRequestEvent.callId, 1);
  assert.equal(toolRequestEvent.name, 'VectorSearch');

  assert.ok(toolResultEvent, 'expected tool-result event');
  assert.equal(toolResultEvent.callId, 1);
  assert.equal(toolResultEvent.name, 'VectorSearch');
  assert.equal(toolResultEvent.result.results[0].relPath, 'docs/readme.md');
  assert.equal(
    toolResultEvent.result.results[0].hostPath,
    '/host/base/repo-id/docs/readme.md',
  );
  assert.equal(toolResultEvent.result.results[0].repo, 'repo-name');

  const tokenEvent = events.find((e) => e.type === 'token');
  assert.equal(tokenEvent?.content, 'partial');

  const finalEvent = events.find((e) => e.type === 'final');
  assert.equal(finalEvent?.message?.content, 'done');
});
