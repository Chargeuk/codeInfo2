import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import type {
  CodexOptions,
  ThreadEvent,
  ThreadOptions as CodexThreadOptions,
  TurnOptions as CodexTurnOptions,
} from '@openai/codex-sdk';
import express from 'express';
import request from 'supertest';
import type { CodexCapabilityResolution } from '../../codex/capabilityResolver.js';
import {
  getMemoryTurns,
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createCodexDeviceAuthRouter } from '../../routes/codexDeviceAuth.js';
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

  constructor(id: string) {
    this.id = id;
  }

  async runStreamed(): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    const threadId = this.id;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: threadId } as ThreadEvent;
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', text: 'Hello' },
      } as ThreadEvent;
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Hello world' },
      } as ThreadEvent;
      yield {
        type: 'turn.completed',
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2 },
      } as ThreadEvent;
    }

    return { events: generator() };
  }
}

class MockCodex {
  id: string;
  lastStartOptions?: CodexThreadOptions;
  lastResumeOptions?: CodexThreadOptions;

  constructor(id = 'thread-mock') {
    this.id = id;
  }

  startThread(opts?: CodexThreadOptions) {
    this.lastStartOptions = opts;
    return new MockThread(this.id);
  }

  resumeThread(threadId: string, opts?: CodexThreadOptions) {
    this.lastResumeOptions = opts;
    return new MockThread(threadId);
  }
}

const dummyClientFactory = () =>
  ({
    llm: { model: async () => ({ act: async () => undefined }) },
  }) as unknown as LMStudioClient;

const lmstudioAvailableClientFactory = () =>
  ({
    system: {
      listDownloadedModels: async () => [
        { modelKey: 'model-1', displayName: 'model-1', type: 'gguf' },
      ],
    },
    llm: {
      model: async () => ({
        act: async (_chat: unknown, _tools: unknown, opts?: unknown) => {
          const callbacks = opts as {
            onPredictionFragment?: (fragment: { content?: string }) => void;
            onMessage?: (message: unknown) => void;
          };
          callbacks.onPredictionFragment?.({ content: 'Hello' });
          callbacks.onMessage?.({
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello from LM Studio' }],
          });
        },
      }),
    },
  }) as unknown as LMStudioClient;

const ORIGINAL_CODEX_WORKDIR = process.env.CODEX_WORKDIR;
const ORIGINAL_CODEINFO_CODEX_WORKDIR = process.env.CODEINFO_CODEX_WORKDIR;
const ORIGINAL_CODEINFO_CODEX_HOME = process.env.CODEINFO_CODEX_HOME;
let tempCodexHomeForTest: string | undefined;

beforeEach(async () => {
  delete process.env.CODEX_WORKDIR;
  delete process.env.CODEINFO_CODEX_WORKDIR;
  tempCodexHomeForTest = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-codex-home-'),
  );
  await fs.mkdir(path.join(tempCodexHomeForTest, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHomeForTest, 'chat', 'config.toml'),
    'model = "gpt-5.1-codex-max"\n',
    'utf8',
  );
  process.env.CODEINFO_CODEX_HOME = tempCodexHomeForTest;
  memoryConversations.clear();
  memoryTurns.clear();
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'not detected',
  });
  conversationSeq = 0;
});

afterEach(async () => {
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

  if (ORIGINAL_CODEINFO_CODEX_HOME === undefined) {
    delete process.env.CODEINFO_CODEX_HOME;
  } else {
    process.env.CODEINFO_CODEX_HOME = ORIGINAL_CODEINFO_CODEX_HOME;
  }

  if (tempCodexHomeForTest) {
    await fs.rm(tempCodexHomeForTest, { recursive: true, force: true });
    tempCodexHomeForTest = undefined;
  }
});

let conversationSeq = 0;
const buildCodexBody = (overrides: Record<string, unknown> = {}) => ({
  provider: 'codex',
  model: 'gpt-5.1-codex-max',
  conversationId: `conv-codex-basic-${++conversationSeq}`,
  message: 'Hi',
  ...overrides,
});

