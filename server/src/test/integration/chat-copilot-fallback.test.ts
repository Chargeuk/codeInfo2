import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ModelInfo } from '@github/copilot-sdk';
import express from 'express';
import request from 'supertest';

import { CopilotLifecycle } from '../../chat/copilotLifecycle.js';
import { memoryConversations } from '../../chat/memoryPersistence.js';
import { importCopilotSeedIntoRuntimeHome } from '../../config/copilotSeedBootstrap.js';
import {
  __resetProviderBootstrapStatusForTests,
  __setProviderBootstrapStatusForTests,
} from '../../config/runtimeConfig.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import {
  createMockCopilotSdkHarness,
  createSessionIdleEvent,
} from '../support/mockCopilotSdk.js';
import { startCopilotChatServer } from './support/copilotChatHarness.js';

async function writeSeedArtifacts(seedHome: string) {
  await fs.mkdir(path.join(seedHome, 'session-state'), { recursive: true });
  await fs.writeFile(
    path.join(seedHome, 'config.json'),
    '{"store_token_plaintext": true}\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(seedHome, 'settings.json'),
    '{"storeTokenPlaintext": true}\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(seedHome, 'session-state', 'session.json'),
    '{"chat": true}\n',
    'utf8',
  );
}

function currentRuntimeEnv(): NodeJS.ProcessEnv {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) {
    throw new Error('current runtime identity unavailable on this platform');
  }
  return {
    CODEINFO_RUNTIME_UID: String(uid),
    CODEINFO_RUNTIME_GID: String(gid),
  };
}

async function lockDownRuntimeArtifacts(runtimeHome: string) {
  await fs.chmod(path.join(runtimeHome, 'config.json'), 0o000);
  await fs.chmod(path.join(runtimeHome, 'settings.json'), 0o000);
  await fs.chmod(
    path.join(runtimeHome, 'session-state', 'session.json'),
    0o000,
  );
  await fs.chmod(path.join(runtimeHome, 'session-state'), 0o000);
}

async function hasBootstrappedRuntime(runtimeHome: string) {
  try {
    await Promise.all([
      fs.access(path.join(runtimeHome, 'config.json')),
      fs.access(path.join(runtimeHome, 'settings.json')),
      fs.access(path.join(runtimeHome, 'session-state')),
    ]);
    return true;
  } catch {
    return false;
  }
}

test('copilot chat fails on the selected explicit provider before unrelated LM Studio fallback probing can run', async () => {
  let lmstudioProbeCount = 0;
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-explicit-provider-failure',
      startError: new Error('copilot unavailable'),
    },
    lmstudioAvailable: true,
    lmstudioClientFactory: () => {
      lmstudioProbeCount += 1;
      throw new Error(
        'lmstudio fallback probe should not run for explicit copilot requests',
      );
    },
  });

  try {
    const conversationId = 'copilot-explicit-provider-failure';
    const response = await request(server.httpServer).post('/chat').send({
      provider: 'copilot',
      model: 'copilot-gpt-5',
      conversationId,
      message: 'Do not silently switch providers',
    });

    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
    assert.match(
      String(response.body.message),
      /copilot connectivity unavailable/i,
    );
    assert.equal(lmstudioProbeCount, 0);
    assert.equal(memoryConversations.get(conversationId), undefined);
    assert.equal(server.harness.getState().lastCreateSessionConfig, undefined);
  } finally {
    await server.stop();
  }
});

test('copilot chat still falls back automatically when provider resolution is omitted and runtime selection must recover', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-default-provider-fallback',
      startError: new Error('copilot unavailable'),
    },
    lmstudioAvailable: true,
  });

  const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
  process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = 'copilot';

  try {
    const conversationId = 'copilot-default-provider-fallback';
    const response = await request(server.httpServer).post('/chat').send({
      conversationId,
      message: 'Fallback please',
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.provider, 'lmstudio');
    assert.equal(memoryConversations.get(conversationId)?.provider, 'lmstudio');
  } finally {
    if (originalDefaultProvider === undefined) {
      delete process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    } else {
      process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = originalDefaultProvider;
    }
    await server.stop();
  }
});

