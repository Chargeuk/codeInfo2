import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatInterface } from '../../../chat/interfaces/ChatInterface.js';
import { McpResponder } from '../../../chat/responders/McpResponder.js';
import { resolveChatDefaults } from '../../../config/chatDefaults.js';
import { query, resetStore } from '../../../logStore.js';
import { handleRpc } from '../../../mcp2/router.js';
import { resetToolDeps, setToolDeps } from '../../../mcp2/tools.js';

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
      'sandbox_mode = "workspace-write"',
      'approval_policy = "on-request"',
      'model_reasoning_effort = "minimal"',
      'web_search = "disabled"',
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

test('codebase_question parity fixture aligns MCP defaults with REST resolver expectations', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalCodeHome = process.env.CODEX_HOME;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
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
      | { defaults?: { webSearchEnabled?: boolean } }
      | undefined;
    assert.ok(context?.defaults);
    assert.equal(context.defaults?.webSearchEnabled, true);
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