async function waitForAssistantTurn(conversationId: string, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const turns = getMemoryTurns(conversationId);
    if (turns.some((t) => t.role === 'assistant' && (t.content ?? '').length)) {
      return turns;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for assistant turn: ${conversationId}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForNoSecondFinal(params: {
  ws: Awaited<ReturnType<typeof connectWs>>;
  conversationId: string;
  inflightId: string;
  timeoutMs?: number;
}): Promise<boolean> {
  try {
    await waitForEvent({
      ws: params.ws,
      predicate: (event: unknown): event is unknown => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === params.conversationId &&
          e.inflightId === params.inflightId
        );
      },
      timeoutMs: params.timeoutMs ?? 300,
    });
    return false;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Timed out waiting for WebSocket event')
    ) {
      return true;
    }
    throw error;
  }
}

test('codex chat streams token/final/complete with thread id', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const codexFactory = () => new MockCodex('thread-abc');

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
    // Subscribe before starting so the run-start snapshot is broadcast.
    sendJson(ws, {
      type: 'subscribe_conversation',
      conversationId: 'thread-abc',
    });

    // Start waits before triggering the HTTP request to avoid missing early frames.
    const snapshotPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflight: { inflightId: string };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflight?: { inflightId?: string };
        };
        return (
          e.type === 'inflight_snapshot' && e.conversationId === 'thread-abc'
        );
      },
      timeoutMs: 4000,
    });

    const deltaPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
        };
        return (
          e.type === 'assistant_delta' && e.conversationId === 'thread-abc'
        );
      },
      timeoutMs: 4000,
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
        threadId?: string;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
          status?: string;
          threadId?: string;
        };
        return e.type === 'turn_final' && e.conversationId === 'thread-abc';
      },
      timeoutMs: 4000,
    });

    const res = await request(httpServer)
      .post('/chat')
      .send(buildCodexBody({ conversationId: 'thread-abc' }))
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.conversationId, 'thread-abc');
    assert.equal(typeof res.body.inflightId, 'string');

    const snapshot = await snapshotPromise;
    assert.equal(snapshot.inflight.inflightId, res.body.inflightId);

    const delta = await deltaPromise;
    assert.equal(delta.inflightId, res.body.inflightId);

    const final = await finalPromise;
    assert.equal(final.inflightId, res.body.inflightId);

    assert.equal(final.status, 'ok');
    assert.equal(final.threadId, 'thread-abc');

    const turns = getMemoryTurns('thread-abc');
    const assistant = turns.find((turn) => turn.role === 'assistant');
    assert(assistant?.usage);
    assert.deepEqual(assistant.usage, {
      inputTokens: 1,
      outputTokens: 2,
      cachedInputTokens: 0,
      totalTokens: 3,
    });
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test('codex chat accepts non-standard reasoning effort when provided by shared capability resolver', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const fixture: CodexCapabilityResolution = {
    defaults: {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'on-failure',
      modelReasoningEffort: 'high',
      networkAccessEnabled: true,
      webSearchEnabled: true,
    },
    models: [
      {
        model: 'future-model',
        supportedReasoningEfforts: ['minimal', 'turbo'],
        defaultReasoningEffort: 'turbo',
      },
    ],
    byModel: new Map([
      [
        'future-model',
        {
          model: 'future-model',
          supportedReasoningEfforts: ['minimal', 'turbo'],
          defaultReasoningEffort: 'turbo',
        },
      ],
    ]),
    warnings: [],
    fallbackUsed: false,
  };

  const mockCodex = new MockCodex();
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => mockCodex,
      codexCapabilityResolver: async () => fixture,
    }),
  );

  const res = await request(app)
    .post('/chat')
    .send(
      buildCodexBody({
        model: 'future-model',
        modelReasoningEffort: 'turbo',
        conversationId: 'future-model-conv',
      }),
    );

  assert.equal(res.status, 202);
  assert.equal(mockCodex.lastStartOptions?.modelReasoningEffort, 'turbo');
});

