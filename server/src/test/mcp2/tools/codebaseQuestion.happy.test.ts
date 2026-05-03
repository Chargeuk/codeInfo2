import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ModelInfo } from '@github/copilot-sdk';
import { ChatInterface } from '../../../chat/interfaces/ChatInterface.js';
import { ChatInterfaceCopilot } from '../../../chat/interfaces/ChatInterfaceCopilot.js';
import { McpResponder } from '../../../chat/responders/McpResponder.js';
import { resolveChatDefaults } from '../../../config/chatDefaults.js';
import { query, resetStore } from '../../../logStore.js';
import { handleRpc } from '../../../mcp2/router.js';
import { resetToolDeps, setToolDeps } from '../../../mcp2/tools.js';
import { createMockCopilotSdkHarness } from '../../support/mockCopilotSdk.js';

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

class BlockingReplayThread {
  id: string;
  private answerText: string;
  private onStarted: () => void;
  private releasePromise: Promise<void>;

  constructor(params: {
    id: string;
    answerText: string;
    onStarted: () => void;
    releasePromise: Promise<void>;
  }) {
    this.id = params.id;
    this.answerText = params.answerText;
    this.onStarted = params.onStarted;
    this.releasePromise = params.releasePromise;
  }

  async runStreamed() {
    const threadId = this.id;
    const answerText = this.answerText;
    const onStarted = this.onStarted;
    const releasePromise = this.releasePromise;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: threadId };
      onStarted();
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: answerText },
      };
      await releasePromise;
      yield { type: 'turn.completed', thread_id: threadId };
    }

    return { events: generator() };
  }
}

class DivergentReplayCodex extends MockCodex {
  runs = 0;
  private readonly providerThreadId: string;
  private waitForStartPromise: Promise<void> | null = null;
  private resolveStarted: (() => void) | null = null;
  private releaseCurrentRun: (() => void) | null = null;

  constructor(providerThreadId = 'provider-thread-xyz') {
    super(providerThreadId);
    this.providerThreadId = providerThreadId;
  }

  override resumeThread(threadId: string, opts?: unknown) {
    this.lastResumeId = threadId;
    this.lastResumeOptions = opts;
    this.runs += 1;
    return this.createThread();
  }

  async waitForRunStart() {
    while (!this.waitForStartPromise) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await this.waitForStartPromise;
  }

  releaseRun() {
    if (!this.releaseCurrentRun) {
      throw new Error('releaseRun called before a run started');
    }
    this.releaseCurrentRun();
  }

  private createThread() {
    const shouldBlock = this.runs === 1;
    let releasePromise = Promise.resolve();
    this.waitForStartPromise = new Promise<void>((resolve) => {
      this.resolveStarted = resolve;
    });
    if (shouldBlock) {
      let resolveRelease: (() => void) | null = null;
      releasePromise = new Promise<void>((resolve) => {
        resolveRelease = resolve;
      });
      this.releaseCurrentRun = resolveRelease;
    } else {
      this.releaseCurrentRun = () => {};
    }

    return new BlockingReplayThread({
      id: this.providerThreadId,
      answerText: `Codex replay answer ${this.runs}`,
      onStarted: () => {
        this.resolveStarted?.();
      },
      releasePromise,
    });
  }
}

type JsonRpcHttpResponse = {
  id?: number | string | null;
  result?: {
    content: Array<{ type: string; text: string }>;
  };
  error?: {
    code: number;
    message: string;
  };
};

const makeLmStudioClientFactory = () => () =>
  ({
    system: {
      listDownloadedModels: async () => [],
    },
  }) as never;

