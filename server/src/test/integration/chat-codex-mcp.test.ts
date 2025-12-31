import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach, beforeEach } from 'node:test';
import { SYSTEM_CONTEXT } from '@codeinfo2/common';
import type { LMStudioClient } from '@lmstudio/sdk';
import type {
  ThreadEvent,
  ThreadOptions as CodexThreadOptions,
} from '@openai/codex-sdk';
import express from 'express';
import request from 'supertest';
import { query, resetStore } from '../../logStore.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

class MockThread {
  id: string | null;
  lastPrompt?: string;
  omitName: boolean;

  constructor(id: string, opts: { omitName?: boolean } = {}) {
    this.id = id;
    this.omitName = opts.omitName ?? false;
  }

  async runStreamed(
    input: string,
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    this.lastPrompt = input;
    const threadId = this.id;
    const omitName = this.omitName;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      const baseTool = {
        type: 'mcp_tool_call',
        id: 'tool-1',
        server: 'codeinfo_host',
        tool: 'VectorSearch',
        status: 'started',
        arguments: { query: 'hello', limit: 3 },
      };

      yield {
        type: 'item.started',
        item: omitName
          ? (baseTool as unknown)
          : ({ ...baseTool, name: 'VectorSearch' } as unknown),
      } as ThreadEvent;

      const completedTool = {
        ...baseTool,
        status: 'completed',
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
      };

      yield {
        type: 'item.completed',
        item: omitName
          ? (completedTool as unknown)
          : ({ ...completedTool, name: 'VectorSearch' } as unknown),
      } as ThreadEvent;

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
  threadOpts?: { omitName?: boolean };

  constructor(id = 'thread-mcp', threadOpts?: { omitName?: boolean }) {
    this.id = id;
    this.threadOpts = threadOpts;
  }

  startThread(opts?: CodexThreadOptions) {
    this.lastStartOptions = opts;
    this.lastThread = new MockThread(this.id, this.threadOpts);
    return this.lastThread;
  }

  resumeThread(threadId: string, opts?: CodexThreadOptions) {
    this.lastResumeOptions = opts;
    this.lastThread = new MockThread(threadId, this.threadOpts);
    return this.lastThread;
  }
}

const dummyClientFactory = () =>
  ({
    llm: { model: async () => ({ act: async () => undefined }) },
  }) as unknown as LMStudioClient;

const ORIGINAL_CODEX_WORKDIR = process.env.CODEX_WORKDIR;
const ORIGINAL_CODEINFO_CODEX_WORKDIR = process.env.CODEINFO_CODEX_WORKDIR;

beforeEach(() => {
  delete process.env.CODEX_WORKDIR;
  delete process.env.CODEINFO_CODEX_WORKDIR;
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'not detected',
  });
  resetStore();
  conversationCounter = 0;
});

afterEach(() => {
  if (ORIGINAL_CODEX_WORKDIR === undefined) {
    delete process.env.CODEX_WORKDIR;
  } else {
    process.env.CODEX_WORKDIR = ORIGINAL_CODEX_WORKDIR;
  }

  if (ORIGINAL_CODEINFO_CODEX_WORKDIR === undefined) {
    delete process.env.CODEINFO_CODEX_WORKDIR;
  } else {
    process.env.CODEINFO_CODEX_WORKDIR = ORIGINAL_CODEINFO_CODEX_WORKDIR;
  }
});