test('codex chat rejects reasoning effort not supported by shared capability resolver for selected model', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const fixture: CodexCapabilityResolution = {
    defaults: {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'on-failure',
      modelReasoningEffort: 'minimal',
      networkAccessEnabled: true,
      webSearchEnabled: true,
    },
    models: [
      {
        model: 'strict-model',
        supportedReasoningEfforts: ['minimal'],
        defaultReasoningEffort: 'minimal',
      },
    ],
    byModel: new Map([
      [
        'strict-model',
        {
          model: 'strict-model',
          supportedReasoningEfforts: ['minimal'],
          defaultReasoningEffort: 'minimal',
        },
      ],
    ]),
    warnings: [],
    fallbackUsed: false,
  };

  const mockCodex = new MockCodex();
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => mockCodex,
      codexCapabilityResolver: async () => fixture,
    }),
  );

  const res = await request(app)
    .post('/chat')
    .send(
      buildCodexBody({
        model: 'strict-model',
        modelReasoningEffort: 'high',
        conversationId: 'strict-model-conv',
      }),
    );

  assert.equal(res.status, 400);
  assert.match(
    String(res.body?.message ?? ''),
    /modelReasoningEffort must be one of: minimal/,
  );
  assert.equal(mockCodex.lastStartOptions, undefined);
});

test('shared-home device-auth success unlocks chat without extra target selection', async () => {
  const app = express();
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: true,
    reason: 'auth missing',
  });
  app.use(
    '/codex',
    createCodexDeviceAuthRouter({
      discoverAgents: async () => [],
      propagateAgentAuthFromPrimary: async () => ({ agentCount: 0 }),
      refreshCodexDetection: () => {
        const detection = {
          available: true,
          authPresent: true,
          configPresent: true,
        };
        setCodexDetection(detection);
        return detection;
      },
      getCodexHome: () => tempCodexHomeForTest ?? '/tmp/codex-home',
      ensureCodexAuthFileStore: async (configPath: string) => ({
        changed: false,
        configPath,
      }),
      getCodexConfigPathForHome: (home: string) => `${home}/config.toml`,
      runCodexDeviceAuth: async () => ({
        ok: true,
        rawOutput: 'Open https://device.test/verify and enter code CODE-123.',
        completion: Promise.resolve({
          exitCode: 0,
          result: {
            ok: true,
            rawOutput:
              'Open https://device.test/verify and enter code CODE-123.',
          },
        }),
      }),
      resolveCodexCli: () => ({ available: true }),
    }),
  );
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => new MockCodex('thread-after-auth'),
    }),
  );

  await request(app).post('/codex/device-auth').send({}).expect(200);
  await new Promise((resolve) => setImmediate(resolve));

  const res = await request(app)
    .post('/chat')
    .send(
      buildCodexBody({
        conversationId: `conv-codex-after-device-auth-${++conversationSeq}`,
      }),
    );
  assert.equal(res.status, 202);
});

