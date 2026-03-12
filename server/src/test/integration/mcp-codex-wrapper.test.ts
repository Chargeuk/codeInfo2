import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import type {
  CodexOptions,
  ThreadEvent,
  ThreadOptions as CodexThreadOptions,
  TurnOptions as CodexTurnOptions,
} from '@openai/codex-sdk';

import { resolveCodexCapabilities } from '../../codex/capabilityResolver.js';
import { resolveChatDefaults } from '../../config/chatDefaults.js';
import { RuntimeConfigResolutionError } from '../../config/runtimeConfig.js';
import { handleRpc } from '../../mcp2/router.js';
import { runCodebaseQuestion } from '../../mcp2/tools/codebaseQuestion.js';
import { resetToolDeps, setToolDeps } from '../../mcp2/tools.js';
import {
  getCodexDetection,
  setCodexDetection,
} from '../../providers/codexRegistry.js';

class MockThread {
  id: string;
  private readonly events: ThreadEvent[];

  constructor(id: string, events: ThreadEvent[]) {
    this.id = id;
    this.events = events;
  }

  async runStreamed(
    input: string,
    opts?: CodexTurnOptions,
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    void input;
    void opts;
    const events = this.events;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      for (const ev of events) {
        yield ev;
      }
    }
    return { events: generator() };
  }
}

class MockCodex {
  lastStartOptions: CodexThreadOptions | undefined;

  startThread(opts?: CodexThreadOptions) {
    this.lastStartOptions = opts;
    const events: ThreadEvent[] = [
      {
        type: 'item.updated',
        item: { type: 'reasoning', text: 'Thinking about the repo' },
      } as unknown as ThreadEvent,
      {
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          id: 'tool-1',
          server: 'codeinfo_host',
          tool: 'VectorSearch',
          arguments: { query: 'hello', limit: 3 },
          status: 'completed',
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
      } as unknown as ThreadEvent,
      {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Here you go' },
      } as unknown as ThreadEvent,
      {
        type: 'turn.completed',
      } as unknown as ThreadEvent,
    ];

    return new MockThread('thread-wrapper', events);
  }

  resumeThread(threadId: string, opts?: CodexThreadOptions) {
    void threadId;
    void opts;
    return this.startThread();
  }
}