let conversationCounter = 0;
const buildCodexBody = (overrides: Record<string, unknown> = {}) => ({
  provider: 'codex',
  model: 'gpt-5.1-codex-max',
  conversationId: `conv-codex-${++conversationCounter}`,
  message: 'Find the index file',
  ...overrides,
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

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, {
      type: 'subscribe_conversation',
      conversationId: 'thread-mcp',
    });

    // Start WS waits before triggering the HTTP request to avoid missing early frames.
    const snapshotPromise = waitForEvent({
      ws,
      predicate: (event: unknown): event is { type: string } => {
        const e = event as { type?: string; conversationId?: string };
        return (
          e.type === 'inflight_snapshot' && e.conversationId === 'thread-mcp'
        );
      },
      timeoutMs: 5000,
    });

    const toolRequestPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
        event: { type: string; callId?: string; name?: string };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          event?: { type?: string };
        };
        return (
          e.type === 'tool_event' &&
          e.conversationId === 'thread-mcp' &&
          e.event?.type === 'tool-request'
        );
      },
      timeoutMs: 5000,
    });

    const toolResultPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
        event: {
          type: string;
          callId?: string;
          stage?: string;
          parameters?: unknown;
          result?: Record<string, unknown>;
        };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          event?: { type?: string };
        };
        return (
          e.type === 'tool_event' &&
          e.conversationId === 'thread-mcp' &&
          e.event?.type === 'tool-result'
        );
      },
      timeoutMs: 5000,
    });

    const analysisPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
        delta: string;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          delta?: string;
        };
        return e.type === 'analysis_delta' && e.conversationId === 'thread-mcp';
      },
      timeoutMs: 5000,
    });

    const finalPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
        status: string;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return e.type === 'turn_final' && e.conversationId === 'thread-mcp';
      },
      timeoutMs: 5000,
    });

    const res = await request(httpServer)
      .post('/chat')
      .send(buildCodexBody({ conversationId: 'thread-mcp' }))
      .expect(202);

    const inflightId = res.body.inflightId as string;
    assert.equal(res.body.status, 'started');
    assert.equal(res.body.conversationId, 'thread-mcp');
    assert.equal(typeof inflightId, 'string');

    await snapshotPromise;

    const toolRequest = await toolRequestPromise;
    assert.equal(toolRequest.inflightId, inflightId);
    assert.equal(toolRequest.event.callId, 'tool-1');
    assert.equal(toolRequest.event.name, 'VectorSearch');

    const toolResult = await toolResultPromise;
    assert.equal(toolResult.inflightId, inflightId);
    assert.equal(toolResult.event.callId, 'tool-1');
    assert.equal(toolResult.event.stage, 'success');
    assert.deepEqual(toolResult.event.parameters, { query: 'hello', limit: 3 });

    const resultPayload = toolResult.event.result ?? {};
    assert.ok(Array.isArray(resultPayload.results));
    assert.ok(Array.isArray(resultPayload.files));

    const analysis = await analysisPromise;
    assert.equal(analysis.inflightId, inflightId);
    assert.match(String(analysis.delta ?? ''), /Thinking about the answer/);

    const final = await finalPromise;
    assert.equal(final.inflightId, inflightId);
    assert.equal(final.status, 'ok');
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

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

  assert.equal(
    mockCodex.lastStartOptions?.sandboxMode,
    'workspace-write',
    'default sandbox mode should be workspace-write',
  );
  assert.equal(
    mockCodex.lastStartOptions?.networkAccessEnabled,
    true,
    'default network access should be true',
  );
  assert.equal(
    mockCodex.lastStartOptions?.webSearchEnabled,
    true,
    'default web search should be true',
  );
  assert.equal(mockCodex.lastStartOptions?.workingDirectory, '/data');
  assert.equal(mockCodex.lastStartOptions?.skipGitRepoCheck, true);
});