test('chat started responses keep the requested provider and repair the model there when the provider is healthy but the requested model is missing', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-same-provider-model-repair',
      models: [
        {
          id: 'gpt-5-mini',
          name: 'GPT-5 Mini',
        } as ModelInfo,
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
        } as ModelInfo,
      ],
    },
  });

  try {
    const conversationId = 'copilot-same-provider-model-repair';
    const response = await request(server.httpServer).post('/chat').send({
      provider: 'copilot',
      model: 'missing-copilot-model',
      conversationId,
      message: 'Repair the model on the selected provider',
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.provider, 'copilot');
    assert.equal(response.body.model, 'gpt-5-mini');
    assert.equal(memoryConversations.get(conversationId)?.provider, 'copilot');
    assert.equal(memoryConversations.get(conversationId)?.model, 'gpt-5-mini');
  } finally {
    await server.stop();
  }
});

test('chat started responses keep the same requested model first when cross-provider fallback is required', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-same-model-first-fallback',
      startError: new Error('copilot unavailable'),
      models: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
        } as ModelInfo,
      ],
    },
    lmstudioAvailable: true,
    lmstudioClientFactory: () =>
      ({
        system: {
          listDownloadedModels: async () => [
            {
              modelKey: 'lmstudio-test-model',
              displayName: 'LM Studio Test Model',
              type: 'llm',
            },
            {
              modelKey: 'copilot-gpt-5',
              displayName: 'Fallback Matches Requested Model',
              type: 'llm',
            },
          ],
        },
        llm: {
          model: async () => ({
            act: async () => undefined,
          }),
        },
      }) as never,
  });

  const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
  process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = 'copilot';

  try {
    const conversationId = 'copilot-same-model-first-fallback';
    const response = await request(server.httpServer).post('/chat').send({
      conversationId,
      model: 'copilot-gpt-5',
      message: 'Keep the requested model on fallback',
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.provider, 'lmstudio');
    assert.equal(response.body.model, 'copilot-gpt-5');
    assert.equal(memoryConversations.get(conversationId)?.provider, 'lmstudio');
    assert.equal(
      memoryConversations.get(conversationId)?.model,
      'copilot-gpt-5',
    );
  } finally {
    if (originalDefaultProvider === undefined) {
      delete process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    } else {
      process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = originalDefaultProvider;
    }
    await server.stop();
  }
});

test('implicit degraded-bootstrap chat requests fall back at the route and keep warning context', async () => {
  __setProviderBootstrapStatusForTests('copilot', {
    healthy: false,
    reason: 'copilot bootstrap degraded',
    warnings: ['copilot bootstrap degraded warning'],
  });
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-degraded-bootstrap-fallback',
    },
    lmstudioAvailable: true,
  });
  const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
  process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = 'copilot';

  try {
    const response = await request(server.httpServer).post('/chat').send({
      conversationId: 'copilot-bootstrap-fallback',
      message: 'Fallback from degraded bootstrap',
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.provider, 'lmstudio');
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes('copilot bootstrap degraded warning'),
      ),
      true,
    );
    assert.equal(
      response.body.warnings.some((warning: string) =>
        warning.includes('fell back to provider "lmstudio"'),
      ),
      true,
    );
    assert.equal(
      memoryConversations.get('copilot-bootstrap-fallback')?.provider,
      'lmstudio',
    );
  } finally {
    __resetProviderBootstrapStatusForTests();
    if (originalDefaultProvider === undefined) {
      delete process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    } else {
      process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = originalDefaultProvider;
    }
    await server.stop();
  }
});

test('resumed chats reject codex-only agentFlags before a saved copilot conversation can return 202 started', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-saved-provider-agentflags-repin',
    },
  });

  try {
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
      cliPath: '/usr/bin/codex',
    });
    const conversationId = 'copilot-saved-provider-agentflags-repin';
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'copilot',
      model: 'copilot-gpt-5',
      title: 'Saved copilot execution',
      source: 'REST',
      flags: { agentFlags: { toolAccess: 'full' } },
      lastMessageAt: new Date('2026-05-15T00:00:00.000Z'),
      archivedAt: null,
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
      updatedAt: new Date('2026-05-15T00:00:00.000Z'),
    } as never);

    const response = await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        conversationId,
        message: 'Do not start with stale codex-only flags',
        agentFlags: {
          sandboxMode: 'danger-full-access',
        },
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION_FAILED');
    assert.match(
      String(response.body.message),
      /agentFlags\.sandboxMode is not supported for provider "copilot"/i,
    );
    assert.equal(memoryConversations.get(conversationId)?.provider, 'copilot');
    assert.equal(
      memoryConversations.get(conversationId)?.model,
      'copilot-gpt-5',
    );
    assert.equal(server.harness.getState().lastCreateSessionConfig, undefined);
  } finally {
    await server.stop();
  }
});

