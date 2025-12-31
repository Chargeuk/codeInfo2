import assert from 'node:assert/strict';
import http from 'node:http';
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

import {
  getMemoryTurns,
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { createLmStudioTools } from '../../lmstudio/tools.js';
import { createChatRouter } from '../../routes/chat.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

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
  onMessage?: (message: unknown) => void;
};

type WsTranscriptEvent = {
  protocolVersion?: string;
  type?: string;
  seq?: number;
  conversationId?: string;
  inflightId?: string;
  status?: string;
  event?: {
    type?: string;
    callId?: unknown;
    name?: unknown;
    stage?: unknown;
    parameters?: unknown;
    result?: unknown;
    errorTrimmed?: unknown;
    errorFull?: unknown;
  };
  delta?: unknown;
};

beforeEach(() => {
  process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
  process.env.HOST_INGEST_DIR = '/host/base';
  memoryConversations.clear();
  memoryTurns.clear();
});

async function waitForAssistantTurn(conversationId: string, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const turns = getMemoryTurns(conversationId);
    if (turns.some((t) => t.role === 'assistant')) {
      return turns;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for assistant turn: ${conversationId}`);
}

async function startServer(
  act: (chat: Chat, tools: Tool[], opts: ActCallbacks) => Promise<unknown>,
) {
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

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  return {
    httpServer,
    wsHandle,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: {
  httpServer: http.Server;
  wsHandle: { close: () => Promise<void> };
}) {
  await server.wsHandle.close();
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => resolve()),
  );
}

test('chat route streams tool-result with hostPath/relPath from LM Studio tools', async () => {
  const act = async (_chat: Chat, tools: Tool[], opts: ActCallbacks) => {
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
    opts.onToolCallRequestEnd?.(0, 1, {
      toolCallRequest: {
        id: 'tool-1',
        type: 'function',
        arguments: { query: 'hi' },
        name: 'VectorSearch',
      },
    });
    opts.onToolCallResult?.(0, 1, toolResult);

    opts.onMessage?.({
      data: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '<|channel|>analysis<|message|>thinking<|end|>',
          },
          {
            type: 'toolCallRequest',
            toolCallRequest: {
              id: 'tool-1',
              type: 'function',
              arguments: { query: 'hi' },
              name: 'VectorSearch',
            },
          },
        ],
      },
      mutable: true,
    });

    opts.onMessage?.({
      data: {
        role: 'tool',
        content: [
          {
            type: 'toolCallResult',
            toolCallId: 'tool-1',
            content: JSON.stringify(toolResult),
          },
        ],
      },
      mutable: true,
    });

    opts.onMessage?.({
      data: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '<|channel|>final<|message|>done',
          },
        ],
      },
      mutable: true,
    });
    return Promise.resolve();
  };

  const conversationId = 'conv-integration-tools';
  const server = await startServer(act);
  const ws = await connectWs({ baseUrl: server.baseUrl });

  let toolRequestPromise: Promise<WsTranscriptEvent> | undefined;
  let toolResultPromise: Promise<WsTranscriptEvent> | undefined;
  let finalPromise: Promise<WsTranscriptEvent> | undefined;

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    toolRequestPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'tool_event' &&
          e.conversationId === conversationId &&
          e.event?.type === 'tool-request' &&
          String(e.event?.callId) === '1'
        );
      },
      timeoutMs: 5000,
    }).catch((err) => {
      throw new Error('Timed out waiting for tool-request WS event', {
        cause: err as Error,
      });
    });

    toolResultPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'tool_event' &&
          e.conversationId === conversationId &&
          e.event?.type === 'tool-result'
        );
      },
      timeoutMs: 5000,
    }).catch((err) => {
      throw new Error('Timed out waiting for tool-result WS event', {
        cause: err as Error,
      });
    });

    finalPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    }).catch((err) => {
      throw new Error('Timed out waiting for turn_final WS event', {
        cause: err as Error,
      });
    });

    const res = await request(server.httpServer)
      .post('/chat')
      .send({ model: 'dummy-model', conversationId, message: 'hello' })
      .expect(202);

    const inflightId = res.body.inflightId as string;
    assert.equal(res.body.status, 'started');

    const [toolRequestEvent, toolResultEvent] = await Promise.all([
      toolRequestPromise,
      toolResultPromise,
    ]);

    assert.equal(toolRequestEvent.inflightId, inflightId);
    assert.equal(String(toolRequestEvent.event?.callId), '1');
    assert.equal(typeof toolRequestEvent.event?.name, 'string');

    assert.equal(toolResultEvent.inflightId, inflightId);
    assert.equal(String(toolResultEvent.event?.callId), '1');
    assert.equal(toolResultEvent.event?.name, 'VectorSearch');
    assert.deepEqual(toolResultEvent.event?.parameters, { query: 'hi' });

    const toolResult = toolResultEvent.event?.result as {
      results: Array<{ relPath: string; hostPath: string; repo: string }>;
      files: Array<{ hostPath: string; chunkCount: number; lineCount: number }>;
    };
    assert.equal(toolResult.results[0].relPath, 'docs/readme.md');
    assert.equal(
      toolResult.results[0].hostPath,
      '/host/base/repo-id/docs/readme.md',
    );
    assert.equal(toolResult.results[0].repo, 'repo-name');
    assert.equal(
      toolResult.files[0].hostPath,
      '/host/base/repo-id/docs/readme.md',
    );
    assert.equal(toolResult.files[0].chunkCount, 1);
    assert.equal(toolResult.files[0].lineCount, 1);

    await finalPromise;

    const turns = await waitForAssistantTurn(conversationId);
    const finalAssistant = turns.filter((t) => t.role === 'assistant').at(-1);
    assert.ok(
      (finalAssistant?.content ?? '').includes('done'),
      'expected final assistant content to include done',
    );
  } finally {
    // Avoid unhandled promise rejections if the test fails mid-stream.
    await Promise.allSettled([
      toolRequestPromise,
      toolResultPromise,
      finalPromise,
    ]);
    await closeWs(ws);
    await stopServer(server);
  }
});

test('chat route synthesizes tool-result when LM Studio only returns a final tool message', async () => {
  const act = async (_chat: Chat, tools: Tool[], opts: ActCallbacks) => {
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

  const conversationId = 'conv-tools-wire-2';
  const server = await startServer(act);
  const ws = await connectWs({ baseUrl: server.baseUrl });

  let toolResultPromise: Promise<WsTranscriptEvent> | undefined;

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    toolResultPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'tool_event' &&
          e.conversationId === conversationId &&
          e.event?.type === 'tool-result'
        );
      },
      timeoutMs: 5000,
    });

    await request(server.httpServer)
      .post('/chat')
      .send({ model: 'dummy-model', conversationId, message: 'hello' })
      .expect(202);

    const toolResultEvent = await toolResultPromise;
    assert.equal(String(toolResultEvent.event?.callId), '1');
    assert.equal(toolResultEvent.event?.name, 'VectorSearch');
    assert.deepEqual(toolResultEvent.event?.parameters, { query: 'hi' });

    const toolResult = toolResultEvent.event?.result as {
      results: Array<{ relPath: string }>;
      files: unknown[];
    };
    assert.equal(toolResult.results[0].relPath, 'docs/readme.md');
    assert.ok(Array.isArray(toolResult.files));
  } finally {
    await Promise.allSettled([toolResultPromise]);
    await closeWs(ws);
    await stopServer(server);
  }
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

  const conversationId = 'conv-tools-wire-3';
  const server = await startServer(act);
  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const toolResultPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'tool_event' &&
          e.conversationId === conversationId &&
          e.event?.type === 'tool-result'
        );
      },
      timeoutMs: 5000,
    });

    const finalPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    });

    await request(server.httpServer)
      .post('/chat')
      .send({ model: 'dummy-model', conversationId, message: 'hello' })
      .expect(202);

    const toolResultEvent = await toolResultPromise;
    assert.equal(toolResultEvent.event?.stage, 'error');
    assert.deepEqual(toolResultEvent.event?.parameters, { query: 'fail' });
    assert.equal(
      (toolResultEvent.event?.errorTrimmed as { message?: string } | undefined)
        ?.message,
      'MODEL_UNAVAILABLE',
    );
    assert.ok(toolResultEvent.event?.errorFull);

    await finalPromise;
    const turns = await waitForAssistantTurn(conversationId);
    const finalAssistant = turns.filter((t) => t.role === 'assistant').at(-1);
    assert.equal(finalAssistant?.content, 'after failure');
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
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

  const conversationId = 'conv-tools-wire-4';
  const server = await startServer(act);
  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const toolResultPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'tool_event' &&
          e.conversationId === conversationId &&
          e.event?.type === 'tool-result' &&
          (e.event.callId === 99 || e.event.callId === '99')
        );
      },
      timeoutMs: 5000,
    });

    const finalPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    });

    await request(server.httpServer)
      .post('/chat')
      .send({ model: 'dummy-model', conversationId, message: 'hello' })
      .expect(202);

    const toolResultEvent = await toolResultPromise;
    assert.equal(toolResultEvent.event?.stage, 'success');

    await finalPromise;
    const turns = await waitForAssistantTurn(conversationId);
    const finalAssistant = turns.filter((t) => t.role === 'assistant').at(-1);
    assert.equal(finalAssistant?.content, 'after synthetic');
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
});

test('chat route emits complete after tool-result arrives', async () => {
  const act = async (_chat: Chat, tools: Tool[], opts: ActCallbacks) => {
    opts.onRoundStart?.(0);

    const vectorTool = tools.find((t) => t.name === 'VectorSearch');
    if (!vectorTool) throw new Error('VectorSearch tool missing');
    const toolCtx: ToolCallContext = {
      status: () => undefined,
      warn: () => undefined,
      signal: new AbortController().signal,
      callId: 3,
    };
    const toolResult = await (
      vectorTool as unknown as {
        implementation: (
          params: unknown,
          ctx: ToolCallContext,
        ) => Promise<unknown>;
      }
    ).implementation({ query: 'ordering' }, toolCtx);

    opts.onToolCallRequestStart?.(0, 3);
    opts.onToolCallRequestNameReceived?.(0, 3, 'VectorSearch');
    opts.onToolCallRequestEnd?.(0, 3, {
      toolCallRequest: {
        id: 'tool-3',
        type: 'function',
        arguments: { query: 'ordering' },
        name: 'VectorSearch',
      },
    });
    opts.onToolCallResult?.(0, 3, toolResult);

    opts.onMessage?.({
      data: {
        role: 'assistant',
        content: [{ type: 'text', text: '<|channel|>final<|message|>done' }],
      },
      mutable: true,
    });

    return Promise.resolve();
  };

  const conversationId = 'conv-tools-complete-order';
  const server = await startServer(act);
  const ws = await connectWs({ baseUrl: server.baseUrl });
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const toolResultPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'tool_event' &&
          e.conversationId === conversationId &&
          e.event?.type === 'tool-result'
        );
      },
      timeoutMs: 5000,
    });

    const finalPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    });

    await request(server.httpServer)
      .post('/chat')
      .send({ model: 'dummy-model', conversationId, message: 'hello' })
      .expect(202);

    const toolResultEvent = await toolResultPromise;
    const finalEvent = await finalPromise;

    assert.equal(typeof toolResultEvent.seq, 'number');
    assert.equal(typeof finalEvent.seq, 'number');
    assert.ok(
      (finalEvent.seq ?? 0) > (toolResultEvent.seq ?? 0),
      'turn_final should be emitted after tool-result',
    );
  } finally {
    await closeWs(ws);
    await stopServer(server);
  }
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
    // Assistant echo with no callId metadata (shape-based suppression).
    opts.onMessage?.({
      role: 'assistant',
      content: JSON.stringify({
        files: [{ hostPath: '/host/path/a', chunkCount: 1, lineCount: 3 }],
        results: [
          {
            hostPath: '/host/path/a',
            chunk: 'text',
            score: 0.9,
            lineCount: 3,
          },
        ],
      }),
    });
    return Promise.resolve(toolResult);
  };

  const conversationId = 'conv-tools-wire-5';
  const server = await startServer(act);
  const ws = await connectWs({ baseUrl: server.baseUrl });

  let toolResultPromise: Promise<WsTranscriptEvent> | undefined;
  let finalPromise: Promise<WsTranscriptEvent> | undefined;

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    toolResultPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return (
          e.type === 'tool_event' &&
          e.conversationId === conversationId &&
          e.event?.type === 'tool-result' &&
          (e.event.callId === 101 || e.event.callId === '101')
        );
      },
      timeoutMs: 5000,
    });

    finalPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is WsTranscriptEvent => {
        const e = event as WsTranscriptEvent;
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    });

    await request(server.httpServer)
      .post('/chat')
      .send({ model: 'dummy-model', conversationId, message: 'hello' })
      .expect(202);

    const toolResultEvent = await toolResultPromise;
    assert.ok(
      (
        toolResultEvent.event?.result as {
          files?: Array<{ hostPath?: string }>;
        }
      )?.files?.[0]?.hostPath,
    );

    await finalPromise;

    const turns = await waitForAssistantTurn(conversationId);
    const finalAssistant = turns.filter((t) => t.role === 'assistant').at(-1);
    assert.ok(!String(finalAssistant?.content ?? '').includes('/host/path/a'));
  } finally {
    await Promise.allSettled([toolResultPromise, finalPromise]);
    await closeWs(ws);
    await stopServer(server);
  }
});