test('codex tool requests fall back to tool name when Codex omits name field', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-mcp', { omitName: true });
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const ws = await connectWs({ baseUrl });
  try {
    const conversationId = 'thread-mcp-omit-name';
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const toolRequestPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
        event: { type: string; callId?: string; name?: string };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          event?: { type?: string };
        };
        return (
          e.type === 'tool_event' &&
          e.conversationId === conversationId &&
          e.event?.type === 'tool-request'
        );
      },
      timeoutMs: 5000,
    });

    const toolResultPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
        event: { type: string; callId?: string; name?: string };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          event?: { type?: string };
        };
        return (
          e.type === 'tool_event' &&
          e.conversationId === conversationId &&
          e.event?.type === 'tool-result'
        );
      },
      timeoutMs: 5000,
    });

    const res = await request(httpServer)
      .post('/chat')
      .send(buildCodexBody({ conversationId }))
      .expect(202);

    const inflightId = res.body.inflightId as string;

    const toolRequest = await toolRequestPromise;
    assert.equal(toolRequest.inflightId, inflightId);

    assert.equal(toolRequest.event.callId, 'tool-1');
    assert.equal(toolRequest.event.name, 'VectorSearch');

    const toolResult = await toolResultPromise;
    assert.equal(toolResult.inflightId, inflightId);

    assert.equal(toolResult.event.callId, 'tool-1');
    assert.equal(toolResult.event.name, 'VectorSearch');
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test('codex chat rejects invalid sandbox mode early', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  let codexFactoryCalled = 0;
  const codexFactory = () => {
    codexFactoryCalled += 1;
    return new MockCodex('thread-invalid');
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const res = await request(app)
    .post('/chat')
    .send(buildCodexBody({ sandboxMode: 'not-a-mode' }))
    .expect(400);

  assert.match(
    String((res.body as { message?: unknown })?.message ?? ''),
    /sandboxMode/i,
  );
  assert.equal(
    codexFactoryCalled,
    0,
    'codexFactory should not be invoked on invalid sandbox input',
  );
});

test('codex chat rejects invalid networkAccessEnabled input early', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  let codexFactoryCalled = 0;
  const codexFactory = () => {
    codexFactoryCalled += 1;
    return new MockCodex('thread-invalid-network');
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const res = await request(app)
    .post('/chat')
    .send(buildCodexBody({ networkAccessEnabled: 'yes' }))
    .expect(400);

  assert.match(
    String((res.body as { message?: unknown })?.message ?? ''),
    /networkAccessEnabled/i,
  );
  assert.equal(
    codexFactoryCalled,
    0,
    'codexFactory should not be invoked on invalid networkAccessEnabled',
  );
});

test('codex chat rejects invalid webSearchEnabled input early', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  let codexFactoryCalled = 0;
  const codexFactory = () => {
    codexFactoryCalled += 1;
    return new MockCodex('thread-invalid-websearch');
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const res = await request(app)
    .post('/chat')
    .send(buildCodexBody({ webSearchEnabled: 'yes' }))
    .expect(400);

  assert.match(
    String((res.body as { message?: unknown })?.message ?? ''),
    /webSearchEnabled/i,
  );
  assert.equal(
    codexFactoryCalled,
    0,
    'codexFactory should not be invoked on invalid webSearchEnabled',
  );
});

test('codex chat forwards non-default sandbox mode to codex thread', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-custom-sandbox');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app)
    .post('/chat')
    .send(buildCodexBody({ sandboxMode: 'danger-full-access' }))
    .expect(202);

  assert.equal(
    mockCodex.lastStartOptions?.sandboxMode,
    'danger-full-access',
    'explicit sandbox mode should be forwarded',
  );
});

test('codex chat defaults approvalPolicy when omitted', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-default-approval');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app).post('/chat').send(buildCodexBody()).expect(202);

  assert.equal(
    mockCodex.lastStartOptions?.approvalPolicy,
    'on-failure',
    'approvalPolicy should default to on-failure',
  );
});

test('codex chat rejects invalid approvalPolicy input early', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  let codexFactoryCalled = 0;
  const codexFactory = () => {
    codexFactoryCalled += 1;
    return new MockCodex('thread-invalid-approval');
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const res = await request(app)
    .post('/chat')
    .send(buildCodexBody({ approvalPolicy: 'sometimes' }))
    .expect(400);

  assert.match(
    String((res.body as { message?: unknown })?.message ?? ''),
    /approvalPolicy/i,
  );
  assert.equal(
    codexFactoryCalled,
    0,
    'codexFactory should not be invoked on invalid approvalPolicy',
  );
});

test('codex chat defaults modelReasoningEffort when omitted', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-default-reasoning');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app).post('/chat').send(buildCodexBody()).expect(202);

  assert.equal(
    mockCodex.lastStartOptions?.modelReasoningEffort,
    'high',
    'modelReasoningEffort should default to high',
  );
});