test('explicit Copilot chat requests recover once startup seed import restores the missing runtime auth artifacts', async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'copilot-chat-seed-import-'),
  );
  const seedHome = path.join(tempRoot, 'seed-home');
  const runtimeHome = path.join(tempRoot, 'runtime-home');
  const harness = createMockCopilotSdkHarness({
    name: 'copilot-chat-seed-import-success',
  });

  try {
    await writeSeedArtifacts(seedHome);
    const seedResult = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
      env: currentRuntimeEnv(),
    });
    assert.equal(seedResult.status, 'seed_applied');
    await lockDownRuntimeArtifacts(runtimeHome);
    const normalizationResult = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
      env: currentRuntimeEnv(),
    });
    assert.equal(
      normalizationResult.status,
      'seed_skipped_runtime_already_initialized',
    );

    memoryConversations.clear();
    setCodexDetection({
      available: false,
      authPresent: false,
      configPresent: false,
      reason: 'not detected',
    });

    const app = express();
    app.use(express.json());
    app.post('/mcp', (_req, res) => {
      res.json({ result: { ok: true } });
    });
    app.use(
      '/chat',
      createChatRouter({
        clientFactory: () =>
          ({
            system: {
              listDownloadedModels: async () => [],
            },
          }) as never,
        copilotLifecycleFactory: () => {
          const lifecycle = harness.createLifecycle();
          const start = lifecycle.start.bind(lifecycle);
          const getAuthStatus = lifecycle.getAuthStatus.bind(lifecycle);
          lifecycle.start = async () => {
            if (!(await hasBootstrappedRuntime(runtimeHome))) {
              throw new Error('copilot unavailable');
            }
            await start();
          };
          lifecycle.getAuthStatus = async () =>
            (await hasBootstrappedRuntime(runtimeHome))
              ? getAuthStatus()
              : {
                  isAuthenticated: false,
                  authType: 'user',
                };
          return lifecycle;
        },
      }),
    );

    const response = await request(app).post('/chat').send({
      provider: 'copilot',
      model: 'copilot-gpt-5',
      conversationId: 'copilot-seed-import-success',
      message: 'Prove the seed import restored Copilot startup auth',
    });

    assert.equal(response.status, 202);
    assert.equal(response.body.provider, 'copilot');
  } finally {
    memoryConversations.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('chat forwards CODEINFO_ROOT into the Copilot runtime environment', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'chat-copilot-codeinfo-root-'),
  );
  const envKeys = [
    'CODEINFO_SERVER_PORT',
    'MCP_URL',
    'CODEINFO_LMSTUDIO_BASE_URL',
  ] as const;
  const originalEnv = new Map<string, string | undefined>();
  for (const key of envKeys) {
    originalEnv.set(key, process.env[key]);
  }

  const capturedOptions: { env?: NodeJS.ProcessEnv }[] = [];
  const harness = createMockCopilotSdkHarness({
    name: 'chat-copilot-env-forwarding',
    models: [
      {
        id: 'copilot-model',
        name: 'Copilot Model',
      } as ModelInfo,
    ],
    createSessionEvents: [createSessionIdleEvent()],
  });

  const app = express();
  app.use(express.json());
  app.post('/mcp', (_req, res) => {
    res.json({ result: { ok: true } });
  });
  app.use(
    '/chat',
    createChatRouter({
      clientFactory: () =>
        ({
          system: {
            listDownloadedModels: async () => [],
          },
        }) as never,
      listIngestedRepositoriesFn: async () =>
        ({
          repos: [{ containerPath: repoRoot }],
          lockedModelId: null,
        }) as never,
      copilotLifecycleFactory: ({ env } = {}) =>
        new CopilotLifecycle({
          env,
          clientFactory: (options) => {
            capturedOptions.push(options);
            return harness.createClientFactory()(options);
          },
        }),
    }),
  );

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  process.env.CODEINFO_SERVER_PORT = String(address.port);
  process.env.MCP_URL = `http://127.0.0.1:${address.port}/mcp`;
  process.env.CODEINFO_LMSTUDIO_BASE_URL = 'http://127.0.0.1:9';

  try {
    await request(httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-model',
        conversationId: 'chat-copilot-codeinfo-root',
        message: 'Pass CODEINFO_ROOT through to Copilot.',
        working_folder: repoRoot,
      })
      .expect(202);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (capturedOptions.length >= 1) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(
      capturedOptions.some((options) => options.env?.CODEINFO_ROOT === repoRoot),
      true,
    );
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    memoryConversations.delete('chat-copilot-codeinfo-root');
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
