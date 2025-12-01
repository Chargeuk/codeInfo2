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
  onToolCallRequestArgumentFragmentGenerated?: (...args: unknown[]) => void;
  onToolCallRequestFailure?: (
    roundIndex: number,
    callId: number,
    error: Error,
  ) => void;
  onToolCallResult?: (
    roundIndex: number,
    callId: number,
    info: unknown,
  ) => void;
  onMessage?: (message: { role: string; content: unknown }) => void;
};

beforeEach(() => {
  process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
  process.env.HOST_INGEST_DIR = '/host/base';
});

test('chat route streams tool-result with hostPath/relPath from LM Studio tools', async () => {
  const act = async (chat: Chat, tools: Tool[], opts: ActCallbacks) => {
    const toolNames = tools.map((t) => t.name);
    assert.ok(toolNames.includes('VectorSearch'));
    assert.ok(toolNames.includes('ListIngestedRepositories'));
    assert.ok(!toolNames.includes('noop'));

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
    opts.onToolCallRequestArgumentFragmentGenerated?.(
      0,
      1,
      JSON.stringify({ query: 'hi' }),
    );
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
  assert.deepEqual(toolResultEvent.parameters, { query: 'hi' });
  assert.equal(toolResultEvent.result.results[0].relPath, 'docs/readme.md');
  assert.equal(
    toolResultEvent.result.results[0].hostPath,
    '/host/base/repo-id/docs/readme.md',
  );
  assert.equal(toolResultEvent.result.results[0].repo, 'repo-name');
  assert.equal(
    toolResultEvent.result.files[0].hostPath,
    '/host/base/repo-id/docs/readme.md',
  );
  assert.equal(toolResultEvent.result.files[0].chunkCount, 1);
  assert.equal(toolResultEvent.result.files[0].lineCount, 1);

  const tokenEvent = events.find((e) => e.type === 'token');
  assert.equal(tokenEvent?.content, 'partial');

  const finalEvent = events.find((e) => e.type === 'final');
  assert.equal(finalEvent?.message?.content, 'done');
});

test('chat route synthesizes tool-result when LM Studio only returns a final tool message', async () => {
  const act = async (chat: Chat, tools: Tool[], opts: ActCallbacks) => {
    opts.onRoundStart?.(0);

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
    opts.onToolCallRequestArgumentFragmentGenerated?.(
      0,
      1,
      JSON.stringify({ query: 'hi' }),
    );
    opts.onToolCallRequestEnd?.(0, 1);

    opts.onMessage?.({
      role: 'tool',
      content: {
        toolCallId: 1,
        name: 'VectorSearch',
        result: toolResult,
      },
    });

    opts.onMessage?.({ role: 'assistant', content: 'after tool' });
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
  assert.ok(toolResultEvent, 'expected synthesized tool-result');
  assert.equal(toolResultEvent.callId, 1);
  assert.equal(toolResultEvent.name, 'VectorSearch');
  assert.deepEqual(toolResultEvent.parameters, { query: 'hi' });
  assert.equal(toolResultEvent.result.results[0].relPath, 'docs/readme.md');
  assert.ok(Array.isArray(toolResultEvent.result.files));

  const finalEvents = events.filter((e) => e.type === 'final');
  assert.equal(finalEvents.length, 2);
});

test('chat route emits tool-result with error details when a tool call fails', async () => {
  const act = async (_chat: Chat, _tools: Tool[], opts: ActCallbacks) => {
    opts.onRoundStart?.(0);
    opts.onToolCallRequestStart?.(0, 1);
    opts.onToolCallRequestNameReceived?.(0, 1, 'VectorSearch');
    opts.onToolCallRequestArgumentFragmentGenerated?.(
      0,
      1,
      JSON.stringify({ query: 'fail' }),
    );
    opts.onToolCallRequestFailure?.(0, 1, new Error('MODEL_UNAVAILABLE'));
    opts.onMessage?.({ role: 'assistant', content: 'after failure' });
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
  assert.ok(toolResultEvent, 'expected tool-result event');
  assert.equal(toolResultEvent.stage, 'error');
  assert.deepEqual(toolResultEvent.parameters, { query: 'fail' });
  assert.equal(toolResultEvent.errorTrimmed?.message, 'MODEL_UNAVAILABLE');
  assert.ok(toolResultEvent.errorFull);
  const finalEvent = events.find((e) => e.type === 'final');
  assert.equal(finalEvent?.message?.content, 'after failure');
});

test('chat route synthesizes tool-result when LM Studio omits onToolCallResult entirely', async () => {
  const act = async (_chat: Chat, tools: Tool[], opts: ActCallbacks) => {
    opts.onRoundStart?.(0);

    const vectorTool = tools.find((t) => t.name === 'VectorSearch');
    if (!vectorTool) throw new Error('VectorSearch tool missing');
    const toolCtx: ToolCallContext = {
      status: () => undefined,
      warn: () => undefined,
      signal: new AbortController().signal,
      callId: 99,
    };
    const toolResult = await (
      vectorTool as unknown as {
        implementation: (
          params: unknown,
          ctx: ToolCallContext,
        ) => Promise<unknown>;
      }
    ).implementation({ query: 'hello' }, toolCtx);

    opts.onToolCallRequestStart?.(0, 99);
    opts.onToolCallRequestNameReceived?.(0, 99, 'VectorSearch');
    opts.onToolCallRequestArgumentFragmentGenerated?.(
      0,
      99,
      JSON.stringify({ query: 'hello' }),
    );
    opts.onToolCallRequestEnd?.(0, 99, { parameters: { query: 'hello' } });
    // Intentionally do NOT call onToolCallResult or send a role:"tool" message.
    opts.onMessage?.({ role: 'assistant', content: 'after synthetic' });
    return Promise.resolve(toolResult);
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
  assert.ok(toolResultEvent, 'expected synthesized tool-result event');
  assert.equal(toolResultEvent.callId, 99);
  assert.equal(toolResultEvent.name, 'VectorSearch');
  assert.deepEqual(toolResultEvent.parameters, { query: 'hello' });
  assert.equal(toolResultEvent.stage, 'success');
  const finalEvent = events.find((e) => e.type === 'final');
  assert.equal(finalEvent?.message?.content, 'after synthetic');
});

test('chat route suppresses assistant tool payload echo while emitting tool-result', async () => {
  const act = async (_chat: Chat, tools: Tool[], opts: ActCallbacks) => {
    opts.onRoundStart?.(0);

    const vectorTool = tools.find((t) => t.name === 'VectorSearch');
    assert.ok(vectorTool);
    const toolCtx: ToolCallContext = {
      status: () => undefined,
      warn: () => undefined,
      signal: new AbortController().signal,
      callId: 101,
    };
    const toolResult = await (
      vectorTool as unknown as {
        implementation: (
          params: unknown,
          ctx: ToolCallContext,
        ) => Promise<unknown>;
      }
    ).implementation({ query: 'hello' }, toolCtx);

    opts.onToolCallRequestStart?.(0, 101);
    opts.onToolCallRequestNameReceived?.(0, 101, 'VectorSearch');
    opts.onToolCallRequestArgumentFragmentGenerated?.(
      0,
      101,
      JSON.stringify({ query: 'hello' }),
    );
    opts.onToolCallRequestEnd?.(0, 101, { parameters: { query: 'hello' } });
    opts.onMessage?.({
      role: 'assistant',
      content: JSON.stringify([
        {
          toolCallId: 101,
          name: 'VectorSearch',
          result: {
            files: [{ hostPath: '/host/path/a', chunkCount: 1, lineCount: 3 }],
            results: [
              {
                hostPath: '/host/path/a',
                chunk: 'text',
                score: 0.9,
                lineCount: 3,
              },
            ],
          },
        },
      ]),
    });
    return Promise.resolve(toolResult);
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

  const toolResultEvent = events.find(
    (e) => e.type === 'tool-result' && (e.callId === 101 || e.callId === '101'),
  );
  assert.ok(toolResultEvent, 'expected tool-result event');
  assert.ok(toolResultEvent.result?.files?.[0]?.hostPath);

  const assistantEcho = events.find(
    (e) =>
      e.type === 'final' &&
      typeof e.message?.content === 'string' &&
      e.message.content.includes('/host/path/a'),
  );
  assert.equal(assistantEcho, undefined);
});