test('codex chat rejects invalid modelReasoningEffort input early', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  let codexFactoryCalled = 0;
  const codexFactory = () => {
    codexFactoryCalled += 1;
    return new MockCodex('thread-invalid-reasoning');
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const res = await request(app)
    .post('/chat')
    .send(buildCodexBody({ modelReasoningEffort: 'extreme' }))
    .expect(400);

  assert.match(
    String((res.body as { message?: unknown })?.message ?? ''),
    /modelReasoningEffort/i,
  );
  assert.equal(
    codexFactoryCalled,
    0,
    'codexFactory should not be invoked on invalid modelReasoningEffort',
  );
});

test('codex chat forwards xhigh modelReasoningEffort flag to codex thread', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-reasoning');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app)
    .post('/chat')
    .send(buildCodexBody({ modelReasoningEffort: 'xhigh' }))
    .expect(202);

  assert.equal(
    mockCodex.lastStartOptions?.modelReasoningEffort,
    'xhigh',
    'explicit modelReasoningEffort should be forwarded',
  );
});

test('codex chat forwards approvalPolicy flag to codex thread', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-approval');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app)
    .post('/chat')
    .send(buildCodexBody({ approvalPolicy: 'on-request' }))
    .expect(202);

  assert.equal(
    mockCodex.lastStartOptions?.approvalPolicy,
    'on-request',
    'explicit approvalPolicy should be forwarded',
  );
});

test('codex chat forwards networkAccessEnabled flag to codex thread', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-network');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app)
    .post('/chat')
    .send(buildCodexBody({ networkAccessEnabled: false }))
    .expect(202);

  assert.equal(
    mockCodex.lastStartOptions?.networkAccessEnabled,
    false,
    'explicit networkAccessEnabled should be forwarded',
  );
});

test('codex chat forwards webSearchEnabled flag to codex thread', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-websearch');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app)
    .post('/chat')
    .send(buildCodexBody({ webSearchEnabled: false }))
    .expect(202);

  assert.equal(
    mockCodex.lastStartOptions?.webSearchEnabled,
    false,
    'explicit webSearchEnabled should be forwarded',
  );
});

test('lmstudio requests ignore codex-only sandbox flag but log a warning', async () => {
  const originalBaseUrl = process.env.LMSTUDIO_BASE_URL;
  process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
  try {
    const app = express();
    app.use(express.json());
    const lmClient = {
      llm: {
        model: async () => ({
          act: async () => undefined,
        }),
      },
    } as unknown as LMStudioClient;
    app.use(
      '/chat',
      createChatRouter({
        clientFactory: () => lmClient,
        codexFactory: () => new MockCodex(),
      }),
    );

    await request(app)
      .post('/chat')
      .send({
        provider: 'lmstudio',
        model: 'llama-3',
        conversationId: 'conv-lmstudio-ignore-codex-flags',
        message: 'hello',
        sandboxMode: 'read-only',
        networkAccessEnabled: false,
        webSearchEnabled: false,
        approvalPolicy: 'never',
        modelReasoningEffort: 'medium',
      })
      .expect(202);

    const warnings = query({
      level: ['warn'],
      source: ['server'],
    });
    const warningText = warnings
      .map((entry) => `${entry.message} ${JSON.stringify(entry.context ?? {})}`)
      .join(' ');
    assert.ok(
      warningText.includes('sandboxMode'),
      'should log a warning when sandboxMode is ignored for lmstudio',
    );
    assert.ok(
      warningText.includes('networkAccessEnabled'),
      'should log a warning when networkAccessEnabled is ignored for lmstudio',
    );
    assert.ok(
      warningText.includes('webSearchEnabled'),
      'should log a warning when webSearchEnabled is ignored for lmstudio',
    );
    assert.ok(
      warningText.includes('approvalPolicy'),
      'should log a warning when approvalPolicy is ignored for lmstudio',
    );
    assert.ok(
      warningText.includes('modelReasoningEffort'),
      'should log a warning when modelReasoningEffort is ignored for lmstudio',
    );
  } finally {
    process.env.LMSTUDIO_BASE_URL = originalBaseUrl;
  }
});