async function withTempCodexHome(params: {
  chatToml: string;
  baseToml?: string;
}): Promise<{
  codexHome: string;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-task8-happy-'),
  );
  const codexHome = path.join(root, 'codex');
  if (params.baseToml !== undefined) {
    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(
      path.join(codexHome, 'config.toml'),
      params.baseToml,
      'utf8',
    );
  }
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    params.chatToml,
    'utf8',
  );
  return {
    codexHome,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function withTempCopilotHome(chatToml: string): Promise<{
  copilotHome: string;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-task8-copilot-'),
  );
  const copilotHome = path.join(root, 'copilot');
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    chatToml,
    'utf8',
  );
  return {
    copilotHome,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

class CapturingChat extends ChatInterface {
  lastFlags?: Record<string, unknown>;

  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void> {
    void conversationId;
    void model;
    this.lastFlags = flags;
    this.emit('thread', { type: 'thread', threadId: 'captured-thread' });
    this.emit('final', { type: 'final', content: 'Captured answer' });
    this.emit('complete', { type: 'complete', threadId: 'captured-thread' });
  }
}

class ReplayBarrierChat extends ChatInterface {
  runs = 0;

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void> {
    void flags;
    void model;
    this.runs += 1;
    this.emit('thread', {
      type: 'thread',
      threadId: conversationId,
    });
    this.emit('final', {
      type: 'final',
      content: `Replay answer ${this.runs}: ${message}`,
    });
    this.emit('complete', {
      type: 'complete',
      threadId: conversationId,
    });
  }
}

async function postJson(port: number, body: unknown) {
  const payload = JSON.stringify(body);
  return await new Promise<JsonRpcHttpResponse>((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      agent: false,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        connection: 'close',
      },
    });

    let responseBody = '';

    req.on('response', (response) => {
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (error) {
          reject(error);
        }
      });
      response.on('error', reject);
    });

    req.on('error', reject);
    req.end(payload);
  });
}

async function runCodebaseQuestion(
  args: Record<string, unknown>,
  deps?: Parameters<typeof setToolDeps>[0],
) {
  if (deps) {
    setToolDeps({
      clientFactory: makeLmStudioClientFactory(),
      ...deps,
    });
  }

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const response = await postJson(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: args,
      },
    });

    assert.ok(response.result);
    return response.result;
  } finally {
    resetToolDeps();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

test('codebase_question returns answer-only payloads and preserves conversationId', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalCodeHome = process.env.CODEX_HOME;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  resetStore();
  const mockCodex = new MockCodex('thread-abc');
  setToolDeps({
    codexFactory: () => mockCodex,
    clientFactory: makeLmStudioClientFactory(),
  });
  const tempHome = await withTempCodexHome({
    chatToml: [
      'model = "gpt-5.3-codex-spark"',
      'sandbox_mode = "workspace-write"',
      'approval_policy = "on-request"',
      'model_reasoning_effort = "minimal"',
      'web_search_mode = "disabled"',
      '',
    ].join('\n'),
  });
  process.env.CODEX_HOME = tempHome.codexHome;
  process.env.Codex_network_access_enabled = 'false';

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

    assert.ok(firstCall.result);
    assert.equal(firstCall.result.content[0].type, 'text');
    const firstPayload = JSON.parse(firstCall.result.content[0].text);
    const defaults = resolveChatDefaults({ requestProvider: 'codex' });

    assert.equal(firstPayload.conversationId, 'thread-abc');
    assert.equal(firstPayload.modelId, defaults.model);
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

    assert.ok(secondCall.result);
    const secondPayload = JSON.parse(secondCall.result.content[0].text);
    assert.equal(secondPayload.conversationId, 'thread-abc');
    assert.equal(mockCodex.lastResumeId, 'thread-abc');
    assert.equal(
      (mockCodex.lastStartOptions as { sandboxMode?: string }).sandboxMode,
      'workspace-write',
    );
    assert.equal(
      (mockCodex.lastStartOptions as { approvalPolicy?: string })
        .approvalPolicy,
      'on-request',
    );
    assert.equal(
      (mockCodex.lastStartOptions as { modelReasoningEffort?: string })
        .modelReasoningEffort,
      'minimal',
    );
    assert.equal(
      (mockCodex.lastStartOptions as { webSearchEnabled?: boolean })
        .webSearchEnabled,
      false,
    );
    const markerLogs = query({
      source: ['server'],
      text: 'DEV_0000040_T08_MCP_DEFAULTS_APPLIED',
    });
    assert.ok(markerLogs.length > 0);
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    delete process.env.Codex_network_access_enabled;
    await tempHome.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test('codebase_question reuses shared provider defaults when provider copilot is selected', async () => {
  const originalHome = process.env.CODEINFO_COPILOT_HOME;
  const tempHome = await withTempCopilotHome(
    ['model = "copilot-default-model"', 'tool_access = "off"', ''].join('\n'),
  );
  process.env.CODEINFO_COPILOT_HOME = tempHome.copilotHome;
  const chat = new CapturingChat();

  try {
    const result = await runCodebaseQuestion(
      { question: 'copilot defaults?', provider: 'copilot' },
      {
        chatFactory: () => chat,
        copilotReadinessResolver: async () => ({
          available: true,
          toolsAvailable: true,
          blockingStage: 'ready',
          models: ['copilot-default-model'],
          modelsRaw: [],
          authSource: 'env-token',
        }),
      },
    );

    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.modelId, 'copilot-default-model');
  } finally {
    if (originalHome === undefined) delete process.env.CODEINFO_COPILOT_HOME;
    else process.env.CODEINFO_COPILOT_HOME = originalHome;
    await tempHome.cleanup();
  }
});

test('codebase_question replays one stable Copilot follow-up result for the same caller-visible replayId while a different replayId stays on the fresh path', async () => {
  const chat = new ReplayBarrierChat();
  const deps = {
    chatFactory: () => chat,
    copilotReadinessResolver: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready' as const,
      models: ['copilot-gpt-5'],
      modelsRaw: [],
      authSource: 'env-token' as const,
    }),
  };

  const firstResult = await runCodebaseQuestion(
    {
      question: 'first logical follow-up',
      conversationId: 'mcp-replay-happy-1',
      replayId: 'replay-1',
      provider: 'copilot',
      model: 'copilot-gpt-5',
    },
    deps,
  );
  const firstPayload = JSON.parse(firstResult.content[0].text);

  const sameReplayResult = await runCodebaseQuestion(
    {
      question: 'contradictory stale retry',
      conversationId: 'mcp-replay-happy-1',
      replayId: 'replay-1',
      provider: 'copilot',
      model: 'copilot-gpt-5',
    },
    deps,
  );
  const sameReplayPayload = JSON.parse(sameReplayResult.content[0].text);

  assert.equal(chat.runs, 1);
  assert.deepEqual(sameReplayPayload, firstPayload);

  const freshReplayResult = await runCodebaseQuestion(
    {
      question: 'fresh logical follow-up',
      conversationId: 'mcp-replay-happy-1',
      replayId: 'replay-2',
      provider: 'copilot',
      model: 'copilot-gpt-5',
    },
    deps,
  );
  const freshReplayPayload = JSON.parse(freshReplayResult.content[0].text);

  assert.equal(chat.runs, 2);
  assert.equal(freshReplayPayload.conversationId, 'mcp-replay-happy-1');
  assert.equal(
    freshReplayPayload.segments[0].text,
    'Replay answer 2: fresh logical follow-up',
  );
});

