import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach, mock } from 'node:test';

import type { LMStudioClient } from '@lmstudio/sdk';
import express from 'express';
import request from 'supertest';

import type { CodexCapabilityResolution } from '../../codex/capabilityResolver.js';
import { STORY_47_TASK_1_LOG_MARKER } from '../../config/chatDefaults.js';
import { resolveCodeinfoMcpEndpointContract } from '../../config/mcpEndpoints.js';
import { baseLogger } from '../../logger.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { TASK5_LOG_MARKER } from '../../providers/copilotReadiness.js';
import { resetMcpStatusCache } from '../../providers/mcpStatus.js';
import { createChatProvidersRouter } from '../../routes/chatProviders.js';
import {
  createMockCopilotSdkHarness,
  type MockCopilotSdkHarness,
} from '../support/mockCopilotSdk.js';

type EnvSnapshot = Map<string, string | undefined>;

const env = {
  snapshot: new Map() as EnvSnapshot,
  set(key: string, value: string | undefined) {
    if (!this.snapshot.has(key)) {
      this.snapshot.set(key, process.env[key]);
    }
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  },
  restore() {
    for (const [key, value] of this.snapshot.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    this.snapshot.clear();
  },
};

const defaultDetection = {
  available: false,
  authPresent: false,
  configPresent: false,
  reason: 'not detected',
};
const tempDirs: string[] = [];

function createClient(
  models: {
    modelKey: string;
    displayName: string;
    type?: string;
  }[],
): LMStudioClient {
  return {
    system: {
      listDownloadedModels: async () => models,
    },
  } as LMStudioClient;
}

async function startServer(params: {
  mcpAvailable: boolean;
  clientFactory: () => LMStudioClient;
  codexCapabilityResolver?: (options: {
    consumer: 'chat_models' | 'chat_validation';
  }) => Promise<CodexCapabilityResolution>;
  copilotHarness?: MockCopilotSdkHarness;
}) {
  const app = express();
  app.use(express.json());

  app.post('/mcp', (_req, res) => {
    if (params.mcpAvailable) {
      res.json({ result: { ok: true } });
    } else {
      res.status(200).json({ error: { message: 'unavailable' } });
    }
  });

  app.use(
    '/chat',
    createChatProvidersRouter({
      clientFactory: params.clientFactory,
      codexCapabilityResolver: params.codexCapabilityResolver,
      copilotRuntimeFactory: params.copilotHarness
        ? () => params.copilotHarness!.createLifecycle()
        : undefined,
    }),
  );

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  env.set('CODEINFO_SERVER_PORT', String(address.port));
  return {
    httpServer,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: { httpServer: http.Server }) {
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => resolve()),
  );
}

async function setCodexHome(chatToml?: string) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-chat-providers-codex-'),
  );
  tempDirs.push(root);
  const codexHome = path.join(root, 'codex');
  if (chatToml !== undefined) {
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(
      path.join(codexHome, 'chat', 'config.toml'),
      chatToml,
      'utf8',
    );
  }
  env.set('CODEX_HOME', codexHome);
}

beforeEach(() => {
  resetMcpStatusCache();
  setCodexDetection(defaultDetection);
});

afterEach(async () => {
  env.restore();
  resetMcpStatusCache();
  setCodexDetection(defaultDetection);
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

test('providers route orders lmstudio first when codex default is unavailable and lmstudio is available', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'gpt-5.3-codex');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'CODE_INFO_LLM_UNAVAILABLE',
  });

  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);

    assert.deepEqual(
      res.body.providers.map((provider: { id: string }) => provider.id),
      ['lmstudio', 'codex', 'copilot'],
    );
    assert.equal(res.body.providers[0].available, true);
    assert.equal(res.body.providers[1].available, false);
    assert.equal(res.body.providers[1].reason, 'CODE_INFO_LLM_UNAVAILABLE');
    assert.equal(res.body.providers[2].available, false);
    assert.equal(
      res.body.providers[2].reason,
      'copilot authentication required',
    );
    assert.ok(res.body.codexDefaults);
    assert.ok(Array.isArray(res.body.codexWarnings));
  } finally {
    await stopServer(server);
  }
});

test('providers route keeps copilot visible in the shared provider order when unavailable', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'gpt-5.3-codex');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);

    assert.deepEqual(
      res.body.providers.map((provider: { id: string }) => provider.id),
      ['codex', 'copilot', 'lmstudio'],
    );
    assert.equal(res.body.providers[1].available, false);
    assert.equal(res.body.providers[1].toolsAvailable, false);
    assert.equal(
      res.body.providers[1].reason,
      'copilot authentication required',
    );
  } finally {
    await stopServer(server);
  }
});

