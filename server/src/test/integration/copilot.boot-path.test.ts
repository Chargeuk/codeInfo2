import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ModelInfo } from '@github/copilot-sdk';
import express from 'express';
import request from 'supertest';

import {
  __resetCopilotSeedBootstrapHooksForTests,
  __setCopilotSeedBootstrapHooksForTests,
  importCopilotSeedIntoRuntimeHome,
} from '../../config/copilotSeedBootstrap.js';
import { createChatRouter } from '../../routes/chat.js';
import { createChatModelsRouter } from '../../routes/chatModels.js';
import { createChatProvidersRouter } from '../../routes/chatProviders.js';
import {
  queryTask16BootLogs,
  startNamedCopilotScenarioServer,
} from '../support/copilotBootPath.js';
import { createMockCopilotSdkHarness } from '../support/mockCopilotSdk.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

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
    '{"bootstrapped": true}\n',
    'utf8',
  );
}

async function writeCopilotChatConfig(seedHome: string, contents: string) {
  await fs.mkdir(path.join(seedHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(seedHome, 'chat', 'config.toml'),
    contents,
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

async function listBootstrapStageRoots(parentDir: string) {
  const entries = await fs.readdir(parentDir, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith('.copilot-seed-stage-'),
    )
    .map((entry) => entry.name);
}

const createReadyPingResponse = () => ({
  message: 'ready',
  timestamp: Date.now(),
});

const createReadyModels = (): ModelInfo[] => [
  {
    id: 'copilot-gpt-5',
    name: 'Copilot GPT-5',
    capabilities: {
      supports: {
        vision: false,
        reasoningEffort: true,
      },
      limits: {
        max_context_window_tokens: 200000,
      },
    },
    supportedReasoningEfforts: ['medium'],
    defaultReasoningEffort: 'medium',
  },
];

test('named happy-path fake Copilot scenario boots the higher-level stack end to end', async () => {
  const server = await startNamedCopilotScenarioServer({
    scenarioName: 'copilot-happy-path',
  });

  try {
    const providers = await request(server.httpServer).get('/chat/providers');
    assert.equal(providers.status, 200);
    const copilotProvider = providers.body.providers.find(
      (provider: { id?: string }) => provider.id === 'copilot',
    );
    assert.ok(copilotProvider);
    assert.equal(copilotProvider.available, true);

    const models = await request(server.httpServer).get(
      '/chat/models?provider=copilot',
    );
    assert.equal(models.status, 200);
    assert.equal(models.body.provider, 'copilot');
    assert.equal(models.body.available, true);
    assert.equal(models.body.models[0]?.key, 'copilot-gpt-5');

    const ws = await connectWs({ baseUrl: server.baseUrl });
    try {
      const conversationId = 'task16-boot-happy-path';
      sendJson(ws, {
        type: 'subscribe_conversation',
        conversationId,
      });

      const start = await request(server.httpServer).post('/chat').send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId,
        message: 'Hello from task 16',
      });

      assert.equal(start.status, 202);
      assert.equal(start.body.provider, 'copilot');

      const final = await waitForEvent({
        ws,
        predicate: (
          event: unknown,
        ): event is {
          type?: string;
          status?: string;
          conversationId?: string;
        } => {
          const candidate = event as {
            type?: string;
            status?: string;
            conversationId?: string;
          };
          return (
            candidate.type === 'turn_final' &&
            candidate.status === 'ok' &&
            candidate.conversationId === conversationId
          );
        },
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'ok');
    } finally {
      await closeWs(ws);
    }

    const task16Logs = queryTask16BootLogs();
    assert.ok(task16Logs.length > 0);
    assert.equal(task16Logs.at(-1)?.context?.scenario, 'copilot-happy-path');
  } finally {
    await server.stop();
  }
});

test('named auth-required fake Copilot scenario surfaces the negative path cleanly', async () => {
  const server = await startNamedCopilotScenarioServer({
    scenarioName: 'copilot-auth-required',
  });

  try {
    const providers = await request(server.httpServer).get('/chat/providers');
    assert.equal(providers.status, 200);
    const copilotProvider = providers.body.providers.find(
      (provider: { id?: string }) => provider.id === 'copilot',
    );
    assert.ok(copilotProvider);
    assert.equal(copilotProvider.available, false);
    assert.equal(copilotProvider.reason, 'copilot authentication required');

    const auth = await request(server.httpServer)
      .post('/copilot/device-auth')
      .send({});
    assert.equal(auth.status, 200);
    assert.equal(auth.body.provider, 'copilot');
    assert.equal(auth.body.state, 'verification_ready');
    assert.equal(auth.body.userCode, 'TASK16-ABCD');

    const task16Logs = queryTask16BootLogs();
    assert.ok(task16Logs.length > 0);
    assert.equal(task16Logs.at(-1)?.context?.scenario, 'copilot-auth-required');
  } finally {
    await server.stop();
  }
});

test('seed-imported runtime homes make Copilot visible on providers and models instead of surfacing auth-required by default', async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'copilot-boot-path-'),
  );
  const seedHome = path.join(tempRoot, 'seed-home');
  const runtimeHome = path.join(tempRoot, 'runtime-home');
  const clientFactory = () =>
    ({
      system: {
        listDownloadedModels: async () => [],
      },
    }) as never;

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

    const app = express();
    app.use(
      '/chat',
      createChatProvidersRouter({
        clientFactory,
        copilotRuntimeFactory: () => ({
          start: async () => {},
          stop: async () => [],
          ping: async () => createReadyPingResponse(),
          getAuthStatus: async () => ({
            isAuthenticated: await hasBootstrappedRuntime(runtimeHome),
            authType: 'user',
          }),
          listModels: async () =>
            (await hasBootstrappedRuntime(runtimeHome))
              ? createReadyModels()
              : [],
        }),
      }),
    );
    app.use(
      '/chat',
      createChatModelsRouter({
        clientFactory,
        copilotRuntimeFactory: () => ({
          start: async () => {},
          stop: async () => [],
          ping: async () => createReadyPingResponse(),
          getAuthStatus: async () => ({
            isAuthenticated: await hasBootstrappedRuntime(runtimeHome),
            authType: 'user',
          }),
          listModels: async () =>
            (await hasBootstrappedRuntime(runtimeHome))
              ? createReadyModels()
              : [],
        }),
      }),
    );

    const providers = await request(app).get('/chat/providers');
    assert.equal(providers.status, 200);
    const copilotProvider = providers.body.providers.find(
      (provider: { id?: string }) => provider.id === 'copilot',
    );
    assert.ok(copilotProvider);
    assert.equal(copilotProvider.available, true);

    const models = await request(app).get('/chat/models?provider=copilot');
    assert.equal(models.status, 200);
    assert.equal(models.body.provider, 'copilot');
    assert.equal(models.body.available, true);
    assert.equal(models.body.models[0]?.key, 'copilot-gpt-5');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('boot-path seeding preserves a runtime that initializes after preflight instead of surfacing a mixed seed/runtime state', async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'copilot-boot-replay-safe-'),
  );
  const seedHome = path.join(tempRoot, 'seed-home');
  const runtimeHome = path.join(tempRoot, 'runtime-home');
  const clientFactory = () =>
    ({
      system: {
        listDownloadedModels: async () => [],
      },
    }) as never;
  let injectedRuntime = false;

  try {
    await writeSeedArtifacts(seedHome);
    __setCopilotSeedBootstrapHooksForTests({
      beforePublishArtifact: async ({ artifact }) => {
        if (artifact !== 'settings.json' || injectedRuntime) return;
        injectedRuntime = true;
        await fs.mkdir(path.join(runtimeHome, 'session-state'), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(runtimeHome, 'config.json'),
          '{"runtime":"wins-after-preflight"}\n',
          'utf8',
        );
        await fs.writeFile(
          path.join(runtimeHome, 'settings.json'),
          '{"runtimeSettings":"wins-after-preflight"}\n',
          'utf8',
        );
        await fs.writeFile(
          path.join(runtimeHome, 'session-state', 'session.json'),
          '{"bootstrapped": false, "runtimeWins": true}\n',
          'utf8',
        );
      },
    });

    const seedResult = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
      env: currentRuntimeEnv(),
    });
    assert.equal(
      seedResult.status,
      'seed_skipped_runtime_already_initialized',
    );
    assert.deepEqual(seedResult.copiedArtifacts, []);
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'config.json'), 'utf8'),
      '{"runtime":"wins-after-preflight"}\n',
    );
    assert.deepEqual(await listBootstrapStageRoots(tempRoot), []);

    const app = express();
    app.use(
      '/chat',
      createChatProvidersRouter({
        clientFactory,
        copilotRuntimeFactory: () => ({
          start: async () => {},
          stop: async () => [],
          ping: async () => createReadyPingResponse(),
          getAuthStatus: async () => ({
            isAuthenticated: await hasBootstrappedRuntime(runtimeHome),
            authType: 'user',
          }),
          listModels: async () =>
            (await hasBootstrappedRuntime(runtimeHome))
              ? createReadyModels()
              : [],
        }),
      }),
    );
    app.use(
      '/chat',
      createChatModelsRouter({
        clientFactory,
        copilotRuntimeFactory: () => ({
          start: async () => {},
          stop: async () => [],
          ping: async () => createReadyPingResponse(),
          getAuthStatus: async () => ({
            isAuthenticated: await hasBootstrappedRuntime(runtimeHome),
            authType: 'user',
          }),
          listModels: async () =>
            (await hasBootstrappedRuntime(runtimeHome))
              ? createReadyModels()
              : [],
        }),
      }),
    );

    const providers = await request(app).get('/chat/providers');
    assert.equal(providers.status, 200);
    const copilotProvider = providers.body.providers.find(
      (provider: { id?: string }) => provider.id === 'copilot',
    );
    assert.ok(copilotProvider);
    assert.equal(copilotProvider.available, true);

    const models = await request(app).get('/chat/models?provider=copilot');
    assert.equal(models.status, 200);
    assert.equal(models.body.provider, 'copilot');
    assert.equal(models.body.available, true);
    assert.equal(models.body.models[0]?.key, 'copilot-gpt-5');
  } finally {
    __resetCopilotSeedBootstrapHooksForTests();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('seeded runtime boot normalizes the surfaced Copilot default model and lets chat start without forwarding unsupported reasoning', async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'copilot-boot-normalized-default-'),
  );
  const seedHome = path.join(tempRoot, 'seed-home');
  const runtimeHome = path.join(tempRoot, 'runtime-home');
  const originalCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const clientFactory = () =>
    ({
      system: {
        listDownloadedModels: async () => [],
      },
    }) as never;
  const sdkHarness = createMockCopilotSdkHarness({
    name: 'copilot-normalized-default-model',
    models: [
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 Mini',
      } as ModelInfo,
    ],
  });

  try {
    await writeSeedArtifacts(seedHome);
    await writeCopilotChatConfig(
      seedHome,
      ['model = "copilot-gpt-5"', 'reasoning_effort = "high"', ''].join('\n'),
    );
    process.env.CODEINFO_COPILOT_HOME = seedHome;

    const seedResult = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
      env: currentRuntimeEnv(),
    });
    assert.equal(seedResult.status, 'seed_applied');

    const app = express();
    app.use(express.json());
    app.use(
      '/chat',
      createChatProvidersRouter({
        clientFactory,
        copilotRuntimeFactory: () => sdkHarness.createLifecycle(),
      }),
    );
    app.use(
      '/chat',
      createChatModelsRouter({
        clientFactory,
        copilotRuntimeFactory: () => sdkHarness.createLifecycle(),
      }),
    );
    app.use(
      '/chat',
      createChatRouter({
        clientFactory,
        copilotLifecycleFactory: () => sdkHarness.createLifecycle(),
      }),
    );

    const providers = await request(app).get('/chat/providers').expect(200);
    const copilotProvider = providers.body.providers.find(
      (provider: { id?: string }) => provider.id === 'copilot',
    );
    assert.ok(copilotProvider);
    assert.equal(copilotProvider.defaultModel, 'gpt-5-mini');

    const models = await request(app)
      .get('/chat/models?provider=copilot')
      .expect(200);
    assert.equal(models.body.defaultModel, 'gpt-5-mini');
    assert.equal(models.body.models[0]?.key, 'gpt-5-mini');

    const chat = await request(app).post('/chat').send({
      provider: 'copilot',
      conversationId: 'boot-normalized-default',
      message: 'Hello from the normalized default path',
    });

    assert.equal(chat.status, 202);
    assert.equal(chat.body.provider, 'copilot');
    assert.equal(chat.body.model, 'gpt-5-mini');

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (sdkHarness.getState().lastCreateSessionConfig) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.equal(
      sdkHarness.getState().lastCreateSessionConfig?.model,
      'gpt-5-mini',
    );
    assert.equal(
      sdkHarness.getState().lastCreateSessionConfig?.reasoningEffort,
      undefined,
    );
  } finally {
    if (originalCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = originalCopilotHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
