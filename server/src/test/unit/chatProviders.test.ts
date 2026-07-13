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
import {
  __resetProviderBootstrapStatusForTests,
  __setProviderBootstrapStatusForTests,
} from '../../config/runtimeConfig.js';
import { baseLogger } from '../../logger.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { TASK5_LOG_MARKER } from '../../providers/copilotReadiness.js';
import { resetMcpStatusCache } from '../../providers/mcpStatus.js';
import { createChatProvidersRouter } from '../../routes/chatProviders.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
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
      clearScopedTestEnvValue(key);
    } else {
      setScopedTestEnvValue(key, value);
    }
  },
  restore() {
    for (const [key, value] of this.snapshot.entries()) {
      if (value === undefined) {
        clearScopedTestEnvValue(key);
      } else {
        setScopedTestEnvValue(key, value);
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
const tempExternalServers: Array<{
  stop: () => Promise<void>;
}> = [];
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
  const copilotHarness =
    params.copilotHarness ??
    createMockCopilotSdkHarness({
      name: 'unit-default-copilot-auth-required',
      authStatus: {
        isAuthenticated: false,
        authType: 'user',
        statusMessage: 'login required',
      },
    });
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
      copilotRuntimeFactory: () => copilotHarness.createLifecycle(),
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
  env.set('CODEINFO_CODEX_HOME', codexHome);
}
async function setCopilotHome(chatToml?: string) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-chat-providers-copilot-'),
  );
  tempDirs.push(root);
  const copilotHome = path.join(root, 'copilot');
  if (chatToml !== undefined) {
    await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
    await fs.writeFile(
      path.join(copilotHome, 'chat', 'config.toml'),
      chatToml,
      'utf8',
    );
  }
  env.set('CODEINFO_COPILOT_HOME', copilotHome);
}
beforeEach(() => {
  resetMcpStatusCache();
  setCodexDetection(defaultDetection);
  __resetProviderBootstrapStatusForTests();
  env.set('CODEX_HOME', undefined);
  env.set('CODEINFO_CODEX_HOME', undefined);
  env.set('CODEINFO_COPILOT_HOME', undefined);
  env.set('CODEINFO_LMSTUDIO_HOME', undefined);
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', undefined);
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', undefined);
  env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS', undefined);
  env.set('CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS', undefined);
});
afterEach(async () => {
  env.restore();
  resetMcpStatusCache();
  setCodexDetection(defaultDetection);
  __resetProviderBootstrapStatusForTests();
  while (tempExternalServers.length > 0) {
    await tempExternalServers.pop()!.stop();
  }
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
test('providers route orders lmstudio first when codex default is unavailable and lmstudio is available', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'gpt-5.6-sol');
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
  env.set('CODEINFO_CHAT_DEFAULT_MODEL', 'gpt-5.6-sol');
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
test('providers route keeps degraded LM Studio bootstrap reason authoritative even when models are present', async () => {
  await setCodexHome('model = "config-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'lmstudio');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  __setProviderBootstrapStatusForTests('lmstudio', {
    healthy: false,
    reason: 'lmstudio bootstrap degraded',
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
    assert.equal(res.body.providers[0].id, 'codex');
    assert.equal(res.body.providers[2].id, 'lmstudio');
    assert.equal(res.body.providers[2].available, false);
    assert.equal(res.body.providers[2].toolsAvailable, false);
    assert.equal(res.body.providers[2].reason, 'lmstudio bootstrap degraded');
  } finally {
    await stopServer(server);
  }
});
test('providers route treats Copilot env-token authentication as ready without device auth', async () => {
  await setCodexHome('model = "config-model"\n');
  await setCopilotHome('model = "copilot-gpt-5"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
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
  await setCopilotHome('model = "copilot-gpt-5"\n');
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
test('providers route keeps Codex and Copilot available in endpoint-only mode when native auth is missing', async () => {
  await setCodexHome('model = "endpoint-codex-model"\n');
  await setCopilotHome('model = "endpoint-copilot-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: true,
    cliPath: '/usr/bin/codex',
    reason: 'Missing auth.json in /tmp/codex',
  });
  const codexEndpoint = await startExternalOpenAiCompatServer({
    models: ['endpoint-codex-model'],
  });
  const copilotEndpoint = await startExternalOpenAiCompatServer({
    models: ['endpoint-copilot-model'],
  });
  tempExternalServers.push(codexEndpoint, copilotEndpoint);
  env.set(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    [
      `${codexEndpoint.baseUrl}/v1|responses`,
      `${copilotEndpoint.baseUrl}/v1|completions`,
    ].join(';'),
  );
  const copilotHarness = createMockCopilotSdkHarness({
    name: 'endpoint-only-copilot',
    authStatus: {
      isAuthenticated: false,
      authType: 'user',
      statusMessage: 'login required',
    },
    models: [],
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
    const codexProvider = res.body.providers.find(
      (provider: { id: string }) => provider.id === 'codex',
    );
    const copilotProvider = res.body.providers.find(
      (provider: { id: string }) => provider.id === 'copilot',
    );
    assert.equal(codexProvider?.available, true);
    assert.equal(codexProvider?.toolsAvailable, true);
    assert.equal(codexProvider?.endpointOnly, true);
    assert.equal(codexProvider?.reason, undefined);
    assert.equal(codexProvider?.defaultModel, 'endpoint-codex-model');
    assert.match(
      (codexProvider?.warnings ?? []).join('\n'),
      /Codex authentication is unavailable; showing external OpenAI-compatible endpoint models only\./u,
    );
    assert.equal(copilotProvider?.available, true);
    assert.equal(copilotProvider?.toolsAvailable, true);
    assert.equal(copilotProvider?.endpointOnly, true);
    assert.equal(copilotProvider?.reason, undefined);
    assert.equal(copilotProvider?.defaultModel, 'endpoint-copilot-model');
    assert.match(
      (copilotProvider?.warnings ?? []).join('\n'),
      /Copilot authentication is unavailable; showing external OpenAI-compatible endpoint models only\./u,
    );
  } finally {
    await stopServer(server);
  }
});
test('providers route keeps degraded bootstrap authoritative even when authless endpoint models exist', async () => {
  await setCodexHome('model = "endpoint-codex-model"\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: true,
    cliPath: '/usr/bin/codex',
    reason: 'Missing auth.json in /tmp/codex',
  });
  __setProviderBootstrapStatusForTests('codex', {
    healthy: false,
    reason: 'codex bootstrap degraded',
    warnings: ['codex bootstrap degraded warning'],
  });
  const codexEndpoint = await startExternalOpenAiCompatServer({
    models: ['endpoint-codex-model'],
  });
  tempExternalServers.push(codexEndpoint);
  env.set(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    `${codexEndpoint.baseUrl}/v1|responses`,
  );
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
    const codexProvider = res.body.providers.find(
      (provider: { id: string }) => provider.id === 'codex',
    );
    assert.equal(codexProvider?.available, false);
    assert.equal(codexProvider?.toolsAvailable, false);
    assert.equal(codexProvider?.endpointOnly, false);
    assert.equal(codexProvider?.reason, 'codex bootstrap degraded');
    assert.equal(
      (codexProvider?.warnings ?? []).some((warning: string) =>
        warning.includes('authentication is unavailable'),
      ),
      false,
    );
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
test('providers marker emits the shared warning_count and warnings fields with the same values as the REST defaults surface', async () => {
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
  let server: Awaited<ReturnType<typeof startServer>> | null = null;
  let originalInfo: typeof console.info = console.info;
  try {
    server = await startServer({
      mcpAvailable: true,
      clientFactory: () =>
        createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      if (args[0] === STORY_47_TASK_1_LOG_MARKER && args[1]) {
        markerPayloads.push(args[1] as Record<string, unknown>);
      }
    };
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);
    const marker = markerPayloads.at(-1);
    assert.ok(marker);
    assert.equal(marker.surface, '/chat/providers');
    assert.equal(marker.model_source, 'fallback');
    assert.equal(marker.codex_model_source, 'hardcoded');
    assert.equal(marker.warning_count, res.body.codexWarnings.length);
    assert.deepEqual(marker.warnings, res.body.codexWarnings);
  } finally {
    console.info = originalInfo;
    if (server) {
      await stopServer(server);
    }
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
test('providers route exposes shared resolver-backed codex defaults and warnings parity while normalizing the provider default model to the live list', async () => {
  await setCodexHome();
  const fixture: CodexCapabilityResolution = {
    defaults: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      modelReasoningEffort: 'medium',
      modelReasoningSummary: 'auto',
      modelVerbosity: 'medium',
      networkAccessEnabled: false,
      webSearchEnabled: false,
      webSearchMode: 'disabled',
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
    assert.equal(res.body.selectedProvider, 'codex');
    assert.equal(res.body.selectedModel, 'fixture-model');
    assert.equal(res.body.providers[0].defaultModel, 'fixture-model');
    assert.equal(res.body.providers[0].defaultModelSource, 'hardcoded');
    assert.deepEqual(
      res.body.providers[0].compatibility.codexDefaults,
      fixture.defaults,
    );
  } finally {
    await stopServer(server);
  }
});
test('providers route exposes provider-local default-model ownership without using compatibility fields as the primary contract', async () => {
  await setCodexHome('model = "config-model"\n');
  await setCopilotHome(
    ['model = "copilot-gpt-5"', 'reasoning_effort = "high"', ''].join('\n'),
  );
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  env.set('COPILOT_GITHUB_TOKEN', 'ghu_test_token_value');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  const copilotHarness = createMockCopilotSdkHarness({
    name: 'provider-default-ownership',
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
    assert.equal(res.body.selectedProvider, 'copilot');
    assert.equal(res.body.providers[0].id, 'copilot');
    assert.equal(res.body.providers[0].defaultModel, 'copilot-gpt-5');
    assert.equal(res.body.providers[0].defaultModelSource, 'config');
    assert.ok(Array.isArray(res.body.providers[0].agentFlags));
    assert.equal(res.body.codexDefaults.sandboxMode, 'danger-full-access');
  } finally {
    await stopServer(server);
  }
});
test('providers route includes a config-pinned external endpoint that is absent from the env list for the selected provider', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['alpha'],
  });
  tempExternalServers.push(externalServer);
  await setCodexHome(
    [
      'model = "alpha"',
      `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
      '',
    ].join('\n'),
  );
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('Codex_model_list', 'beta');
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
    assert.equal(res.body.selectedProvider, 'codex');
    assert.equal(res.body.selectedModel, 'alpha');
    assert.equal(res.body.selectedEndpointId, `${externalServer.baseUrl}/v1`);
    assert.equal(res.body.providers[0].id, 'codex');
    assert.equal(res.body.providers[0].defaultModel, 'alpha');
    assert.equal(res.body.providers[0].defaultModelSource, 'config');
    assert.equal(externalServer.requestCount(), 1);
  } finally {
    await stopServer(server);
  }
});
test('providers route collapses env-backed and config-backed copies of the same normalized endpoint into one discovery pass', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['alpha'],
  });
  tempExternalServers.push(externalServer);
  const endpointEntry = `${externalServer.baseUrl}/v1|responses`;
  await setCodexHome(
    [
      'model = "alpha"',
      `codeinfo_openai_endpoint = "${endpointEntry}"`,
      '',
    ].join('\n'),
  );
  env.set(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    [endpointEntry, endpointEntry].join(';'),
  );
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('Codex_model_list', 'beta');
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
    assert.equal(res.body.selectedProvider, 'codex');
    assert.equal(res.body.selectedModel, 'alpha');
    assert.equal(res.body.selectedEndpointId, `${externalServer.baseUrl}/v1`);
    assert.equal(res.body.providers[0].defaultModel, 'alpha');
    assert.equal(externalServer.requestCount(), 1);
  } finally {
    await stopServer(server);
  }
});
test('providers route keeps normalized duplicate endpoint warnings out of the response while preserving them in logs', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['alpha'],
  });
  tempExternalServers.push(externalServer);
  await setCodexHome(
    [
      'model = "alpha"',
      `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
      '',
    ].join('\n'),
  );
  env.set(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    `SparkUnsloth,${externalServer.baseUrl}/v1|responses`,
  );
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('Codex_model_list', 'alpha,builtin-a');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  const markerPayloads: Array<Record<string, unknown>> = [];
  let server: Awaited<ReturnType<typeof startServer>> | null = null;
  let originalInfo: typeof console.info = console.info;
  try {
    server = await startServer({
      mcpAvailable: true,
      clientFactory: () =>
        createClient([{ modelKey: 'model-1', displayName: 'model-1' }]),
    });
    env.set('MCP_URL', `${server.baseUrl}/mcp`);
    originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      if (args[0] === STORY_47_TASK_1_LOG_MARKER && args[1]) {
        markerPayloads.push(args[1] as Record<string, unknown>);
      }
    };
    const res = await request(server.httpServer)
      .get('/chat/providers')
      .expect(200);
    assert.equal(
      (res.body.codexWarnings as string[]).some((warning) =>
        warning.includes('Skipping config-pinned endpoint'),
      ),
      false,
    );
    assert.equal(
      (res.body.providers[0].warnings as string[]).some((warning) =>
        warning.includes('Skipping config-pinned endpoint'),
      ),
      false,
    );
    const marker = markerPayloads.at(-1);
    assert.ok(marker);
    assert.equal(
      (marker.warnings as string[]).some((warning) =>
        warning.includes('Skipping config-pinned endpoint'),
      ),
      true,
    );
  } finally {
    console.info = originalInfo;
    if (server) {
      await stopServer(server);
    }
  }
});
test('providers route preserves endpoint identity for a pinned Codex default when the discovered model casing differs from config', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['unsloth/gemma-4-26B-A4B-it-qat-GGUF'],
  });
  tempExternalServers.push(externalServer);
  await setCodexHome(
    [
      'model = "unsloth/gemma-4-26b-A4b-it-qat-GGUF"',
      `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses"`,
      '',
    ].join('\n'),
  );
  env.set(
    'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    `SparkUnsloth,${externalServer.baseUrl}/v1|responses`,
  );
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
  env.set('Codex_model_list', 'unsloth/gemma-4-26b-A4b-it-qat-GGUF,builtin-a');
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
    assert.equal(res.body.selectedProvider, 'codex');
    assert.equal(res.body.selectedModel, 'unsloth/gemma-4-26B-A4B-it-qat-GGUF');
    assert.equal(res.body.selectedEndpointId, `${externalServer.baseUrl}/v1`);
    assert.equal(
      res.body.providers[0].defaultModel,
      'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
    );
    assert.equal(res.body.providers[0].defaultModelSource, 'config');
    assert.equal(externalServer.requestCount(), 1);
  } finally {
    await stopServer(server);
  }
});
test('providers route degrades malformed Copilot chat defaults to warnings instead of failing discovery', async () => {
  await setCodexHome('model = "config-model"\n');
  await setCopilotHome('reasoning_effort = [\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  env.set('COPILOT_GITHUB_TOKEN', 'ghu_test_token_value');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  const copilotHarness = createMockCopilotSdkHarness({
    name: 'provider-malformed-copilot-config',
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
    const copilot = (res.body.providers as Array<Record<string, unknown>>).find(
      (provider) => provider.id === 'copilot',
    );
    assert.ok(copilot);
    assert.equal(res.body.selectedProvider, 'codex');
    assert.equal(copilot.available, true);
    assert.equal(copilot.defaultModel, 'copilot-gpt-5');
    assert.equal(copilot.defaultModelSource, 'hardcoded');
    assert.deepEqual(
      (
        copilot.agentFlags as Array<{
          key: string;
          resolvedDefault: unknown;
        }>
      ).map((entry) => ({
        key: entry.key,
        resolvedDefault: entry.resolvedDefault,
      })),
      [
        { key: 'modelReasoningEffort', resolvedDefault: 'medium' },
        { key: 'toolAccess', resolvedDefault: 'on' },
      ],
    );
    assert.match(
      (copilot.warnings as string[]).join('\n'),
      /default model resolution/i,
    );
    assert.match(
      (copilot.warnings as string[]).join('\n'),
      /agentFlags resolution/i,
    );
  } finally {
    await stopServer(server);
  }
});
test('providers route warns when a pinned Copilot endpoint is filtered out by provider capability mismatch', async () => {
  await setCodexHome('model = "config-model"\n');
  await setCopilotHome(
    [
      'model = "copilot-gpt-5"',
      'codeinfo_openai_endpoint = "https://alpha.example/v1|responses"',
      '',
    ].join('\n'),
  );
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  env.set('COPILOT_GITHUB_TOKEN', 'ghu_test_token_value');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  const copilotHarness = createMockCopilotSdkHarness({
    name: 'provider-copilot-capability-mismatch',
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
    const copilot = (res.body.providers as Array<Record<string, unknown>>).find(
      (provider) => provider.id === 'copilot',
    );
    assert.ok(copilot);
    assert.equal(res.body.selectedEndpointId, undefined);
    assert.match(
      (copilot.warnings as string[]).join('\n'),
      /pinned endpoint "https:\/\/alpha\.example\/v1" is ignored for discovery because it does not advertise the capabilities required by provider "copilot"/u,
    );
  } finally {
    await stopServer(server);
  }
});
test('providers route clamps unsupported Copilot config defaults to the runtime-supported values', async () => {
  await setCodexHome('model = "config-model"\n');
  await setCopilotHome(
    ['reasoning_effort = "turbo"', 'tool_access = "maybe"', ''].join('\n'),
  );
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'copilot');
  env.set('CODEINFO_LMSTUDIO_BASE_URL', 'ws://localhost:1234');
  env.set('COPILOT_GITHUB_TOKEN', 'ghu_test_token_value');
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
  });
  const copilotHarness = createMockCopilotSdkHarness({
    name: 'provider-unsupported-copilot-config',
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
    const copilot = (res.body.providers as Array<Record<string, unknown>>).find(
      (provider) => provider.id === 'copilot',
    );
    assert.ok(copilot);
    assert.deepEqual(
      (
        copilot.agentFlags as Array<{
          key: string;
          resolvedDefault: unknown;
        }>
      ).map((entry) => ({
        key: entry.key,
        resolvedDefault: entry.resolvedDefault,
      })),
      [
        { key: 'modelReasoningEffort', resolvedDefault: 'medium' },
        { key: 'toolAccess', resolvedDefault: 'on' },
      ],
    );
    assert.equal((copilot.warnings as string[]).length, 0);
  } finally {
    await stopServer(server);
  }
});
test('providers route degrades malformed Codex chat defaults to warnings instead of failing discovery', async () => {
  await setCodexHome('sandbox_mode = [\n');
  env.set('CODEINFO_CHAT_DEFAULT_PROVIDER', 'codex');
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
    const codex = (res.body.providers as Array<Record<string, unknown>>).find(
      (provider) => provider.id === 'codex',
    );
    assert.ok(codex);
    assert.equal(res.body.selectedProvider, 'codex');
    assert.equal(codex.available, true);
    assert.equal(codex.defaultModel, 'gpt-5.6-sol');
    assert.equal(codex.defaultModelSource, 'hardcoded');
    assert.equal(res.body.codexDefaults.sandboxMode, 'danger-full-access');
    assert.equal(res.body.codexDefaults.webSearchMode, 'live');
    assert.match(
      (codex.warnings as string[]).join('\n'),
      /default model resolution/i,
    );
    assert.match(
      (codex.warnings as string[]).join('\n'),
      /discovery defaults resolution/i,
    );
  } finally {
    await stopServer(server);
  }
});
test('providers route keeps seed defaults separate from config-resolved defaults in Agent Flag descriptors', async () => {
  await setCodexHome(
    [
      'model = "config-model"',
      'model_reasoning_effort = "minimal"',
      'approval_policy = "never"',
      'sandbox_mode = "workspace-write"',
      'web_search_mode = "cached"',
      '',
    ].join('\n'),
  );
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
    const codexFlags = res.body.providers[0].agentFlags as Array<
      Record<string, unknown>
    >;
    const approval = codexFlags.find((entry) => entry.key === 'approvalPolicy');
    const reasoning = codexFlags.find(
      (entry) => entry.key === 'modelReasoningEffort',
    );
    const webSearch = codexFlags.find((entry) => entry.key === 'webSearchMode');
    assert.ok(approval);
    assert.equal(approval.seedDefault, 'on-request');
    assert.equal(approval.resolvedDefault, 'never');
    assert.ok(reasoning);
    assert.equal(reasoning.seedDefault, 'high');
    assert.equal(reasoning.resolvedDefault, 'minimal');
    assert.ok(webSearch);
    assert.equal(webSearch.seedDefault, 'live');
    assert.equal(webSearch.resolvedDefault, 'cached');
  } finally {
    await stopServer(server);
  }
});