test('codebase_question keeps caller conversationId stable across Codex replay windows even when provider thread ids differ', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalCodeHome = process.env.CODEX_HOME;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  resetStore();
  const divergentCodex = new DivergentReplayCodex('provider-thread-xyz');
  setToolDeps({
    codexFactory: () => divergentCodex,
    clientFactory: makeLmStudioClientFactory(),
  });
  const tempHome = await withTempCodexHome({
    chatToml: [
      'model = "gpt-5.3-codex-spark"',
      'sandbox_mode = "workspace-write"',
      'approval_policy = "on-request"',
      'model_reasoning_effort = "minimal"',
      'web_search_mode = "disabled"',
      '',
    ].join('\n'),
  });
  process.env.CODEX_HOME = tempHome.codexHome;
  process.env.Codex_network_access_enabled = 'false';

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const firstCallPromise = postJson(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'first logical follow-up',
          conversationId: 'caller-follow-up-1',
          replayId: 'replay-1',
          provider: 'codex',
        },
      },
    });

    await divergentCodex.waitForRunStart();

    const sameReplayPromise = postJson(port, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'stale retry should not win',
          conversationId: 'caller-follow-up-1',
          replayId: 'replay-1',
          provider: 'codex',
        },
      },
    });

    assert.equal(divergentCodex.runs, 1);
    divergentCodex.releaseRun();

    const firstCall = await firstCallPromise;
    const sameReplayCall = await sameReplayPromise;

    assert.ok(firstCall.result);
    assert.ok(sameReplayCall.result);
    const firstPayload = JSON.parse(firstCall.result.content[0].text);
    const sameReplayPayload = JSON.parse(sameReplayCall.result.content[0].text);

    assert.equal(firstPayload.conversationId, 'caller-follow-up-1');
    assert.equal(sameReplayPayload.conversationId, 'caller-follow-up-1');
    assert.deepEqual(sameReplayPayload, firstPayload);
    assert.equal(divergentCodex.lastResumeId, 'caller-follow-up-1');

    const afterCleanupCall = await postJson(port, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'late stale retry should still replay',
          conversationId: 'caller-follow-up-1',
          replayId: 'replay-1',
          provider: 'codex',
        },
      },
    });

    assert.ok(afterCleanupCall.result);
    const afterCleanupPayload = JSON.parse(
      afterCleanupCall.result.content[0].text,
    );
    assert.equal(afterCleanupPayload.conversationId, 'caller-follow-up-1');
    assert.deepEqual(afterCleanupPayload, firstPayload);

    const freshReplayCall = await postJson(port, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'fresh logical follow-up',
          conversationId: 'caller-follow-up-1',
          replayId: 'replay-2',
          provider: 'codex',
        },
      },
    });

    assert.ok(freshReplayCall.result);
    const freshReplayPayload = JSON.parse(
      freshReplayCall.result.content[0].text,
    );
    assert.equal(divergentCodex.runs, 2);
    assert.equal(freshReplayPayload.conversationId, 'caller-follow-up-1');
    assert.equal(freshReplayPayload.segments[0].text, 'Codex replay answer 2');
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    delete process.env.Codex_network_access_enabled;
    await tempHome.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test('codebase_question normalizes implicit Copilot defaults and omits reasoning for models that do not support it', async () => {
  const originalHome = process.env.CODEINFO_COPILOT_HOME;
  const tempHome = await withTempCopilotHome(
    ['model = "copilot-gpt-5"', 'reasoning_effort = "high"', ''].join('\n'),
  );
  process.env.CODEINFO_COPILOT_HOME = tempHome.copilotHome;
  const harness = createMockCopilotSdkHarness({
    name: 'mcp-copilot-normalized-default',
    models: [
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 Mini',
      } as ModelInfo,
    ],
  });

  try {
    const result = await runCodebaseQuestion(
      { question: 'copilot normalized default?', provider: 'copilot' },
      {
        chatFactory: (provider) => {
          assert.equal(provider, 'copilot');
          return new ChatInterfaceCopilot(harness.createLifecycle());
        },
        copilotReadinessResolver: async () => ({
          available: true,
          toolsAvailable: true,
          blockingStage: 'ready',
          models: ['gpt-5-mini'],
          modelsRaw: [
            {
              id: 'gpt-5-mini',
              name: 'GPT-5 Mini',
            } as ModelInfo,
          ],
          authSource: 'env-token',
        }),
      },
    );

    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.modelId, 'gpt-5-mini');
    assert.equal(
      harness.getState().lastCreateSessionConfig?.model,
      'gpt-5-mini',
    );
    assert.equal(
      harness.getState().lastCreateSessionConfig?.reasoningEffort,
      undefined,
    );
  } finally {
    if (originalHome === undefined) delete process.env.CODEINFO_COPILOT_HOME;
    else process.env.CODEINFO_COPILOT_HOME = originalHome;
    await tempHome.cleanup();
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
  const originalCodeHome = process.env.CODEX_HOME;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  setToolDeps({
    codexFactory: () => new MockCodexNoAnswer(),
    clientFactory: makeLmStudioClientFactory(),
  });
  resetStore();
  const tempHome = await withTempCodexHome({
    chatToml: 'web_search_request = false\n',
  });
  process.env.CODEX_HOME = tempHome.codexHome;

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

    assert.ok(response.result);
    const payload = JSON.parse(response.result.content[0].text);
    assert.deepEqual(
      payload.segments.map((s: { type: string }) => s.type),
      ['answer'],
    );
    assert.equal(payload.segments[0].text, '');
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    await tempHome.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test('vector summary match uses the lowest distance', () => {
  const responder = new McpResponder();
  responder.handle({
    type: 'tool-result',
    callId: 'tool-1',
    result: {
      results: [
        {
          repo: 'repo',
          relPath: 'src/index.ts',
          hostPath: '/host/repo/src/index.ts',
          score: 0.33,
          chunk: 'line1',
          chunkId: 'c1',
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
        },
        {
          repo: 'repo',
          relPath: 'src/index.ts',
          hostPath: '/host/repo/src/index.ts',
          score: 0.12,
          chunk: 'line2',
          chunkId: 'c2',
          modelId: 'embed-1',
        },
      ],
      files: [],
      modelId: 'embed-1',
    },
  });

  const summaries = responder.getVectorSummaries();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].files[0].match, 0.12);
  assert.equal(summaries[0].files[0].modelId, 'text-embedding-3-small');
  assert.equal(summaries[0].files[0].embeddingProvider, 'openai');
  assert.equal(summaries[0].files[0].embeddingModel, 'text-embedding-3-small');
});