type JsonRpcErrorResponse = {
  jsonrpc: string;
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

const makeLmStudioClientFactory = () => () =>
  ({
    system: {
      listDownloadedModels: async () => [],
    },
  }) as unknown as import('@lmstudio/sdk').LMStudioClient;

test('MCP responder returns answer-only segments', async () => {
  const prev = getCodexDetection();
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  try {
    const result = await runCodebaseQuestion(
      { question: 'What is up?' },
      {
        codexFactory: () => new MockCodex(),
        clientFactory: makeLmStudioClientFactory(),
      },
    );

    const payload = JSON.parse(result.content[0].text);
    const defaults = resolveChatDefaults({ requestProvider: 'codex' });
    assert.ok(typeof payload.conversationId === 'string');
    assert.ok(payload.conversationId.startsWith('codex-thread-'));
    assert.equal(payload.modelId, defaults.model);
    assert.deepEqual(
      payload.segments.map((s: { type: string }) => s.type),
      ['answer'],
    );
    assert.equal(payload.segments[0].text, 'Here you go');
  } finally {
    setCodexDetection(prev);
  }
});

test('MCP responder only returns the final answer segment', async () => {
  const prev = getCodexDetection();
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  try {
    const result = await runCodebaseQuestion(
      { question: 'Second run' },
      {
        codexFactory: () => new MockCodex(),
        clientFactory: makeLmStudioClientFactory(),
      },
    );

    const payload = JSON.parse(result.content[0].text);
    const segments = payload.segments as Array<{
      type: string;
      [key: string]: unknown;
    }>;
    assert.deepEqual(
      segments.map((s) => s.type),
      ['answer'],
    );
    assert.deepEqual(Object.keys(segments[0]).sort(), ['text', 'type']);
  } finally {
    setCodexDetection(prev);
  }
});

test('MCP codebase_question uses shared resolver defaults for thread options', async () => {
  const prev = getCodexDetection();
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const mockCodex = new MockCodex();

  try {
    await runCodebaseQuestion(
      { question: 'Use shared defaults please' },
      {
        codexFactory: () => mockCodex,
        clientFactory: makeLmStudioClientFactory(),
      },
    );
    const capabilities = await resolveCodexCapabilities({
      consumer: 'chat_validation',
      codexHome: process.env.CODEX_HOME,
    });
    assert.equal(
      mockCodex.lastStartOptions?.sandboxMode,
      capabilities.defaults.sandboxMode,
    );
    assert.equal(
      mockCodex.lastStartOptions?.networkAccessEnabled,
      capabilities.defaults.networkAccessEnabled,
    );
    assert.equal(
      mockCodex.lastStartOptions?.webSearchEnabled,
      capabilities.defaults.webSearchEnabled,
    );
    assert.equal(
      mockCodex.lastStartOptions?.approvalPolicy,
      capabilities.defaults.approvalPolicy,
    );
    assert.equal(
      mockCodex.lastStartOptions?.modelReasoningEffort,
      capabilities.defaults.modelReasoningEffort,
    );
  } finally {
    setCodexDetection(prev);
  }
});

test('MCP codebase_question passes resolved chat runtime config to Codex', async () => {
  const prev = getCodexDetection();
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const mockCodex = new MockCodex();
  let capturedOptions: CodexOptions | undefined;
  const runtimeConfig = {
    model: 'openai/gpt-oss-20b',
    model_provider: 'vllm',
    model_providers: {
      vllm: {
        name: 'vLLM Local',
        base_url: 'http://localhost:8000/v1',
        wire_api: 'responses',
      },
    },
  };

  try {
    await runCodebaseQuestion(
      { question: 'Use runtime config please' },
      {
        codexFactory: (options?: CodexOptions) => {
          capturedOptions = options;
          return mockCodex;
        },
        clientFactory: makeLmStudioClientFactory(),
        chatRuntimeConfigResolver: async () => ({
          config: runtimeConfig,
          warnings: [],
        }),
      },
    );

    assert.deepEqual(capturedOptions?.config, runtimeConfig);
  } finally {
    setCodexDetection(prev);
  }
});

async function postJson<T>(port: number, body: unknown): Promise<T> {
  const payload = JSON.stringify(body);
  return await new Promise<T>((resolve, reject) => {
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
          resolve(JSON.parse(responseBody) as T);
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

test('MCP JSON-RPC error shape remains stable for invalid params', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const response = await postJson<JsonRpcErrorResponse>(port, {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: '' },
      },
    });

    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 99);
    assert.equal(response.error.code, -32602);
    assert.equal(response.error.message, 'Invalid params');
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test('MCP JSON-RPC returns a typed tool error when chat runtime config resolution fails', async () => {
  const prev = getCodexDetection();
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  setToolDeps({
    clientFactory: makeLmStudioClientFactory(),
    chatRuntimeConfigResolver: async () => {
      throw new RuntimeConfigResolutionError({
        code: 'RUNTIME_CONFIG_INVALID',
        configPath: '/tmp/codeinfo-chat-config.toml',
        surface: 'chat',
        message: 'chat runtime config is invalid',
      });
    },
  });

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const response = await postJson<JsonRpcErrorResponse>(port, {
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'Hello' },
      },
    });

    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 100);
    assert.equal(response.error.code, -32002);
    assert.equal(response.error.message, 'CODE_INFO_CHAT_CONFIG_INVALID');
    assert.deepEqual(response.error.data, {
      code: 'RUNTIME_CONFIG_INVALID',
      surface: 'chat',
      configPath: '/tmp/codeinfo-chat-config.toml',
    });
  } finally {
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    setCodexDetection(prev);
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});
