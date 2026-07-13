import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import nodeTest, { mock } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import type {
  CodexOptions,
  ThreadEvent,
  ThreadOptions as CodexThreadOptions,
  TurnOptions as CodexTurnOptions,
} from '@openai/codex-sdk';
import express from 'express';
import request from 'supertest';
import pkg from '../../../package.json' with { type: 'json' };
import {
  releaseConversationLock,
  tryAcquireConversationLock,
} from '../../agents/runLock.js';
import {
  getMemoryTurns,
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import type { CodexCapabilityResolution } from '../../codex/capabilityResolver.js';
import { DEV_0000037_T01_REQUIRED_VERSION } from '../../config/codexSdkUpgrade.js';
import {
  __resetProviderBootstrapStatusForTests,
  __setProviderBootstrapStatusForTests,
} from '../../config/runtimeConfig.js';
import {
  __setGlobalCodexDetectionForTests,
  getCodexDetection,
  setCodexDetection,
} from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import { createCodexDeviceAuthRouter } from '../../routes/codexDeviceAuth.js';
import { setWorkingFolderStatForTests } from '../../workingFolders/state.js';
import { attachWs } from '../../ws/server.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
import { createMockCopilotSdkHarness } from '../support/mockCopilotSdk.js';
import {
  beginScopedTestEnvIsolation,
  endScopedTestEnvIsolation,
} from '../support/processEnvIsolation.js';
import { enterTestOverrideScope } from '../support/testOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
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
  async runStreamed(): Promise<{
    events: AsyncGenerator<ThreadEvent>;
  }> {
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
  lastResumeThreadId?: string;
  constructor(id = 'thread-mock') {
    this.id = id;
  }
  startThread(opts?: CodexThreadOptions) {
    this.lastStartOptions = opts;
    return new MockThread(this.id);
  }
  resumeThread(threadId: string, opts?: CodexThreadOptions) {
    this.lastResumeThreadId = threadId;
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
const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;
const ORIGINAL_CODEINFO_CODEX_HOME = process.env.CODEINFO_CODEX_HOME;
let tempCodexHomeForTest: string | undefined;
function createUnavailableCopilotLifecycle() {
  return createMockCopilotSdkHarness({
    name: 'integration-copilot-auth-required',
    authStatus: {
      isAuthenticated: false,
      authType: 'user',
      statusMessage: 'login required',
    },
  }).createLifecycle();
}
const test = (name: string, fn: () => Promise<void> | void) =>
  nodeTest(name, async () => {
    beginScopedTestEnvIsolation();
    clearScopedTestEnvValue('CODEX_WORKDIR');
    clearScopedTestEnvValue('CODEINFO_CODEX_WORKDIR');
    tempCodexHomeForTest = await fs.mkdtemp(
      path.join(os.tmpdir(), 'chat-codex-home-'),
    );
    await fs.mkdir(path.join(tempCodexHomeForTest, 'chat'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tempCodexHomeForTest, 'config.toml'),
      '',
      'utf8',
    );
    await fs.writeFile(
      path.join(tempCodexHomeForTest, 'chat', 'config.toml'),
      'model = "gpt-5.1-codex-max"\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(tempCodexHomeForTest, 'auth.json'),
      '{}',
      'utf8',
    );
    setScopedTestEnvValue('CODEX_HOME', tempCodexHomeForTest);
    setScopedTestEnvValue('CODEINFO_CODEX_HOME', tempCodexHomeForTest);
    memoryConversations.clear();
    memoryTurns.clear();
    setCodexDetection({
      available: false,
      authPresent: false,
      configPresent: false,
      reason: 'not detected',
    });
    __resetProviderBootstrapStatusForTests();
    conversationSeq = 0;
    try {
      await fn();
    } finally {
      mock.restoreAll();
      if (ORIGINAL_CODEX_WORKDIR === undefined) {
        clearScopedTestEnvValue('CODEX_WORKDIR');
      } else {
        setScopedTestEnvValue('CODEX_WORKDIR', ORIGINAL_CODEX_WORKDIR);
      }
      if (ORIGINAL_CODEINFO_CODEX_WORKDIR === undefined) {
        clearScopedTestEnvValue('CODEINFO_CODEX_WORKDIR');
      } else {
        setScopedTestEnvValue(
          'CODEINFO_CODEX_WORKDIR',
          ORIGINAL_CODEINFO_CODEX_WORKDIR,
        );
      }
      if (ORIGINAL_CODEX_HOME === undefined) {
        clearScopedTestEnvValue('CODEX_HOME');
      } else {
        setScopedTestEnvValue('CODEX_HOME', ORIGINAL_CODEX_HOME);
      }
      if (ORIGINAL_CODEINFO_CODEX_HOME === undefined) {
        clearScopedTestEnvValue('CODEINFO_CODEX_HOME');
      } else {
        setScopedTestEnvValue(
          'CODEINFO_CODEX_HOME',
          ORIGINAL_CODEINFO_CODEX_HOME,
        );
      }
      if (tempCodexHomeForTest) {
        await fs.rm(tempCodexHomeForTest, { recursive: true, force: true });
        tempCodexHomeForTest = undefined;
      }
      setWorkingFolderStatForTests(undefined);
      __resetProviderBootstrapStatusForTests();
      endScopedTestEnvIsolation();
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
const buildRepositoryBackedRuntimeHome = (
  codexHome: string,
  conversationId: string,
) =>
  path.join(
    codexHome,
    '.codeinfo-chat-runtimes',
    `conversation-${Buffer.from(conversationId, 'utf8').toString('base64url') || 'empty'}`,
  );
async function waitForAssistantTurn(conversationId: string, timeoutMs = 4000) {
  const deadline = Date.now() + resolveConfiguredTestTimeoutMs(timeoutMs);
  while (Date.now() < deadline) {
    const turns = getMemoryTurns(conversationId);
    if (turns.some((t) => t.role === 'assistant' && (t.content ?? '').length)) {
      return turns;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for assistant turn: ${conversationId}`);
}
async function waitForAssistantTurnCount(
  conversationId: string,
  assistantCount: number,
  timeoutMs = 4000,
) {
  const deadline = Date.now() + resolveConfiguredTestTimeoutMs(timeoutMs);
  while (Date.now() < deadline) {
    const turns = getMemoryTurns(conversationId);
    if (
      turns.filter((turn) => turn.role === 'assistant').length >= assistantCount
    ) {
      return turns;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for ${assistantCount} assistant turns: ${conversationId}`,
  );
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForCodexDetectionReady(timeoutMs = 4000) {
  const deadline = Date.now() + resolveConfiguredTestTimeoutMs(timeoutMs);
  while (Date.now() < deadline) {
    const detection = getCodexDetection();
    if (
      detection.available &&
      detection.authPresent &&
      detection.configPresent
    ) {
      return detection;
    }
    await sleep(25);
  }
  throw new Error(
    `Timed out waiting for Codex detection readiness: ${JSON.stringify(getCodexDetection())}`,
  );
}
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
  assert.equal(
    pkg.dependencies?.['@openai/codex-sdk'],
    DEV_0000037_T01_REQUIRED_VERSION,
  );
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
        inflight: {
          inflightId: string;
        };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflight?: {
            inflightId?: string;
          };
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
        agentFlags: { modelReasoningEffort: 'turbo' },
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
        agentFlags: { modelReasoningEffort: 'high' },
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
        __setGlobalCodexDetectionForTests(detection);
        return detection;
      },
      getCodexHome: () => tempCodexHomeForTest ?? '/tmp/codex-home',
      ensureCodexAuthFileStore: async (configPath: string) => ({
        changed: false,
        configPath,
      }),
      getCodexConfigPathForHome: (home: string) => `${home}/config.toml`,
      runCodexDeviceAuth: async () => ({
        provider: 'codex',
        state: 'verification_ready',
        verificationUrl: 'https://device.test/verify',
        userCode: 'CODE-123',
        displayOutput:
          'Open https://device.test/verify and enter code CODE-123.',
        completion: Promise.resolve({
          exitCode: 0,
          result: {
            provider: 'codex',
            state: 'completed',
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
  enterTestOverrideScope({ codexDetection: null });
  await waitForCodexDetectionReady();
  const res = await request(app)
    .post('/chat')
    .send(
      buildCodexBody({
        conversationId: `conv-codex-after-device-auth-${++conversationSeq}`,
      }),
    );
  assert.equal(res.status, 202, JSON.stringify(res.body));
});
test('codex chat uses chat runtime config file for inherited behavior keys while keeping the resolved execution model', async () => {
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
  setScopedTestEnvValue('CODEINFO_CODEX_HOME', tempCodexHome);
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
    const response = await request(app).post('/chat').send({
      provider: 'codex',
      conversationId: 'conv-codex-chat-config',
      message: 'Use runtime config',
    });
    assert.equal(response.status, 202);
    const deadline = Date.now() + resolveConfiguredTestTimeoutMs(3000);
    while (!capturedOptions && Date.now() < deadline) {
      await sleep(25);
    }
    assert(capturedOptions, 'expected codex options to be captured');
    assert.equal(capturedOptions.env?.CODEX_HOME, tempCodexHome);
    assert.equal(
      (capturedOptions.config as Record<string, unknown>)?.model,
      'gpt-5.6-sol',
    );
    const projects =
      (
        capturedOptions.config as {
          projects?: Record<string, unknown>;
        }
      )?.projects ?? {};
    assert.equal(
      (
        projects['/base-only'] as
          | {
              trust_level?: string;
            }
          | undefined
      )?.trust_level,
      'trusted',
    );
    assert.equal(
      (
        projects['/shared'] as
          | {
              trust_level?: string;
            }
          | undefined
      )?.trust_level,
      'untrusted',
    );
    assert.equal(
      (
        projects['/chat-only'] as
          | {
              trust_level?: string;
            }
          | undefined
      )?.trust_level,
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
    setScopedTestEnvValue('CODEINFO_CODEX_HOME', previousCodexHome);
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});
test('chat route overlays codex reasoning summary and verbosity into runtime config', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  let capturedOptions: CodexOptions | undefined;
  const codexFactory = (options?: CodexOptions) => {
    capturedOptions = options;
    return new MockCodex('thread-chat-overrides');
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );
  await request(app)
    .post('/chat')
    .send(
      buildCodexBody({
        conversationId: 'conv-codex-chat-overrides',
        agentFlags: {
          modelReasoningSummary: 'concise',
          modelVerbosity: 'high',
        },
      }),
    )
    .expect(202);
  const deadline = Date.now() + resolveConfiguredTestTimeoutMs(3000);
  while (!capturedOptions && Date.now() < deadline) {
    await sleep(25);
  }
  assert(capturedOptions, 'expected codex options to be captured');
  const config = capturedOptions.config as Record<string, unknown> | undefined;
  assert.equal(config?.model_reasoning_summary, 'concise');
  assert.equal(config?.model_verbosity, 'high');
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
  setScopedTestEnvValue('CODEINFO_CODEX_HOME', tempCodexHome);
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
    setScopedTestEnvValue('CODEINFO_CODEX_HOME', previousCodexHome);
    await fs.rm(tempCodexHome, { recursive: true, force: true });
  }
});
test('codex stream preserves nested subprocess cause details when runStreamed throws before any events arrive', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  class ThrowingThread extends MockThread {
    override async runStreamed(): Promise<{
      events: AsyncGenerator<ThreadEvent>;
    }> {
      throw Object.assign(
        new Error(
          'Codex Exec exited with code 1: Reading prompt from stdin...',
        ),
        {
          cause: new Error(
            'Error: thread/resume: thread/resume failed: no rollout found for thread id 019ecb2f-2e9a-7401-a449-9633616169a6 (code -32600)',
          ),
        },
      );
    }
  }
  class ThrowingCodex extends MockCodex {
    override startThread(opts?: CodexThreadOptions) {
      this.lastStartOptions = opts;
      return new ThrowingThread(this.id);
    }
  }
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => new ThrowingCodex('thread-throwing-cause'),
    }),
  );
  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'thread-throwing-cause';
  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });
    const response = await request(httpServer)
      .post('/chat')
      .send(buildCodexBody({ conversationId }))
      .expect(202);
    const inflightId = response.body.inflightId as string;
    const final = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        status?: string;
        error?: {
          message?: string;
        };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
          status?: string;
          error?: {
            message?: string;
          };
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
    assert.match(
      final.error?.message ?? '',
      /Codex Exec exited with code 1: Reading prompt from stdin/,
    );
    assert.match(
      final.error?.message ?? '',
      /thread\/resume failed: no rollout found/,
    );
  } finally {
    await closeWs(ws);
    wsHandle.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    );
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
      predicate: (
        event: unknown,
      ): event is {
        status?: string;
      } => {
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
      predicate: (
        event: unknown,
      ): event is {
        status?: string;
      } => {
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
test('codex chat preserves persisted thread when resuming the same conversation without request threadId', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const conversationId = 'conv-codex-persisted-thread';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Persisted thread conversation',
    source: 'REST',
    flags: { threadId: 'thread-persisted' },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  const mockCodex = new MockCodex('thread-persisted');
  const codexFactory = () => mockCodex;
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );
  await request(app)
    .post('/chat')
    .send(buildCodexBody({ conversationId }))
    .expect(202);
  await waitForAssistantTurn(conversationId);
  assert.equal(mockCodex.lastResumeThreadId, 'thread-persisted');
  assert.equal(mockCodex.lastStartOptions, undefined);
  assert.equal(
    memoryConversations.get(conversationId)?.flags?.threadId,
    'thread-persisted',
  );
});
test('implicit chat requests keep threadId until route-level fallback selects codex', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
  const originalCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const tempCopilotHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-copilot-home-'),
  );
  await fs.mkdir(path.join(tempCopilotHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(tempCopilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(tempCopilotHome, 'chat', 'config.toml'),
    'model = "copilot-gpt-5"\n',
    'utf8',
  );
  setScopedTestEnvValue('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
  setScopedTestEnvValue('CODEINFO_COPILOT_HOME', tempCopilotHome);
  const mockCodex = new MockCodex('thread-fallback-eligible');
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => mockCodex,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  try {
    const conversationId = 'conv-chat-threadid-fallback';
    const response = await request(app)
      .post('/chat')
      .send({
        conversationId,
        message: 'Resume the codex thread after fallback',
        threadId: 'thread-fallback-eligible',
      })
      .expect(202);
    await waitForAssistantTurn(conversationId);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'gpt-5.1-codex-max');
    assert.equal(mockCodex.lastResumeThreadId, 'thread-fallback-eligible');
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes('fell back to provider "codex"'),
      ),
      true,
    );
  } finally {
    if (originalDefaultProvider === undefined) {
      clearScopedTestEnvValue('CODEINFO_CHAT_DEFAULT_PROVIDER');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_CHAT_DEFAULT_PROVIDER',
        originalDefaultProvider,
      );
    }
    if (originalCopilotHome === undefined) {
      clearScopedTestEnvValue('CODEINFO_COPILOT_HOME');
    } else {
      setScopedTestEnvValue('CODEINFO_COPILOT_HOME', originalCopilotHome);
    }
    await fs.rm(tempCopilotHome, { recursive: true, force: true });
  }
});
test('endpoint-unavailable Codex chat falls back to the same provider native path before cross-provider fallback', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const externalServer = await startExternalOpenAiCompatServer({
    responseMode: 'transport-failure',
  });
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const originalCodexHome = process.env.CODEINFO_CODEX_HOME;
  const originalRuntimeCodexHome = process.env.CODEX_HOME;
  const codexHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-codex-home-'),
  );
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "gpt-5.6-sol"\n',
    'utf8',
  );
  setScopedTestEnvValue('CODEINFO_CODEX_HOME', codexHome);
  setScopedTestEnvValue('CODEX_HOME', codexHome);
  setScopedTestEnvValue(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    `${externalServer.baseUrl}/v1|responses`,
  );
  const mockCodex = new MockCodex('thread-endpoint-native-fallback');
  const codexFactory = () => mockCodex;
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );
  try {
    const response = await request(app)
      .post('/chat')
      .send({
        provider: 'codex',
        endpointId: `${externalServer.baseUrl}/v1`,
        model: 'missing-codex-model',
        conversationId: 'conv-codex-endpoint-native-fallback',
        message: 'Use native Codex before cross-provider fallback',
      })
      .expect(202);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'gpt-5.6-sol');
    assert.equal(mockCodex.lastStartOptions?.model, 'gpt-5.6-sol');
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes(
          `Endpoint "${externalServer.baseUrl}/v1" was unavailable; falling back to native codex model "gpt-5.6-sol".`,
        ),
      ),
      true,
    );
  } finally {
    await externalServer.stop();
    if (originalCodexHome === undefined) {
      clearScopedTestEnvValue('CODEINFO_CODEX_HOME');
    } else {
      setScopedTestEnvValue('CODEINFO_CODEX_HOME', originalCodexHome);
    }
    if (originalRuntimeCodexHome === undefined) {
      clearScopedTestEnvValue('CODEX_HOME');
    } else {
      setScopedTestEnvValue('CODEX_HOME', originalRuntimeCodexHome);
    }
    await fs.rm(codexHome, { recursive: true, force: true });
    if (originalCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        originalCompatEndpoints,
      );
    }
  }
});
test('POST /chat accepts a Codex endpoint pinned only in chat config when selectedEndpointId comes from that config', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['alpha-model'],
  });
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const originalCodexHome = process.env.CODEINFO_CODEX_HOME;
  const originalRuntimeCodexHome = process.env.CODEX_HOME;
  const codexHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-codex-home-'),
  );
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    [
      'model = "alpha-model"',
      `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
      '',
    ].join('\n'),
    'utf8',
  );
  setScopedTestEnvValue('CODEINFO_CODEX_HOME', codexHome);
  setScopedTestEnvValue('CODEX_HOME', codexHome);
  clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
  const mockCodex = new MockCodex('thread-config-pinned-endpoint');
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => mockCodex,
    }),
  );
  try {
    const conversationId = 'conv-codex-config-pinned-endpoint';
    const response = await request(app)
      .post('/chat')
      .send({
        provider: 'codex',
        conversationId,
        message: 'Use the pinned endpoint from config',
      })
      .expect(202);
    await waitForAssistantTurn(conversationId);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'alpha-model');
    assert.equal(mockCodex.lastStartOptions?.model, 'alpha-model');
    assert.equal(externalServer.requestCount(), 1);
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.endpointId,
      `${externalServer.baseUrl}/v1`,
    );
  } finally {
    await externalServer.stop();
    if (originalCodexHome === undefined) {
      clearScopedTestEnvValue('CODEINFO_CODEX_HOME');
    } else {
      setScopedTestEnvValue('CODEINFO_CODEX_HOME', originalCodexHome);
    }
    if (originalRuntimeCodexHome === undefined) {
      clearScopedTestEnvValue('CODEX_HOME');
    } else {
      setScopedTestEnvValue('CODEX_HOME', originalRuntimeCodexHome);
    }
    await fs.rm(codexHome, { recursive: true, force: true });
    if (originalCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        originalCompatEndpoints,
      );
    }
  }
});
test('POST /chat does not inherit a config-pinned endpoint when the request explicitly selects a native Codex model', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['alpha-model'],
  });
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const originalCodexHome = process.env.CODEINFO_CODEX_HOME;
  const originalRuntimeCodexHome = process.env.CODEX_HOME;
  const codexHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-codex-home-'),
  );
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    [
      'model = "alpha-model"',
      `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
      '',
    ].join('\n'),
    'utf8',
  );
  setScopedTestEnvValue('CODEINFO_CODEX_HOME', codexHome);
  setScopedTestEnvValue('CODEX_HOME', codexHome);
  clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
  const fixture: CodexCapabilityResolution = {
    defaults: {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      modelReasoningEffort: 'high',
      networkAccessEnabled: true,
      webSearchEnabled: true,
    },
    models: [
      {
        model: 'gpt-5.4',
        supportedReasoningEfforts: [
          'minimal',
          'low',
          'medium',
          'high',
          'xhigh',
        ],
        defaultReasoningEffort: 'high',
      },
    ],
    byModel: new Map([
      [
        'gpt-5.4',
        {
          model: 'gpt-5.4',
          supportedReasoningEfforts: [
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
          ],
          defaultReasoningEffort: 'high',
        },
      ],
    ]),
    warnings: [],
    fallbackUsed: false,
  };
  const mockCodex = new MockCodex('thread-config-pinned-native-model');
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
  try {
    const conversationId = 'conv-codex-config-pinned-native-model';
    const response = await request(app)
      .post('/chat')
      .send({
        provider: 'codex',
        model: 'gpt-5.4',
        conversationId,
        message: 'Use the requested native model',
      })
      .expect(202);
    await waitForAssistantTurn(conversationId);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'gpt-5.4');
    assert.deepEqual(response.body.warnings, []);
    assert.equal(mockCodex.lastStartOptions?.model, 'gpt-5.4');
    assert.equal(externalServer.requestCount(), 0);
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.endpointId,
      undefined,
    );
  } finally {
    await externalServer.stop();
    if (originalCodexHome === undefined) {
      clearScopedTestEnvValue('CODEINFO_CODEX_HOME');
    } else {
      setScopedTestEnvValue('CODEINFO_CODEX_HOME', originalCodexHome);
    }
    if (originalRuntimeCodexHome === undefined) {
      clearScopedTestEnvValue('CODEX_HOME');
    } else {
      setScopedTestEnvValue('CODEX_HOME', originalRuntimeCodexHome);
    }
    await fs.rm(codexHome, { recursive: true, force: true });
    if (originalCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        originalCompatEndpoints,
      );
    }
  }
});
test('resumed Codex chat treats a missing saved endpoint as provider unavailability instead of request validation failure', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
  const conversationId = 'conv-codex-missing-saved-endpoint';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Missing saved endpoint',
    source: 'REST',
    flags: {
      threadId: 'thread-missing-saved-endpoint',
      endpointId: 'https://missing.example/v1',
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const mockCodex = new MockCodex('thread-missing-saved-endpoint');
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => mockCodex,
    }),
  );
  try {
    const response = await request(app)
      .post('/chat')
      .send({
        conversationId,
        message: 'Continue the saved endpoint conversation',
      })
      .expect(503);
    assert.equal(response.body.status, 'error');
    assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
    assert.match(
      String(response.body.message),
      /Endpoint "https:\/\/missing\.example\/v1" is unavailable\./u,
    );
    assert.equal(mockCodex.lastStartOptions, undefined);
    assert.equal(mockCodex.lastResumeOptions, undefined);
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    if (originalCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        originalCompatEndpoints,
      );
    }
  }
});
test('pinned Codex chat fails in place when the saved endpoint later becomes unavailable', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const externalServer = await startExternalOpenAiCompatServer({
    responseMode: 'transport-failure',
  });
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  setScopedTestEnvValue(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    `${externalServer.baseUrl}/v1|responses`,
  );
  const conversationId = 'conv-codex-endpoint-fail-in-place';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Pinned endpoint conversation',
    source: 'REST',
    flags: { endpointId: `${externalServer.baseUrl}/v1` },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const mockCodex = new MockCodex('thread-endpoint-fail-in-place');
  const codexFactory = () => mockCodex;
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );
  try {
    const response = await request(app)
      .post('/chat')
      .send({
        conversationId,
        message: 'Do not drift away from the saved endpoint',
      })
      .expect(503);
    assert.equal(response.body.status, 'error');
    assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(mockCodex.lastStartOptions, undefined);
    assert.equal(mockCodex.lastResumeOptions, undefined);
  } finally {
    await externalServer.stop();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    if (originalCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        originalCompatEndpoints,
      );
    }
  }
});
test('resumed Codex chat ignores a contradictory request endpointId when a saved endpoint pin exists', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const savedEndpointServer = await startExternalOpenAiCompatServer({
    models: ['gpt-5.1-codex-max'],
  });
  const requestEndpointServer = await startExternalOpenAiCompatServer({
    models: ['gpt-5.1-codex-max'],
  });
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  setScopedTestEnvValue(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    `${savedEndpointServer.baseUrl}/v1|responses;${requestEndpointServer.baseUrl}/v1|responses`,
  );
  const conversationId = 'conv-codex-saved-endpoint-wins';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Saved endpoint identity',
    source: 'REST',
    flags: {
      threadId: 'thread-saved-endpoint',
      endpointId: `${savedEndpointServer.baseUrl}/v1`,
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const mockCodex = new MockCodex('thread-saved-endpoint');
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => mockCodex,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  try {
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          conversationId,
          endpointId: `${requestEndpointServer.baseUrl}/v1`,
          message: 'Keep the saved endpoint pin',
        }),
      )
      .expect(202);
    await waitForAssistantTurn(conversationId);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'gpt-5.1-codex-max');
    assert.equal(mockCodex.lastResumeThreadId, 'thread-saved-endpoint');
    assert.equal(mockCodex.lastStartOptions, undefined);
    assert.equal(savedEndpointServer.requestCount(), 1);
    assert.equal(requestEndpointServer.requestCount(), 0);
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.endpointId,
      `${savedEndpointServer.baseUrl}/v1`,
    );
  } finally {
    await savedEndpointServer.stop();
    await requestEndpointServer.stop();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    if (originalCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        originalCompatEndpoints,
      );
    }
  }
});
test('resumed native Codex chat ignores a contradictory request endpointId when the saved conversation has no endpoint pin', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const requestEndpointServer = await startExternalOpenAiCompatServer({
    models: ['gpt-5.1-codex-max'],
  });
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  setScopedTestEnvValue(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    `${requestEndpointServer.baseUrl}/v1|responses`,
  );
  const conversationId = 'conv-codex-native-resume-ignores-request-endpoint';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Saved native execution identity',
    source: 'REST',
    flags: {
      threadId: 'thread-saved-native',
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const mockCodex = new MockCodex('thread-saved-native');
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => mockCodex,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  try {
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          conversationId,
          endpointId: `${requestEndpointServer.baseUrl}/v1`,
          message: 'Keep the saved native execution identity',
        }),
      )
      .expect(202);
    await waitForAssistantTurn(conversationId);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'gpt-5.1-codex-max');
    assert.equal(mockCodex.lastResumeThreadId, 'thread-saved-native');
    assert.equal(requestEndpointServer.requestCount(), 0);
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.endpointId,
      undefined,
    );
  } finally {
    await requestEndpointServer.stop();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    if (originalCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        originalCompatEndpoints,
      );
    }
  }
});
test('resumed native Codex chat keeps the saved thread instead of drifting onto a newly requested endpoint', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  class FailingBeforeThreadCodex extends MockCodex {
    override startThread(opts?: CodexThreadOptions) {
      this.lastStartOptions = opts;
      class FailingBeforeThread extends MockThread {
        override async runStreamed(): Promise<{
          events: AsyncGenerator<ThreadEvent>;
        }> {
          async function* generator(): AsyncGenerator<ThreadEvent> {
            yield {
              type: 'error',
              message: 'failed before replacement thread creation',
            } as ThreadEvent;
          }
          return { events: generator() };
        }
      }
      return new FailingBeforeThread(this.id);
    }
  }
  const endpointServer = await startExternalOpenAiCompatServer({
    models: ['gpt-5.1-codex-max'],
  });
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  setScopedTestEnvValue(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    `${endpointServer.baseUrl}/v1|responses`,
  );
  const conversationId = 'conv-codex-stale-thread-cleared-on-endpoint-add';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Saved thread without endpoint identity',
    source: 'REST',
    flags: {
      threadId: 'thread-saved-endpoint',
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const mockCodex = new FailingBeforeThreadCodex(
    'thread-never-created-for-new-endpoint',
  );
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => mockCodex,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  try {
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          conversationId,
          endpointId: `${endpointServer.baseUrl}/v1`,
          message: 'Use the newly selected endpoint',
        }),
      )
      .expect(202);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'gpt-5.1-codex-max');
    assert.equal(mockCodex.lastResumeThreadId, 'thread-saved-endpoint');
    assert.equal(mockCodex.lastStartOptions, undefined);
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.endpointId,
      undefined,
    );
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.threadId,
      'thread-saved-endpoint',
    );
  } finally {
    await endpointServer.stop();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    if (originalCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        originalCompatEndpoints,
      );
    }
  }
});
test('resumed contradictory provider-model input cannot rewrite saved execution identity', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const conversationId = 'conv-chat-saved-identity-wins';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Saved execution identity',
    source: 'REST',
    flags: { threadId: 'thread-saved-identity' },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  const mockCodex = new MockCodex('thread-saved-identity');
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => mockCodex,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  const response = await request(app)
    .post('/chat')
    .send(
      buildCodexBody({
        conversationId,
        provider: 'lmstudio',
        model: 'model-1',
      }),
    )
    .expect(202);
  await waitForAssistantTurn(conversationId);
  assert.equal(response.body.provider, 'codex');
  assert.equal(response.body.model, 'gpt-5.1-codex-max');
  assert.equal(mockCodex.lastResumeThreadId, 'thread-saved-identity');
  assert.equal(memoryConversations.get(conversationId)?.provider, 'codex');
  assert.equal(
    memoryConversations.get(conversationId)?.model,
    'gpt-5.1-codex-max',
  );
});
test('repository-backed codex chat keeps the saved thread across a contradictory follow-up without rollout recording failure', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const workingRepo = '/data/story55-manual-proof/queued-repo';
  setWorkingFolderStatForTests(async (targetPath) => {
    if (path.resolve(targetPath) === path.resolve(workingRepo)) {
      return {
        isDirectory: () => true,
      } as never;
    }
    const error = new Error('not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
  class RepositoryBackedRolloutThread extends MockThread {
    constructor(
      id: string,
      private readonly shouldFailRolloutRecording: boolean,
    ) {
      super(id);
    }
    override async runStreamed(): Promise<{
      events: AsyncGenerator<ThreadEvent>;
    }> {
      const threadId = this.id;
      const shouldFailRolloutRecording = this.shouldFailRolloutRecording;
      async function* generator(): AsyncGenerator<ThreadEvent> {
        yield { type: 'thread.started', thread_id: threadId } as ThreadEvent;
        if (shouldFailRolloutRecording) {
          yield {
            type: 'error',
            message:
              `Codex Exec exited with code 1: Reading prompt from stdin...\n` +
              `${new Date(0).toISOString()} ERROR codex_core::session: failed to record rollout items: thread ${threadId} not found`,
          } as ThreadEvent;
          return;
        }
        yield {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            id: 'repo-backed-success',
            text: 'READY',
          },
        } as ThreadEvent;
        yield { type: 'turn.completed' } as ThreadEvent;
      }
      return { events: generator() };
    }
  }
  class RepositoryBackedCodex extends MockCodex {
    override startThread(opts?: CodexThreadOptions) {
      this.lastStartOptions = opts;
      const activeHome = lastCapturedCodexOptions?.env?.CODEX_HOME;
      const runtimeConfig = lastCapturedCodexOptions?.config as
        | Record<string, unknown>
        | undefined;
      const shouldFailRolloutRecording =
        opts?.model !== undefined ||
        opts?.approvalPolicy !== undefined ||
        activeHome === tempCodexHomeForTest ||
        runtimeConfig?.model !== undefined;
      return new RepositoryBackedRolloutThread(
        this.id,
        shouldFailRolloutRecording,
      );
    }
    override resumeThread(threadId: string, opts?: CodexThreadOptions) {
      this.lastResumeThreadId = threadId;
      this.lastResumeOptions = opts;
      const activeHome = lastCapturedCodexOptions?.env?.CODEX_HOME;
      const runtimeConfig = lastCapturedCodexOptions?.config as
        | Record<string, unknown>
        | undefined;
      const shouldFailRolloutRecording =
        threadId !== this.id ||
        opts?.model !== undefined ||
        opts?.approvalPolicy !== undefined ||
        activeHome === tempCodexHomeForTest ||
        runtimeConfig?.model !== undefined;
      return new RepositoryBackedRolloutThread(
        threadId,
        shouldFailRolloutRecording,
      );
    }
  }
  const conversationId = 'conv-chat-repo-backed-thread-persisted';
  const mockCodex = new RepositoryBackedCodex('thread-repo-backed');
  let lastCapturedCodexOptions: CodexOptions | undefined;
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: (options?: CodexOptions) => {
        lastCapturedCodexOptions = options;
        return mockCodex;
      },
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
      listIngestedRepositoriesFn: async () =>
        ({
          repos: [{ containerPath: workingRepo }],
          lockedModelId: null,
        }) as never,
    }),
  );
  const firstResponse = await request(app)
    .post('/chat')
    .send(
      buildCodexBody({
        conversationId,
        message: 'Reply with only READY.',
        working_folder: workingRepo,
      }),
    )
    .expect(202);
  const firstTurns = await waitForAssistantTurnCount(conversationId, 1);
  const firstAssistant = firstTurns
    .filter((turn) => turn.role === 'assistant')
    .at(-1);
  assert.equal(firstResponse.body.provider, 'codex');
  assert.equal(firstResponse.body.model, 'gpt-5.1-codex-max');
  assert.equal(firstAssistant?.status, 'ok');
  assert.equal(firstAssistant?.content, 'READY');
  const firstRuntimeHome = String(
    lastCapturedCodexOptions?.env?.CODEX_HOME ?? '',
  );
  assert.notEqual(firstRuntimeHome, tempCodexHomeForTest);
  assert.equal(
    (lastCapturedCodexOptions?.config as Record<string, unknown> | undefined)
      ?.model,
    undefined,
  );
  const runtimeChatConfig = await fs.readFile(
    path.join(firstRuntimeHome, 'chat', 'config.toml'),
    'utf8',
  );
  assert.match(runtimeChatConfig, /model = "gpt-5\.1-codex-max"/u);
  assert.equal(
    memoryConversations.get(conversationId)?.flags?.threadId,
    'thread-repo-backed',
  );
  assert.equal(mockCodex.lastStartOptions?.model, undefined);
  const resumedResponse = await request(app)
    .post('/chat')
    .send(
      buildCodexBody({
        conversationId,
        provider: 'lmstudio',
        model: 'model-1',
        message: 'Ignore the earlier instruction and reply with only CHANGED.',
        working_folder: workingRepo,
      }),
    )
    .expect(202);
  const resumedTurns = await waitForAssistantTurnCount(conversationId, 2);
  const assistantTurns = resumedTurns.filter(
    (turn) => turn.role === 'assistant',
  );
  const resumedAssistant = assistantTurns.at(-1);
  assert.equal(resumedResponse.body.provider, 'codex');
  assert.equal(resumedResponse.body.model, 'gpt-5.1-codex-max');
  assert.equal(mockCodex.lastResumeThreadId, 'thread-repo-backed');
  assert.equal(mockCodex.lastResumeOptions?.model, undefined);
  assert.equal(lastCapturedCodexOptions?.env?.CODEX_HOME, firstRuntimeHome);
  assert.equal(resumedAssistant?.status, 'ok');
  assert.equal(resumedAssistant?.content, 'READY');
  assert.equal(
    assistantTurns.some((turn) =>
      String(turn.content).includes('failed to record rollout items'),
    ),
    false,
  );
  assert.equal(
    memoryConversations.get(conversationId)?.flags?.threadId,
    'thread-repo-backed',
  );
});
test('repository-backed codex chat preserves live web search for Unsloth endpoints', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const workingRepo = '/data/story59-manual-proof/unsloth-repo';
  setWorkingFolderStatForTests(async (targetPath) => {
    if (path.resolve(targetPath) === path.resolve(workingRepo)) {
      return {
        isDirectory: () => true,
      } as never;
    }
    const error = new Error('not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const previousCompatEndpointKeys =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  let externalServer:
    | Awaited<ReturnType<typeof startExternalOpenAiCompatServer>>
    | undefined;
  try {
    externalServer = await startExternalOpenAiCompatServer({
      models: ['google/gemma-4-27b-it'],
    });
    setScopedTestEnvValue(
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
      `SparkUnsloth,${externalServer.baseUrl}/v1|responses,completions`,
    );
    setScopedTestEnvValue(
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
      'sparkunsloth,sk-unsloth-test',
    );
    const mockCodex = new MockCodex('thread-repo-unsloth');
    let lastCapturedCodexOptions: CodexOptions | undefined;
    const app = express();
    app.use(express.json());
    app.use(
      '/chat',
      createChatRouter({
        clientFactory: dummyClientFactory,
        codexFactory: (options?: CodexOptions) => {
          lastCapturedCodexOptions = options;
          return mockCodex;
        },
        copilotLifecycleFactory: createUnavailableCopilotLifecycle,
        listIngestedRepositoriesFn: async () =>
          ({
            repos: [{ containerPath: workingRepo }],
            lockedModelId: null,
          }) as never,
      }),
    );
    const conversationId = 'conv-chat-repo-unsloth-live-search';
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          conversationId,
          model: 'google/gemma-4-27b-it',
          endpointId: `${externalServer.baseUrl}/v1`,
          message: 'Search the web and reply briefly.',
          working_folder: workingRepo,
          agentFlags: {
            webSearchMode: 'live',
          },
        }),
      )
      .expect(202);
    await waitForAssistantTurn(conversationId);
    const materializedChatConfig = await fs.readFile(
      path.join(
        buildRepositoryBackedRuntimeHome(
          String(tempCodexHomeForTest),
          conversationId,
        ),
        'chat',
        'config.toml',
      ),
      'utf8',
    );
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'google/gemma-4-27b-it');
    assert.equal(mockCodex.lastStartOptions?.model, undefined);
    assert.equal(mockCodex.lastStartOptions?.webSearchMode, 'live');
    assert.match(
      JSON.stringify(lastCapturedCodexOptions?.config ?? {}),
      /"web_tools"/u,
    );
    assert.match(materializedChatConfig, /\[mcp_servers\.web_tools\]/u);
  } finally {
    await externalServer?.stop();
    if (previousCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        previousCompatEndpoints,
      );
    }
    if (previousCompatEndpointKeys === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
        previousCompatEndpointKeys,
      );
    }
  }
});
test('repository-backed codex chat skips managed web_tools when request-time web search is disabled', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const workingRepo = '/data/story59-manual-proof/unsloth-disabled-repo';
  setWorkingFolderStatForTests(async (targetPath) => {
    if (path.resolve(targetPath) === path.resolve(workingRepo)) {
      return {
        isDirectory: () => true,
      } as never;
    }
    const error = new Error('not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const previousCompatEndpointKeys =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  let externalServer:
    | Awaited<ReturnType<typeof startExternalOpenAiCompatServer>>
    | undefined;
  try {
    await fs.writeFile(
      path.join(String(tempCodexHomeForTest), 'chat', 'config.toml'),
      ['model = "gpt-5.1-codex-max"', 'web_search = "live"', ''].join('\n'),
      'utf8',
    );
    externalServer = await startExternalOpenAiCompatServer({
      models: ['google/gemma-4-27b-it'],
    });
    setScopedTestEnvValue(
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
      `SparkUnsloth,${externalServer.baseUrl}/v1|responses,completions`,
    );
    setScopedTestEnvValue(
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
      'sparkunsloth,sk-unsloth-test',
    );
    const mockCodex = new MockCodex('thread-repo-unsloth-disabled');
    let lastCapturedCodexOptions: CodexOptions | undefined;
    const app = express();
    app.use(express.json());
    app.use(
      '/chat',
      createChatRouter({
        clientFactory: dummyClientFactory,
        codexFactory: (options?: CodexOptions) => {
          lastCapturedCodexOptions = options;
          return mockCodex;
        },
        copilotLifecycleFactory: createUnavailableCopilotLifecycle,
        listIngestedRepositoriesFn: async () =>
          ({
            repos: [{ containerPath: workingRepo }],
            lockedModelId: null,
          }) as never,
      }),
    );
    const conversationId = 'conv-chat-repo-unsloth-disabled-search';
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          conversationId,
          model: 'google/gemma-4-27b-it',
          endpointId: `${externalServer.baseUrl}/v1`,
          message: 'Do not search the web.',
          working_folder: workingRepo,
          agentFlags: {
            webSearchMode: 'disabled',
          },
        }),
      )
      .expect(202);
    await waitForAssistantTurn(conversationId);
    const materializedChatConfig = await fs.readFile(
      path.join(
        buildRepositoryBackedRuntimeHome(
          String(tempCodexHomeForTest),
          conversationId,
        ),
        'chat',
        'config.toml',
      ),
      'utf8',
    );
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'google/gemma-4-27b-it');
    assert.equal(mockCodex.lastStartOptions?.model, undefined);
    assert.notEqual(mockCodex.lastStartOptions?.webSearchMode, 'live');
    assert.doesNotMatch(
      JSON.stringify(lastCapturedCodexOptions?.config ?? {}),
      /"web_tools"/u,
    );
    assert.match(materializedChatConfig, /^web_search = "disabled"$/mu);
    assert.doesNotMatch(materializedChatConfig, /^web_search = "live"$/mu);
    assert.doesNotMatch(materializedChatConfig, /\[mcp_servers\.web_tools\]/u);
  } finally {
    await externalServer?.stop();
    if (previousCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        previousCompatEndpoints,
      );
    }
    if (previousCompatEndpointKeys === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
        previousCompatEndpointKeys,
      );
    }
  }
});
test('repository-backed codex chat refreshes cached web-search warnings when request-time mode is live', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const workingRepo = '/data/story59-manual-proof/unsloth-cached-repo';
  setWorkingFolderStatForTests(async (targetPath) => {
    if (path.resolve(targetPath) === path.resolve(workingRepo)) {
      return {
        isDirectory: () => true,
      } as never;
    }
    const error = new Error('not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const previousCompatEndpointKeys =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  let externalServer:
    | Awaited<ReturnType<typeof startExternalOpenAiCompatServer>>
    | undefined;
  try {
    await fs.writeFile(
      path.join(String(tempCodexHomeForTest), 'chat', 'config.toml'),
      ['model = "gpt-5.1-codex-max"', 'web_search = "cached"', ''].join('\n'),
      'utf8',
    );
    externalServer = await startExternalOpenAiCompatServer({
      models: ['google/gemma-4-27b-it'],
    });
    setScopedTestEnvValue(
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
      `SparkUnsloth,${externalServer.baseUrl}/v1|responses,completions`,
    );
    setScopedTestEnvValue(
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
      'sparkunsloth,sk-unsloth-test',
    );
    const mockCodex = new MockCodex('thread-repo-unsloth-cached-live');
    let lastCapturedCodexOptions: CodexOptions | undefined;
    const app = express();
    app.use(express.json());
    app.use(
      '/chat',
      createChatRouter({
        clientFactory: dummyClientFactory,
        codexFactory: (options?: CodexOptions) => {
          lastCapturedCodexOptions = options;
          return mockCodex;
        },
        copilotLifecycleFactory: createUnavailableCopilotLifecycle,
        listIngestedRepositoriesFn: async () =>
          ({
            repos: [{ containerPath: workingRepo }],
            lockedModelId: null,
          }) as never,
      }),
    );
    const conversationId = 'conv-chat-repo-unsloth-cached-live-search';
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          conversationId,
          model: 'google/gemma-4-27b-it',
          endpointId: `${externalServer.baseUrl}/v1`,
          message: 'Search the web despite the cached default.',
          working_folder: workingRepo,
          agentFlags: {
            webSearchMode: 'live',
          },
        }),
      )
      .expect(202);
    await waitForAssistantTurn(conversationId);
    const materializedChatConfig = await fs.readFile(
      path.join(
        buildRepositoryBackedRuntimeHome(
          String(tempCodexHomeForTest),
          conversationId,
        ),
        'chat',
        'config.toml',
      ),
      'utf8',
    );
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'google/gemma-4-27b-it');
    assert.equal(mockCodex.lastStartOptions?.webSearchMode, 'live');
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes(
          'web_tools will not be injected for external endpoint execution',
        ),
      ),
      false,
    );
    assert.match(
      JSON.stringify(lastCapturedCodexOptions?.config ?? {}),
      /"web_tools"/u,
    );
    assert.match(materializedChatConfig, /^web_search = "live"$/mu);
    assert.match(materializedChatConfig, /\[mcp_servers\.web_tools\]/u);
  } finally {
    await externalServer?.stop();
    if (previousCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        previousCompatEndpoints,
      );
    }
    if (previousCompatEndpointKeys === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
        previousCompatEndpointKeys,
      );
    }
  }
});
test('repository-backed codex chat preserves config-owned live web search for Unsloth endpoints', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const workingRepo = '/data/story59-manual-proof/unsloth-repo';
  setWorkingFolderStatForTests(async (targetPath) => {
    if (path.resolve(targetPath) === path.resolve(workingRepo)) {
      return {
        isDirectory: () => true,
      } as never;
    }
    const error = new Error('not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const previousCompatEndpointKeys =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  let externalServer:
    | Awaited<ReturnType<typeof startExternalOpenAiCompatServer>>
    | undefined;
  try {
    await fs.writeFile(
      path.join(String(tempCodexHomeForTest), 'chat', 'config.toml'),
      ['model = "gpt-5.1-codex-max"', 'web_search_mode = "live"', ''].join(
        '\n',
      ),
      'utf8',
    );
    externalServer = await startExternalOpenAiCompatServer({
      models: ['google/gemma-4-27b-it'],
    });
    setScopedTestEnvValue(
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
      `SparkUnsloth,${externalServer.baseUrl}/v1|responses,completions`,
    );
    setScopedTestEnvValue(
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
      'sparkunsloth,sk-unsloth-test',
    );
    const mockCodex = new MockCodex('thread-repo-unsloth-config-search');
    const app = express();
    app.use(express.json());
    app.use(
      '/chat',
      createChatRouter({
        clientFactory: dummyClientFactory,
        codexFactory: () => mockCodex,
        copilotLifecycleFactory: createUnavailableCopilotLifecycle,
        listIngestedRepositoriesFn: async () =>
          ({
            repos: [{ containerPath: workingRepo }],
            lockedModelId: null,
          }) as never,
      }),
    );
    const conversationId = 'conv-chat-repo-unsloth-config-live-search';
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          conversationId,
          model: 'google/gemma-4-27b-it',
          endpointId: `${externalServer.baseUrl}/v1`,
          message: 'Search the web and reply briefly.',
          working_folder: workingRepo,
        }),
      )
      .expect(202);
    await waitForAssistantTurn(conversationId);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'google/gemma-4-27b-it');
    assert.equal(mockCodex.lastStartOptions?.model, undefined);
    assert.equal(mockCodex.lastStartOptions?.webSearchMode, 'live');
  } finally {
    await externalServer?.stop();
    if (previousCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        previousCompatEndpoints,
      );
    }
    if (previousCompatEndpointKeys === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
        previousCompatEndpointKeys,
      );
    }
  }
});
test('repository-backed codex chat preserves config-owned live web search for pinned Unsloth endpoints', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const workingRepo = '/data/story59-manual-proof/unsloth-pinned-repo';
  setWorkingFolderStatForTests(async (targetPath) => {
    if (path.resolve(targetPath) === path.resolve(workingRepo)) {
      return {
        isDirectory: () => true,
      } as never;
    }
    const error = new Error('not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
  const previousCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const previousCompatEndpointKeys =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  let externalServer:
    | Awaited<ReturnType<typeof startExternalOpenAiCompatServer>>
    | undefined;
  try {
    externalServer = await startExternalOpenAiCompatServer({
      models: ['google/gemma-4-27b-it'],
    });
    await fs.writeFile(
      path.join(String(tempCodexHomeForTest), 'chat', 'config.toml'),
      [
        'model = "google/gemma-4-27b-it"',
        'web_search_mode = "live"',
        `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
        '',
      ].join('\n'),
      'utf8',
    );
    setScopedTestEnvValue(
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
      `SparkUnsloth,${externalServer.baseUrl}/v1|responses,completions`,
    );
    setScopedTestEnvValue(
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
      'sparkunsloth,sk-unsloth-test',
    );
    const mockCodex = new MockCodex('thread-repo-unsloth-pinned-config-search');
    const app = express();
    app.use(express.json());
    app.use(
      '/chat',
      createChatRouter({
        clientFactory: dummyClientFactory,
        codexFactory: () => mockCodex,
        copilotLifecycleFactory: createUnavailableCopilotLifecycle,
        listIngestedRepositoriesFn: async () =>
          ({
            repos: [{ containerPath: workingRepo }],
            lockedModelId: null,
          }) as never,
      }),
    );
    const conversationId = 'conv-chat-repo-unsloth-pinned-config-live-search';
    const response = await request(app)
      .post('/chat')
      .send({
        provider: 'codex',
        conversationId,
        message: 'Search the web and reply briefly.',
        working_folder: workingRepo,
      })
      .expect(202);
    await waitForAssistantTurn(conversationId);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'google/gemma-4-27b-it');
    assert.equal(mockCodex.lastStartOptions?.model, undefined);
    assert.equal(mockCodex.lastStartOptions?.webSearchMode, 'live');
  } finally {
    await externalServer?.stop();
    if (previousCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        previousCompatEndpoints,
      );
    }
    if (previousCompatEndpointKeys === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
        previousCompatEndpointKeys,
      );
    }
  }
});
test('codex chat sets workingDirectory and skipGitRepoCheck', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  setScopedTestEnvValue('CODEINFO_CODEX_WORKDIR', '/mounted/default-root');
  const mockCodex = new MockCodex('thread-opt');
  const codexFactory = () => mockCodex;
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );
  await request(app).post('/chat').send(buildCodexBody()).expect(202);
  assert.equal(
    mockCodex.lastStartOptions?.workingDirectory,
    '/mounted/default-root',
  );
  assert.equal(mockCodex.lastStartOptions?.skipGitRepoCheck, true);
});
test('codex chat rejects when detection is unavailable', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  const resUnavailable = await request(app)
    .post('/chat')
    .send(buildCodexBody({ message: 'hi' }));
  assert.equal(resUnavailable.status, 503);
  assert.equal(resUnavailable.body.status, 'error');
  assert.equal(resUnavailable.body.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(typeof resUnavailable.body.message, 'string');
  assert.ok(String(resUnavailable.body.message).length > 0);
});
test('explicit codex request returns PROVIDER_UNAVAILABLE when codex is unavailable', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: lmstudioAvailableClientFactory,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  const response = await request(app).post('/chat').send(buildCodexBody());
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
});
test('explicit Codex /chat requests start in endpoint-only mode when Codex auth is missing but the selected endpoint is healthy', async () => {
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: true,
    cliPath: '/usr/bin/codex',
    reason: 'Missing auth.json in /tmp/codex',
  });
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['endpoint-codex-model'],
  });
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  setScopedTestEnvValue(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    `${externalServer.baseUrl}/v1|responses`,
  );
  const mockCodex = new MockCodex('thread-codex-endpoint-only');
  const codexFactory = () => mockCodex;
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  try {
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          endpointId: `${externalServer.baseUrl}/v1`,
          model: 'endpoint-codex-model',
          message: 'Run through the local endpoint without Codex auth',
        }),
      );
    assert.equal(response.status, 202);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'endpoint-codex-model');
    assert.equal(mockCodex.lastStartOptions?.model, 'endpoint-codex-model');
    assert.equal(
      memoryConversations.get(response.body.conversationId)?.provider,
      'codex',
    );
  } finally {
    await externalServer.stop();
    if (originalCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        originalCompatEndpoints,
      );
    }
  }
});
test('explicit Codex /chat requests fail closed when bootstrap is degraded even if the external endpoint is healthy', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  __setProviderBootstrapStatusForTests('codex', {
    healthy: false,
    reason: 'codex bootstrap degraded',
    warnings: ['codex bootstrap degraded warning'],
  });
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['gpt-5.1-codex-max'],
  });
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  setScopedTestEnvValue(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    `${externalServer.baseUrl}/v1|responses`,
  );
  const mockCodex = new MockCodex('thread-codex-bootstrap-degraded');
  const codexFactory = () => mockCodex;
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );
  try {
    const response = await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          endpointId: `${externalServer.baseUrl}/v1`,
          model: 'gpt-5.1-codex-max',
        }),
      );
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
    assert.match(String(response.body.message), /codex bootstrap degraded/i);
    assert.equal(mockCodex.lastStartOptions, undefined);
    assert.equal(mockCodex.lastResumeOptions, undefined);
  } finally {
    await externalServer.stop();
    if (originalCompatEndpoints === undefined) {
      clearScopedTestEnvValue('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
        originalCompatEndpoints,
      );
    }
  }
});
test('explicit lmstudio request returns PROVIDER_UNAVAILABLE when lmstudio is unavailable', async () => {
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
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  const response = await request(app)
    .post('/chat')
    .send(buildCodexBody({ provider: 'lmstudio', model: 'model-1' }));
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
});
test('lmstudio request returns PROVIDER_UNAVAILABLE when both providers are unavailable', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  const response = await request(app)
    .post('/chat')
    .send(buildCodexBody({ provider: 'lmstudio', model: 'model-1' }));
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
});
test('codex request returns PROVIDER_UNAVAILABLE when fallback provider has no selectable model', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  const response = await request(app).post('/chat').send(buildCodexBody());
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
});
test('explicit degraded-bootstrap chat requests fail clearly without silent provider switching', async () => {
  __setProviderBootstrapStatusForTests('codex', {
    healthy: false,
    reason: 'codex bootstrap degraded',
    warnings: ['codex bootstrap degraded warning'],
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
    }),
  );
  const response = await request(app).post('/chat').send(buildCodexBody());
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
  assert.match(String(response.body.message), /codex bootstrap degraded/i);
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
test('POST /chat returns RUN_IN_PROGRESS before codex readiness failure can mask the active run', async () => {
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    cliPath: '/usr/bin/codex',
    reason: 'codex bootstrap degraded',
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
    }),
  );
  const conversationId = 'thread-lock';
  assert.equal(tryAcquireConversationLock(conversationId), true);
  const response = await request(app)
    .post('/chat')
    .send(buildCodexBody({ conversationId, message: 'Second' }));
  assert.equal(response.status, 409);
  assert.equal(response.body.status, 'error');
  assert.equal(response.body.code, 'RUN_IN_PROGRESS');
  releaseConversationLock(conversationId);
});
test('RUN_IN_PROGRESS loser leaves persisted provider model and flags unchanged before lock-protected mutation begins', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const workingRepo = '/data/story55-manual-proof/queued-repo';
  setWorkingFolderStatForTests(async (targetPath) => {
    if (path.resolve(targetPath) === path.resolve(workingRepo)) {
      return {
        isDirectory: () => true,
      } as never;
    }
    const error = new Error('not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => new MockCodex('thread-lock'),
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
      listIngestedRepositoriesFn: async () =>
        ({
          repos: [{ containerPath: workingRepo }],
          lockedModelId: null,
        }) as never,
    }),
  );
  const conversationId = 'thread-lock-no-mutation';
  const originalConversation = {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Locked conversation',
    source: 'REST',
    flags: {
      threadId: 'thread-lock-persisted',
      workingFolder: '/repo/original',
    },
    lastMessageAt: new Date('2026-05-07T00:00:00.000Z'),
    archivedAt: null,
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    updatedAt: new Date('2026-05-07T00:00:00.000Z'),
  };
  memoryConversations.set(conversationId, originalConversation as never);
  assert.equal(tryAcquireConversationLock(conversationId), true);
  const response = await request(app)
    .post('/chat')
    .send(
      buildCodexBody({
        conversationId,
        provider: 'lmstudio',
        model: 'model-1',
        working_folder: workingRepo,
      }),
    );
  assert.equal(response.status, 409);
  assert.equal(response.body.status, 'error');
  assert.equal(response.body.code, 'RUN_IN_PROGRESS');
  const persistedConversation = memoryConversations.get(conversationId);
  assert.equal(persistedConversation?.provider, originalConversation.provider);
  assert.equal(persistedConversation?.model, originalConversation.model);
  assert.deepEqual(persistedConversation?.flags, originalConversation.flags);
  assert.equal(
    persistedConversation?.lastMessageAt?.toISOString(),
    originalConversation.lastMessageAt.toISOString(),
  );
  assert.equal(
    persistedConversation?.updatedAt?.toISOString(),
    originalConversation.updatedAt.toISOString(),
  );
  const runtimesRoot = path.join(
    String(tempCodexHomeForTest),
    '.codeinfo-chat-runtimes',
  );
  const runtimeEntries = await fs.readdir(runtimesRoot).catch(() => []);
  assert.deepEqual(runtimeEntries, []);
  releaseConversationLock(conversationId);
});
test('repository-backed codex chat keeps distinct runtime homes for conversation ids that previously sanitized the same way', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const workingRepo = '/data/story55-manual-proof/queued-repo';
  setWorkingFolderStatForTests(async (targetPath) => {
    if (path.resolve(targetPath) === path.resolve(workingRepo)) {
      return {
        isDirectory: () => true,
      } as never;
    }
    const error = new Error('not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
  const capturedHomes = new Map<string, string>();
  const firstConversationId = 'conv:shared-runtime-home';
  const secondConversationId = 'conv-shared-runtime-home';
  let lastCodexHome = '';
  const recordingApp = express();
  recordingApp.use(express.json());
  recordingApp.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: (options?: CodexOptions) => {
        lastCodexHome = String(options?.env?.CODEX_HOME ?? '');
        return new MockCodex(`thread-${capturedHomes.size + 1}`);
      },
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
      listIngestedRepositoriesFn: async () =>
        ({
          repos: [{ containerPath: workingRepo }],
          lockedModelId: null,
        }) as never,
    }),
  );
  await request(recordingApp)
    .post('/chat')
    .send(
      buildCodexBody({
        conversationId: firstConversationId,
        message: 'Reply with only READY.',
        working_folder: workingRepo,
      }),
    )
    .expect(202);
  await waitForAssistantTurn(firstConversationId);
  capturedHomes.set(firstConversationId, lastCodexHome);
  await request(recordingApp)
    .post('/chat')
    .send(
      buildCodexBody({
        conversationId: secondConversationId,
        message: 'Reply with only READY.',
        working_folder: workingRepo,
      }),
    )
    .expect(202);
  await waitForAssistantTurn(secondConversationId);
  capturedHomes.set(secondConversationId, lastCodexHome);
  const firstHome = capturedHomes.get(firstConversationId);
  const secondHome = capturedHomes.get(secondConversationId);
  assert.ok(firstHome);
  assert.ok(secondHome);
  assert.notEqual(firstHome, secondHome);
  assert.equal(
    firstHome,
    buildRepositoryBackedRuntimeHome(
      String(tempCodexHomeForTest),
      firstConversationId,
    ),
  );
  assert.equal(
    secondHome,
    buildRepositoryBackedRuntimeHome(
      String(tempCodexHomeForTest),
      secondConversationId,
    ),
  );
  await assert.doesNotReject(async () => {
    await fs.access(path.join(String(firstHome), 'chat', 'config.toml'));
    await fs.access(path.join(String(secondHome), 'chat', 'config.toml'));
  });
});
test('chat forwards CODEINFO_ROOT into the Codex runtime environment', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-codex-codeinfo-root-'),
  );
  let capturedOptions: CodexOptions | undefined;
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: (options?: CodexOptions) => {
        capturedOptions = options;
        return new MockCodex('thread-codeinfo-root');
      },
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
      listIngestedRepositoriesFn: async () =>
        ({
          repos: [{ containerPath: repoRoot }],
          lockedModelId: null,
        }) as never,
    }),
  );
  try {
    const conversationId = 'chat-codex-codeinfo-root';
    await request(app)
      .post('/chat')
      .send(
        buildCodexBody({
          conversationId,
          message: 'Reply with only READY.',
          working_folder: repoRoot,
        }),
      )
      .expect(202);
    await waitForAssistantTurn(conversationId);
    assert.equal(capturedOptions?.env?.CODEINFO_ROOT, repoRoot);
  } finally {
    memoryConversations.delete('chat-codex-codeinfo-root');
    memoryTurns.delete('chat-codex-codeinfo-root');
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
test('repository-backed codex chat reports filesystem materialization failures without mislabeling them as config-invalid', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });
  const workingRepo = '/data/story55-manual-proof/queued-repo';
  setWorkingFolderStatForTests(async (targetPath) => {
    if (path.resolve(targetPath) === path.resolve(workingRepo)) {
      return {
        isDirectory: () => true,
      } as never;
    }
    const error = new Error('not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
  const originalWriteFile = fs.writeFile.bind(fs);
  mock.method(
    fs,
    'writeFile',
    async (...args: Parameters<typeof fs.writeFile>) => {
      const target = String(args[0]);
      if (
        target.includes(`${path.sep}.codeinfo-chat-runtimes${path.sep}`) &&
        target.endsWith(`${path.sep}chat${path.sep}config.toml`)
      ) {
        const error = new Error('permission denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      }
      return originalWriteFile(...args);
    },
  );
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: dummyClientFactory,
      codexFactory: () => new MockCodex('thread-materialize-error'),
      copilotLifecycleFactory: createUnavailableCopilotLifecycle,
      listIngestedRepositoriesFn: async () =>
        ({
          repos: [{ containerPath: workingRepo }],
          lockedModelId: null,
        }) as never,
    }),
  );
  const response = await request(app)
    .post('/chat')
    .send(
      buildCodexBody({
        conversationId: 'conv-chat-runtime-home-permission',
        working_folder: workingRepo,
      }),
    )
    .expect(500);
  assert.equal(response.body.code, 'RUNTIME_CONFIG_UNREADABLE');
  assert.match(
    String(response.body.message),
    /repository-backed chat runtime home/u,
  );
});
