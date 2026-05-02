import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveCodexCapabilities } from '../../../codex/capabilityResolver.js';
import { query, resetStore } from '../../../logStore.js';
import { handleRpc } from '../../../mcp2/router.js';
import { runCodebaseQuestion } from '../../../mcp2/tools/codebaseQuestion.js';

type ThreadEvent = {
  type: string;
  item?: Record<string, unknown>;
  thread_id?: string;
};

class MockThread {
  constructor(private readonly id: string) {}

  async runStreamed() {
    const threadId = this.id;
    async function* events(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: threadId };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Fallback answer' },
      };
      yield { type: 'turn.completed', thread_id: threadId };
    }

    return { events: events() };
  }
}

class MockCodex {
  startThread() {
    return new MockThread('thread-fallback');
  }

  resumeThread(threadId: string) {
    return new MockThread(threadId);
  }
}

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function withTempCopilotHome(chatToml: string): Promise<{
  copilotHome: string;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-task4-copilot-unavailable-'),
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

test('codebase_question fails on the selected explicit Codex provider when Codex is unavailable', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalLmBaseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'false';
  process.env.CODEINFO_LMSTUDIO_BASE_URL = 'invalid-url';
  resetStore();

  const server = http.createServer(handleRpc);
  server.listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const payload = {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: { question: 'Hello?', provider: 'codex' },
      },
    };

    const body = await postJson(port, payload);
    assert.equal(body.error.code, -32001);
    assert.equal(body.error.message, 'CODE_INFO_LLM_UNAVAILABLE');
    const markerLogs = query({
      source: ['server'],
      text: 'DEV_0000040_T08_MCP_DEFAULTS_APPLIED',
    });
    const capabilities = await resolveCodexCapabilities({
      consumer: 'chat_validation',
      codexHome: process.env.CODEX_HOME,
    });
    const context = markerLogs.at(-1)?.context as
      | {
          defaults?: {
            sandboxMode?: string;
            approvalPolicy?: string;
            modelReasoningEffort?: string;
            networkAccessEnabled?: boolean;
            webSearchEnabled?: boolean;
          };
        }
      | undefined;
    assert.deepEqual(context?.defaults, capabilities.defaults);
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    if (originalLmBaseUrl === undefined) {
      delete process.env.CODEINFO_LMSTUDIO_BASE_URL;
    } else {
      process.env.CODEINFO_LMSTUDIO_BASE_URL = originalLmBaseUrl;
    }
    server.close();
  }
});

test('codebase_question fails on the selected explicit provider before unrelated LM Studio fallback probing can run', async () => {
  const originalHome = process.env.CODEINFO_COPILOT_HOME;
  const originalLmBaseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL;
  let lmstudioProbeCount = 0;
  const tempHome = await withTempCopilotHome(
    ['model = "copilot-default-model"', 'tool_access = "off"', ''].join('\n'),
  );
  process.env.CODEINFO_COPILOT_HOME = tempHome.copilotHome;
  process.env.CODEINFO_LMSTUDIO_BASE_URL = 'http://127.0.0.1:1234';

  try {
    await assert.rejects(
      () =>
        runCodebaseQuestion(
          { question: 'copilot unavailable?', provider: 'copilot' },
          {
            clientFactory: () => {
              lmstudioProbeCount += 1;
              throw new Error(
                'lmstudio fallback probe should not run for explicit copilot requests',
              );
            },
            copilotReadinessResolver: async () => ({
              available: false,
              toolsAvailable: false,
              reason: 'copilot connectivity unavailable',
              blockingStage: 'connectivity',
              models: [],
              modelsRaw: [],
              authSource: 'unauthenticated',
            }),
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'ProviderUnavailableError');
        assert.equal(error.message, 'CODE_INFO_LLM_UNAVAILABLE');
        assert.equal(lmstudioProbeCount, 0);
        return true;
      },
    );
  } finally {
    if (originalHome === undefined) delete process.env.CODEINFO_COPILOT_HOME;
    else process.env.CODEINFO_COPILOT_HOME = originalHome;
    if (originalLmBaseUrl === undefined) {
      delete process.env.CODEINFO_LMSTUDIO_BASE_URL;
    } else {
      process.env.CODEINFO_LMSTUDIO_BASE_URL = originalLmBaseUrl;
    }
    await tempHome.cleanup();
  }
});

test('codebase_question still falls back when provider resolution is omitted and the preferred provider is unavailable', async () => {
  const originalHome = process.env.CODEINFO_COPILOT_HOME;
  const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
  const originalForceCodex = process.env.MCP_FORCE_CODEX_AVAILABLE;
  const originalLmBaseUrl = process.env.CODEINFO_LMSTUDIO_BASE_URL;
  const tempHome = await withTempCopilotHome(
    ['model = "copilot-default-model"', 'tool_access = "off"', ''].join('\n'),
  );
  process.env.CODEINFO_COPILOT_HOME = tempHome.copilotHome;
  process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = 'copilot';
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';
  process.env.CODEINFO_LMSTUDIO_BASE_URL = 'invalid-url';

  try {
    const capabilities = await resolveCodexCapabilities({
      consumer: 'chat_validation',
      codexHome: process.env.CODEX_HOME,
    });
    const result = await runCodebaseQuestion(
      { question: 'Fallback please' },
      {
        clientFactory: () =>
          ({
            system: {
              listDownloadedModels: async () => [],
            },
          }) as never,
        codexFactory: () => new MockCodex(),
        copilotReadinessResolver: async () => ({
          available: false,
          toolsAvailable: false,
          reason: 'copilot connectivity unavailable',
          blockingStage: 'connectivity',
          models: [],
          modelsRaw: [],
          authSource: 'unauthenticated',
        }),
      },
    );
    const payload = JSON.parse(result.content[0].text) as {
      conversationId: string;
      modelId: string;
      segments: Array<{ type: string; text?: string }>;
    };

    assert.equal(payload.conversationId, 'thread-fallback');
    assert.equal(payload.modelId, capabilities.models[0]?.model);
    assert.equal(payload.segments.at(-1)?.type, 'answer');
    assert.equal(payload.segments.at(-1)?.text, 'Fallback answer');
  } finally {
    if (originalHome === undefined) delete process.env.CODEINFO_COPILOT_HOME;
    else process.env.CODEINFO_COPILOT_HOME = originalHome;
    if (originalDefaultProvider === undefined) {
      delete process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    } else {
      process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = originalDefaultProvider;
    }
    if (originalForceCodex === undefined) {
      delete process.env.MCP_FORCE_CODEX_AVAILABLE;
    } else {
      process.env.MCP_FORCE_CODEX_AVAILABLE = originalForceCodex;
    }
    if (originalLmBaseUrl === undefined) {
      delete process.env.CODEINFO_LMSTUDIO_BASE_URL;
    } else {
      process.env.CODEINFO_LMSTUDIO_BASE_URL = originalLmBaseUrl;
    }
    await tempHome.cleanup();
  }
});