test('codex chat uses chat runtime config file (not base behavior keys)', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const chatDir = path.join(tempCodexHome, 'chat');
  await fs.mkdir(chatDir, { recursive: true });

  await fs.writeFile(
    path.join(tempCodexHome, 'config.toml'),
    [
      'model = "base-should-not-win"',
      '[projects]',
      '[projects."/base-only"]',
      'trust_level = "trusted"',
      '[projects."/shared"]',
      'trust_level = "trusted"',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(chatDir, 'config.toml'),
    [
      'model = "chat-should-win"',
      'approval_policy = "never"',
      '[projects]',
      '[projects."/shared"]',
      'trust_level = "untrusted"',
      '[projects."/chat-only"]',
      'trust_level = "trusted"',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempCodexHome, 'auth.json'), '{}', 'utf8');
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;

  let capturedOptions: CodexOptions | undefined;
  const codexFactory = (options?: CodexOptions) => {
    capturedOptions = options;
    return new MockCodex('thread-chat-config');
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );
  const originalInfo = console.info;
  const originalError = console.error;
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];
  console.info = (...args: unknown[]) => {
    infoLogs.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    errorLogs.push(args.map(String).join(' '));
  };

  try {
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          conversationId: 'conv-codex-chat-config',
          message: 'Use runtime config',
        }),
      );
    assert.equal(response.status, 202);

    const deadline = Date.now() + 3000;
    while (!capturedOptions && Date.now() < deadline) {
      await sleep(25);
    }
    assert(capturedOptions, 'expected codex options to be captured');
    assert.equal(capturedOptions.env?.CODEX_HOME, tempCodexHome);
    assert.equal(
      (capturedOptions.config as Record<string, unknown>)?.model,
      'chat-should-win',
    );

    const projects =
      (capturedOptions.config as { projects?: Record<string, unknown> })
        ?.projects ?? {};
    assert.equal(
      (projects['/base-only'] as { trust_level?: string } | undefined)
        ?.trust_level,
      'trusted',
    );
    assert.equal(
      (projects['/shared'] as { trust_level?: string } | undefined)
        ?.trust_level,
      'untrusted',
    );
    assert.equal(
      (projects['/chat-only'] as { trust_level?: string } | undefined)
        ?.trust_level,
      'trusted',
    );
    assert(
      infoLogs.some((line) =>
        line.includes(
          '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=success',
        ),
      ),
      'expected T06 success log for /chat runtime override application',
    );
    assert.equal(
      errorLogs.some((line) =>
        line.includes(
          '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=error',
        ),
      ),
      false,
      'did not expect T06 error log in /chat success path',
    );
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('codex chat emits deterministic T06 error when chat runtime config is missing', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  await fs.mkdir(tempCodexHome, { recursive: true });
  await fs.writeFile(
    path.join(tempCodexHome, 'config.toml'),
    'model = "base"\n',
  );
  process.env.CODEINFO_CODEX_HOME = tempCodexHome;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => new MockCodex('thread-missing-chat-config'),
    }),
  );

  const originalError = console.error;
  const errorLogs: string[] = [];
  console.error = (...args: unknown[]) => {
    errorLogs.push(args.map(String).join(' '));
  };

  try {
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          conversationId: 'conv-codex-chat-config-missing',
          message: 'Should fail due to missing chat config',
        }),
      )
      .expect(500);

    assert.equal(response.body.status, 'error');
    assert.equal(response.body.code, 'RUNTIME_CONFIG_MISSING');
    assert(
      errorLogs.some((line) =>
        line.includes(
          '[DEV-0000037][T06] event=runtime_overrides_applied_rest_paths result=error',
        ),
      ),
      'expected T06 error log for missing chat runtime config',
    );
  } finally {
    console.error = originalError;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});