test('codebase_question marker emits the shared warning_count and warnings fields while matching the REST defaults vocabulary', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalCodeHome = process.env.CODEX_HOME;
  const originalChatDefaultProvider =
    process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
  const originalChatDefaultModel = process.env.CODEINFO_CHAT_DEFAULT_MODEL;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  delete process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
  delete process.env.CODEINFO_CHAT_DEFAULT_MODEL;
  resetStore();
  const tempHome = await withTempCodexHome({
    chatToml: [
      'sandbox_mode = "danger-full-access"',
      'approval_policy = "on-failure"',
      'model_reasoning_effort = "high"',
      'web_search = "cached"',
      '',
    ].join('\n'),
  });
  process.env.CODEX_HOME = tempHome.codexHome;
  const mockCodex = new MockCodex('thread-parity');
  setToolDeps({
    codexFactory: () => mockCodex,
    clientFactory: makeLmStudioClientFactory(),
  });

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  try {
    const result = await postJson(port, {
      jsonrpc: '2.0',
      id: 120,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'Parity?' },
      },
    });
    assert.ok(result.result);
    assert.equal(result.result.content[0].type, 'text');
    const markerLogs = query({
      source: ['server'],
      text: 'DEV_0000040_T08_MCP_DEFAULTS_APPLIED',
    });
    const latest = markerLogs.at(-1);
    const context = latest?.context as
      | {
          defaults?: { webSearchEnabled?: boolean };
          warningCount?: number;
        }
      | undefined;
    assert.ok(context?.defaults);
    assert.equal(context.defaults?.webSearchEnabled, true);

    const story47MarkerLogs = query({
      source: ['server'],
      text: 'DEV_0000047_T01_CODEX_DEFAULTS_APPLIED',
    });
    const latestStory47Marker = story47MarkerLogs.at(-1);
    const story47Context = latestStory47Marker?.context as
      | {
          model_source?: string;
          codex_model_source?: string;
          warning_count?: number;
          warnings?: string[];
        }
      | undefined;
    assert.ok(story47Context);
    assert.equal(story47Context?.model_source, 'fallback');
    assert.equal(story47Context?.codex_model_source, 'hardcoded');
    assert.equal(story47Context?.warning_count, context.warningCount);
    assert.deepEqual(story47Context?.warnings, [
      'codex/chat/config.toml uses legacy approval_policy "on-failure"; normalized to "on-request".',
      'codex/chat/config.toml uses legacy web_search; normalized to web_search_mode.',
    ]);
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    if (originalChatDefaultProvider === undefined) {
      delete process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    } else {
      process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = originalChatDefaultProvider;
    }
    if (originalChatDefaultModel === undefined) {
      delete process.env.CODEINFO_CHAT_DEFAULT_MODEL;
    } else {
      process.env.CODEINFO_CHAT_DEFAULT_MODEL = originalChatDefaultModel;
    }
    await tempHome.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test('codebase_question keeps an explicit request model override over the chat-config default', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalCodeHome = process.env.CODEX_HOME;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  resetStore();
  const tempHome = await withTempCodexHome({
    chatToml: 'model = "config-model"\n',
  });
  process.env.CODEX_HOME = tempHome.codexHome;
  const mockCodex = new MockCodex('thread-override');
  setToolDeps({
    codexFactory: () => mockCodex,
    clientFactory: makeLmStudioClientFactory(),
  });

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  try {
    const result = await postJson(port, {
      jsonrpc: '2.0',
      id: 130,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'Override please',
          model: 'request-model',
        },
      },
    });

    assert.ok(result.result);
    const payload = JSON.parse(result.result.content[0].text);
    assert.equal(payload.modelId, 'request-model');
    assert.equal(
      (mockCodex.lastStartOptions as { model?: string }).model,
      'request-model',
    );
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    await tempHome.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test('codebase_question keeps inherited base runtime settings in the resolved Codex runtime config', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalCodeHome = process.env.CODEX_HOME;
  const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  resetStore();
  const capturingChat = new CapturingChat();
  const tempHome = await withTempCodexHome({
    baseToml: [
      'personality = "base-personality"',
      'model_provider = "base-provider"',
      '[tools]',
      'view_image = true',
      '[mcp_servers.context7]',
      'command = "npx"',
      '[model_providers.base-provider]',
      'name = "Base Provider"',
      'base_url = "http://localhost:4100/v1"',
      '',
    ].join('\n'),
    chatToml: 'model = "chat-model"\n',
  });
  process.env.CODEX_HOME = tempHome.codexHome;
  process.env.CODEINFO_CODEX_HOME = tempHome.codexHome;
  setToolDeps({
    clientFactory: makeLmStudioClientFactory(),
    chatFactory: () => capturingChat,
  });

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const response = await postJson(port, {
      jsonrpc: '2.0',
      id: 131,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'Keep inherited runtime settings' },
      },
    });

    assert.ok(response.result);
    const runtimeConfig = capturingChat.lastFlags?.runtimeConfig as
      | Record<string, unknown>
      | undefined;
    assert.ok(runtimeConfig);
    assert.equal(runtimeConfig?.model, 'chat-model');
    assert.equal(runtimeConfig?.personality, 'base-personality');
    assert.equal(runtimeConfig?.model_provider, 'base-provider');
    assert.deepEqual(runtimeConfig?.tools, {
      view_image: true,
    });
    assert.deepEqual(runtimeConfig?.mcp_servers, {
      context7: {
        command: 'npx',
      },
    });
    assert.deepEqual(runtimeConfig?.model_providers, {
      'base-provider': {
        name: 'Base Provider',
        base_url: 'http://localhost:4100/v1',
      },
    });
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    if (originalCodeinfoHome === undefined)
      delete process.env.CODEINFO_CODEX_HOME;
    else process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
    await tempHome.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test('codebase_question receives the same inherited overlaid Context7 definition', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalCodeHome = process.env.CODEX_HOME;
  const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
  const originalContext7ApiKey = process.env.CODEINFO_CONTEXT7_API_KEY;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-real';
  resetStore();
  const capturingChat = new CapturingChat();
  const tempHome = await withTempCodexHome({
    baseToml: [
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp", "--api-key", "REPLACE_WITH_CONTEXT7_API_KEY"]',
      '',
    ].join('\n'),
    chatToml: 'model = "chat-model"\n',
  });
  process.env.CODEX_HOME = tempHome.codexHome;
  process.env.CODEINFO_CODEX_HOME = tempHome.codexHome;
  setToolDeps({
    clientFactory: makeLmStudioClientFactory(),
    chatFactory: () => capturingChat,
  });

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const response = await postJson(port, {
      jsonrpc: '2.0',
      id: 132,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'Overlay the inherited Context7 key' },
      },
    });

    assert.ok(response.result);
    const runtimeConfig = capturingChat.lastFlags?.runtimeConfig as
      | Record<string, unknown>
      | undefined;
    assert.deepEqual(runtimeConfig?.mcp_servers, {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real'],
      },
    });
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    if (originalCodeinfoHome === undefined)
      delete process.env.CODEINFO_CODEX_HOME;
    else process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
    if (originalContext7ApiKey === undefined)
      delete process.env.CODEINFO_CONTEXT7_API_KEY;
    else process.env.CODEINFO_CONTEXT7_API_KEY = originalContext7ApiKey;
    await tempHome.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test('codebase_question overlays CODEINFO_CONTEXT7_API_KEY onto inherited no-key Context7 args', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalCodeHome = process.env.CODEX_HOME;
  const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
  const originalContext7ApiKey = process.env.CODEINFO_CONTEXT7_API_KEY;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  process.env.CODEINFO_CONTEXT7_API_KEY = 'ctx7sk-real';
  resetStore();
  const capturingChat = new CapturingChat();
  const tempHome = await withTempCodexHome({
    baseToml: [
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]',
      '',
    ].join('\n'),
    chatToml: 'model = "chat-model"\n',
  });
  process.env.CODEX_HOME = tempHome.codexHome;
  process.env.CODEINFO_CODEX_HOME = tempHome.codexHome;
  setToolDeps({
    clientFactory: makeLmStudioClientFactory(),
    chatFactory: () => capturingChat,
  });

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const response = await postJson(port, {
      jsonrpc: '2.0',
      id: 133,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'Overlay the inherited no-key Context7 args' },
      },
    });

    assert.ok(response.result);
    const runtimeConfig = capturingChat.lastFlags?.runtimeConfig as
      | Record<string, unknown>
      | undefined;
    assert.deepEqual(runtimeConfig?.mcp_servers, {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7sk-real'],
      },
    });
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    if (originalCodeHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodeHome;
    if (originalCodeinfoHome === undefined)
      delete process.env.CODEINFO_CODEX_HOME;
    else process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
    if (originalContext7ApiKey === undefined)
      delete process.env.CODEINFO_CONTEXT7_API_KEY;
    else process.env.CODEINFO_CONTEXT7_API_KEY = originalContext7ApiKey;
    await tempHome.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});