test('providers route surfaces unauthenticated Copilot with a stable blocking reason', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'copilot-gpt-5');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const copilotHarness = createMockCopilotSdkHarness({
    name: 'unauthenticated',
    authStatus: {
      isAuthenticated: false,
      authType: 'gh-cli',
      statusMessage: 'login required',
    },
    models: [{ id: 'copilot-gpt-5', name: 'Copilot GPT-5' } as never],
  });
  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
    copilotHarness,
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);

    assert.equal(res.body.providers[0].id, 'codex');
    assert.equal(res.body.providers[1].id, 'copilot');
    assert.equal(res.body.providers[1].available, false);
    assert.equal(res.body.providers[1].toolsAvailable, false);
    assert.equal(
      res.body.providers[1].reason,
      'copilot authentication required',
    );
  } finally {
    await stopServer(server);
  }
});

test('providers route treats Copilot env-token authentication as ready without device auth', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'copilot-gpt-5');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  env.set('COPILOT_GITHUB_TOKEN', 'ghu_test_token_value');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const copilotHarness = createMockCopilotSdkHarness({
    name: 'env-token-auth',
    authStatus: {
      isAuthenticated: false,
      authType: 'gh-cli',
      statusMessage: 'login required',
    },
    models: [{ id: 'copilot-gpt-5', name: 'Copilot GPT-5' } as never],
  });
  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
    copilotHarness,
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);

    assert.equal(res.body.providers[0].id, 'copilot');
    assert.equal(res.body.providers[0].available, true);
    assert.equal(res.body.providers[0].toolsAvailable, true);
    assert.equal(res.body.providers[0].reason, undefined);
  } finally {
    await stopServer(server);
  }
});

test('providers route treats Copilot gh fallback authentication as ready', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'copilot-gpt-5');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const copilotHarness = createMockCopilotSdkHarness({
    name: 'gh-cli-auth',
    authStatus: {
      isAuthenticated: true,
      authType: 'gh-cli',
      statusMessage: 'authenticated via gh',
    },
    models: [{ id: 'copilot-gpt-5', name: 'Copilot GPT-5' } as never],
  });
  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
    copilotHarness,
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);

    assert.equal(res.body.providers[0].id, 'copilot');
    assert.equal(res.body.providers[0].available, true);
    assert.equal(res.body.providers[0].toolsAvailable, true);
    assert.equal(res.body.providers[0].reason, undefined);
  } finally {
    await stopServer(server);
  }
});

test('providers route surfaces the first startup-stage Copilot failure before later readiness checks', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'copilot-gpt-5');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  env.set('COPILOT_GITHUB_TOKEN', 'ghu_secret_value_that_must_not_log');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const copilotHarness = createMockCopilotSdkHarness({
    name: 'startup-failure',
    startError: new Error('ghu_secret_value_that_must_not_log startup failed'),
    authStatus: {
      isAuthenticated: true,
      authType: 'gh-cli',
    },
    models: [],
  });
  const infoEntries: Array<Record<string, unknown>> = [];
  const infoMock = mock.method(
    baseLogger,
    'info',
    (entry: unknown, message: unknown) => {
      if (message === TASK5_LOG_MARKER) {
        infoEntries.push((entry ?? {}) as Record<string, unknown>);
      }
    },
  );
  const server = await startServer({
    mcpAvailable: false,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
    copilotHarness,
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);

    assert.equal(res.body.providers[0].id, 'codex');
    assert.equal(res.body.providers[1].id, 'copilot');
    assert.equal(res.body.providers[1].available, false);
    assert.equal(
      res.body.providers[1].reason,
      'copilot connectivity unavailable',
    );

    const readinessLog = infoEntries.at(-1);
    assert.ok(readinessLog);
    assert.equal(readinessLog?.blockingStage, 'connectivity');
    assert.equal(
      readinessLog?.surfacedReason,
      'copilot connectivity unavailable',
    );
    assert.equal(
      JSON.stringify(readinessLog).includes(
        'ghu_secret_value_that_must_not_log',
      ),
      false,
    );
  } finally {
    infoMock.mock.restore();
    await stopServer(server);
  }
});