test('codex stream publishes one terminal event per turn for tool-interleaved non-prefix updates', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  class NonPrefixThread extends MockThread {
    override async runStreamed(): Promise<{
      events: AsyncGenerator<ThreadEvent>;
    }> {
      const threadId = this.id;
      async function* generator(): AsyncGenerator<ThreadEvent> {
        yield { type: 'thread.started', thread_id: threadId } as ThreadEvent;
        yield {
          type: 'item.updated',
          item: { type: 'agent_message', id: 'm1', text: 'Hel' },
        } as ThreadEvent;
        yield {
          type: 'item.started',
          item: {
            type: 'mcp_tool_call',
            id: 'call-1',
            name: 'VectorSearch',
            arguments: '{"query":"hi"}',
          },
        } as unknown as ThreadEvent;
        yield {
          type: 'item.completed',
          item: {
            type: 'mcp_tool_call',
            id: 'call-1',
            result: {
              content: [{ type: 'application/json', json: { ok: true } }],
            },
          },
        } as ThreadEvent;
        yield {
          type: 'item.updated',
          item: { type: 'agent_message', id: 'm1', text: 'I can help' },
        } as ThreadEvent;
        yield {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            id: 'm1',
            text: 'I can help with that.',
          },
        } as ThreadEvent;
        yield { type: 'turn.completed' } as ThreadEvent;
      }

      return { events: generator() };
    }
  }

  class NonPrefixCodex extends MockCodex {
    override startThread(opts?: CodexThreadOptions) {
      this.lastStartOptions = opts;
      return new NonPrefixThread(this.id);
    }
  }

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => new NonPrefixCodex('thread-nonprefix'),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));

  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const ws = await connectWs({ baseUrl });
  const conversationId = 'thread-nonprefix';
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const response = await request(httpServer)
      .post('/chat')
      .send(buildCodexBody({ conversationId }))
      .expect(202);
    const inflightId = response.body.inflightId as string;

    const final = await waitForEvent({
      ws,
      predicate: (event: unknown): event is { status?: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
          status?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });
    assert.equal(final.status, 'ok');

    const noSecondFinal = await waitForNoSecondFinal({
      ws,
      conversationId,
      inflightId,
      timeoutMs: 350,
    });
    assert.equal(noSecondFinal, true);
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test('failed codex turns publish one terminal assistant state', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  class FailingThread extends MockThread {
    override async runStreamed(
      input?: string,
      opts?: CodexTurnOptions,
    ): Promise<{
      events: AsyncGenerator<ThreadEvent>;
    }> {
      void input;
      void opts;
      async function* generator(): AsyncGenerator<ThreadEvent> {
        yield {
          type: 'thread.started',
          thread_id: 'thread-failed',
        } as ThreadEvent;
        yield {
          type: 'item.updated',
          item: { type: 'agent_message', id: 'm1', text: 'Hello' },
        } as ThreadEvent;
        await sleep(250);
        yield {
          type: 'item.updated',
          item: { type: 'agent_message', id: 'm1', text: 'Hello world' },
        } as ThreadEvent;
        yield { type: 'error', message: 'provider failure' } as ThreadEvent;
      }

      return { events: generator() };
    }
  }

  class FailingCodex extends MockCodex {
    override startThread(opts?: CodexThreadOptions) {
      this.lastStartOptions = opts;
      return new FailingThread(this.id);
    }
  }

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => new FailingCodex('thread-failed'),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));

  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const ws = await connectWs({ baseUrl });
  const conversationId = 'thread-failed';
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    const response = await request(httpServer)
      .post('/chat')
      .send(buildCodexBody({ conversationId }))
      .expect(202);
    const inflightId = response.body.inflightId as string;

    const final = await waitForEvent({
      ws,
      predicate: (event: unknown): event is { status?: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
          status?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.inflightId === inflightId
        );
      },
      timeoutMs: 5000,
    });
    assert.equal(final.status, 'failed');

    const noSecondFinal = await waitForNoSecondFinal({
      ws,
      conversationId,
      inflightId,
      timeoutMs: 350,
    });
    assert.equal(noSecondFinal, true);
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test('codex chat resumes existing thread when threadId supplied', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-resume');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app)
    .post('/chat')
    .send(buildCodexBody({ threadId: 'thread-resume' }))
    .expect(202);

  assert.equal(mockCodex.lastResumeOptions?.model, 'gpt-5.1-codex-max');
});

test('codex chat sets workingDirectory and skipGitRepoCheck', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-opt');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app).post('/chat').send(buildCodexBody()).expect(202);

  assert.equal(mockCodex.lastStartOptions?.workingDirectory, '/data');
  assert.equal(mockCodex.lastStartOptions?.skipGitRepoCheck, true);
});

