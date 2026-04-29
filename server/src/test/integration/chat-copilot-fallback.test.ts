import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import { memoryConversations } from '../../chat/memoryPersistence.js';
import { importCopilotSeedIntoRuntimeHome } from '../../config/copilotSeedBootstrap.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import { createMockCopilotSdkHarness } from '../support/mockCopilotSdk.js';
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

test('copilot chat returns explicit-provider failure when the user selected an unavailable provider directly', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-explicit-provider-failure',
      startError: new Error('copilot unavailable'),
    },
    lmstudioAvailable: true,
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
    assert.equal(memoryConversations.get(conversationId), undefined);
    assert.equal(server.harness.getState().lastCreateSessionConfig, undefined);
  } finally {
    await server.stop();
  }
});

test('copilot chat still falls back automatically when default provider resolution prefers copilot and runtime selection must recover', async () => {
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

test('explicit Copilot chat requests stop failing when startup seed import supplies the missing runtime auth artifacts', async () => {
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