test('providers route logs model-stage precedence ahead of tool-surface failures without leaking token-like data', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'copilot-gpt-5');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  env.set('COPILOT_GITHUB_TOKEN', 'ghu_secret_value_that_must_not_log');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const copilotHarness = createMockCopilotSdkHarness({
    name: 'model-stage-blocked',
    authStatus: {
      isAuthenticated: false,
      authType: 'gh-cli',
      statusMessage: 'login required',
    },
    models: [],
  });
  const infoEntries: Array<Record<string, unknown>> = [];
  const infoMock = mock.method(
    baseLogger,
    'info',
    (entry: unknown, message: unknown) => {
      if (message === TASK5_LOG_MARKER) {
        infoEntries.push((entry ?? {}) as Record<string, unknown>);
      }
    },
  );
  const server = await startServer({
    mcpAvailable: false,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
    copilotHarness,
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);

    assert.equal(res.body.providers[0].id, 'codex');
    assert.equal(res.body.providers[1].id, 'copilot');
    assert.equal(res.body.providers[1].available, false);
    assert.equal(res.body.providers[1].toolsAvailable, false);
    assert.equal(res.body.providers[1].reason, 'copilot models unavailable');

    const readinessLog = infoEntries.at(-1);
    assert.ok(readinessLog);
    assert.equal(readinessLog?.blockingStage, 'models');
    assert.equal(readinessLog?.surfacedReason, 'copilot models unavailable');
    assert.equal(JSON.stringify(readinessLog).includes('ghu_secret'), false);
  } finally {
    infoMock.mock.restore();
    await stopServer(server);
  }
});

test('providers marker normalizes model_source and retains raw codex_model_source', async () => {
  await setCodexHome();
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', undefined);
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', undefined);
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const markerPayloads: Array<Record<string, unknown>> = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    if (args[0] === STORY_47_TASK_1_LOG_MARKER && args[1]) {
      markerPayloads.push(args[1] as Record<string, unknown>);
    }
  };

  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    await request(server.httpServer).get('/chat/providers').expect(200);

    const marker = markerPayloads.at(-1);
    assert.ok(marker);
    assert.equal(marker.surface, '/chat/providers');
    assert.equal(marker.model_source, 'fallback');
    assert.equal(marker.codex_model_source, 'hardcoded');
  } finally {
    console.info = originalInfo;
    await stopServer(server);
  }
});

test('providers route keeps browser navigation urls separate from MCP control-channel urls', async () => {
  await setCodexHome('model = "config-model"\n');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
  });

  try {
    const endpoints = resolveCodeinfoMcpEndpointContract();
    assert.notEqual(server.baseUrl, endpoints.classicMcpUrl);

    await request(server.httpServer).get('/chat/providers').expect(200);
  } finally {
    await stopServer(server);
  }
});

test('providers route keeps codex first when lmstudio has no selectable model', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'lmstudio');
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'model-1');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () => createClient([]),
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);

    assert.deepEqual(
      res.body.providers.map((provider: { id: string }) => provider.id),
      ['codex', 'copilot', 'lmstudio'],
    );
    assert.equal(res.body.providers[0].available, true);
    assert.equal(res.body.providers[1].available, false);
    assert.equal(
      res.body.providers[1].reason,
      'copilot authentication required',
    );
    assert.equal(res.body.providers[2].available, false);
    assert.equal(res.body.providers[2].reason, 'lmstudio unavailable');
    assert.ok(res.body.codexDefaults);
    assert.ok(Array.isArray(res.body.codexWarnings));
  } finally {
    await stopServer(server);
  }
});

test('providers route exposes the chat-config-aware Codex default and falls back cleanly when chat config is missing', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'env-model');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });

  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);

  try {
    const configured = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);
    assert.equal(configured.body.providers[0].id, 'codex');

    await setCodexHome();

    const fallback = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);
    assert.equal(fallback.body.providers[0].id, 'codex');
    assert.ok(Array.isArray(fallback.body.codexWarnings));
  } finally {
    await stopServer(server);
  }
});

test('providers route exposes shared resolver-backed codex defaults and warnings parity', async () => {
  const fixture: CodexCapabilityResolution = {
    defaults: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      modelReasoningEffort: 'medium',
      networkAccessEnabled: false,
      webSearchEnabled: false,
    },
    models: [
      {
        model: 'fixture-model',
        supportedReasoningEfforts: ['medium'],
        defaultReasoningEffort: 'medium',
      },
    ],
    byModel: new Map([
      [
        'fixture-model',
        {
          model: 'fixture-model',
          supportedReasoningEfforts: ['medium'],
          defaultReasoningEffort: 'medium',
        },
      ],
    ]),
    warnings: ['fixture warning'],
    fallbackUsed: false,
  };
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  const server = await startServer({
    mcpAvailable: true,
    clientFactory: () =>
      createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
    codexCapabilityResolver: async () => fixture,
  });
  env.set('MCP_URL', `${server.baseUrl}/mcp`);
  try {
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);
    assert.deepEqual(res.body.codexDefaults, fixture.defaults);
    assert.ok((res.body.codexWarnings as string[]).includes('fixture warning'));
  } finally {
    await stopServer(server);
  }
});