test('codex chat rejects when detection is unavailable', async () => {
  const app = express();
  app.use(express.json());
  app.use('/chat', createChatRouter({ clientFactory: dummyClientFactory }));

  const resUnavailable = await request(app)
    .post('/chat')
    .send(buildCodexBody({ message: 'hi' }));

  assert.equal(resUnavailable.status, 503);
  assert.equal(resUnavailable.body.status, 'error');
  assert.equal(resUnavailable.body.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(typeof resUnavailable.body.message, 'string');
  assert.ok(String(resUnavailable.body.message).length > 0);
});

test('codex request falls back once to lmstudio when codex is unavailable', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: lmstudioAvailableClientFactory }),
  );

  const response = await request(app).post('/chat').send(buildCodexBody());
  assert.equal(response.status, 202);
  assert.equal(response.body.provider, 'lmstudio');
  assert.equal(response.body.model, 'model-1');

  const turns = await waitForAssistantTurn(response.body.conversationId);
  assert.ok(turns.some((turn) => turn.role === 'assistant'));
});

test('lmstudio request falls back once to codex when lmstudio is unavailable', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const codexFactory = () => new MockCodex('thread-lmstudio-fallback');
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const response = await request(app)
    .post('/chat')
    .send(buildCodexBody({ provider: 'lmstudio', model: 'model-1' }));
  assert.equal(response.status, 202);
  assert.equal(response.body.provider, 'codex');
});

test('lmstudio request returns PROVIDER_UNAVAILABLE when both providers are unavailable', async () => {
  const app = express();
  app.use(express.json());
  app.use('/chat', createChatRouter({ clientFactory: dummyClientFactory }));

  const response = await request(app)
    .post('/chat')
    .send(buildCodexBody({ provider: 'lmstudio', model: 'model-1' }));
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
});

test('codex request returns PROVIDER_UNAVAILABLE when fallback provider has no selectable model', async () => {
  const app = express();
  app.use(express.json());
  app.use('/chat', createChatRouter({ clientFactory: dummyClientFactory }));

  const response = await request(app).post('/chat').send(buildCodexBody());
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
});

test('POST /chat persists turns without WS subscribers (run continues)', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const codexFactory = () => new MockCodex('thread-no-ws');

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const conversationId = 'thread-no-ws';
  await request(app)
    .post('/chat')
    .send(buildCodexBody({ conversationId }))
    .expect(202);

  const turns = await waitForAssistantTurn(conversationId);
  assert.ok(turns.some((t) => t.role === 'user'));
  assert.ok(turns.some((t) => t.role === 'assistant'));
});

test('POST /chat returns 409 RUN_IN_PROGRESS when a run is already active', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  class SlowThread extends MockThread {
    async runStreamed(): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
      const threadId = this.id;
      async function* generator(): AsyncGenerator<ThreadEvent> {
        yield { type: 'thread.started', thread_id: threadId } as ThreadEvent;
        await new Promise((resolve) => setTimeout(resolve, 150));
        yield {
          type: 'item.updated',
          item: { type: 'agent_message', text: 'Hello' },
        } as ThreadEvent;
        await new Promise((resolve) => setTimeout(resolve, 150));
        yield {
          type: 'item.completed',
          item: { type: 'agent_message', text: 'Hello world' },
        } as ThreadEvent;
        await new Promise((resolve) => setTimeout(resolve, 150));
        yield { type: 'turn.completed' } as ThreadEvent;
      }

      return { events: generator() };
    }
  }

  class SlowCodex extends MockCodex {
    override startThread(opts?: CodexThreadOptions) {
      this.lastStartOptions = opts;
      return new SlowThread(this.id);
    }
  }

  const codexFactory = () => new SlowCodex('thread-lock');
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const conversationId = 'thread-lock';
  const first = await request(app)
    .post('/chat')
    .send(buildCodexBody({ conversationId }))
    .expect(202);
  assert.equal(first.body.status, 'started');

  const second = await request(app)
    .post('/chat')
    .send(buildCodexBody({ conversationId, message: 'Second' }));
  assert.equal(second.status, 409);
  assert.equal(second.body.status, 'error');
  assert.equal(second.body.code, 'RUN_IN_PROGRESS');

  await waitForAssistantTurn(conversationId);
});
