import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';

import express from 'express';
import supertest from 'supertest';

import {
  ensureCopilotAuthFileStore,
  ensureCopilotPlaintextTokenStorage,
} from '../../config/copilotConfig.js';
import { importCopilotSeedIntoRuntimeHome } from '../../config/copilotSeedBootstrap.js';
import { query, resetStore } from '../../logStore.js';
import { createCopilotDeviceAuthRouter } from '../../routes/copilotDeviceAuth.js';
import {
  createCopilotAlreadyAuthenticatedResponse,
  createCopilotCompletedResponse,
  createCopilotCompletionPendingResponse,
  createCopilotFailedResponse,
  createCopilotUnavailableBeforeStartResponse,
  createCopilotVerificationReadyResponse,
  type CopilotDeviceAuthCompletion,
  type CopilotDeviceAuthResultWithCompletion,
  type CopilotDeviceAuthVerificationReady,
} from '../../utils/copilotDeviceAuth.js';
import {
  createCompletedScenario,
  createFailureScenario,
  createMockCopilotDeviceAuthHarness,
  createVerificationReadyScenario,
  type MockCopilotDeviceAuthCompletionState,
  type MockCopilotDeviceAuthStartResult,
} from '../support/mockCopilotDeviceAuth.js';

const TASK9_LOG_MARKER = 'story.0000051.task09.device_auth_state_emitted';

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
    '{"seeded": true}\n',
    'utf8',
  );
}

function currentRuntimeEnv(baseEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) {
    throw new Error('current runtime identity unavailable on this platform');
  }
  return {
    ...baseEnv,
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

function buildApp(deps?: Parameters<typeof createCopilotDeviceAuthRouter>[0]) {
  const app = express();
  app.use('/copilot', createCopilotDeviceAuthRouter(deps));
  return app;
}

function mapCompletionResult(
  result: MockCopilotDeviceAuthCompletionState,
  source?: Pick<
    CopilotDeviceAuthVerificationReady,
    'verificationUrl' | 'userCode' | 'displayOutput'
  >,
): CopilotDeviceAuthCompletion['result'] {
  switch (result.status) {
    case 'completed':
      return createCopilotCompletedResponse();
    case 'already_authenticated':
      return createCopilotAlreadyAuthenticatedResponse();
    case 'failed':
      return createCopilotFailedResponse(result.reason);
    case 'unavailable_before_start':
      return createCopilotUnavailableBeforeStartResponse(result.reason);
    case 'completion_pending':
    default:
      if (!source) {
        return createCopilotCompletionPendingResponse({});
      }
      return createCopilotCompletionPendingResponse(source);
  }
}

function toDeviceAuthResult(
  startResult: MockCopilotDeviceAuthStartResult,
): CopilotDeviceAuthResultWithCompletion {
  if (startResult.status === 'already_authenticated') {
    const result = createCopilotAlreadyAuthenticatedResponse();
    return {
      ...result,
      completion: Promise.resolve({ exitCode: 0, result }),
    };
  }
  if (startResult.status === 'failed') {
    const result = createCopilotFailedResponse(startResult.reason);
    return {
      ...result,
      completion: Promise.resolve({ exitCode: 1, result }),
    };
  }
  if (startResult.status === 'unavailable_before_start') {
    const result = createCopilotUnavailableBeforeStartResponse(
      startResult.reason,
    );
    return {
      ...result,
      completion: Promise.resolve({ exitCode: 1, result }),
    };
  }

  const verificationReady = createCopilotVerificationReadyResponse({
    verificationUrl: startResult.verificationUrl,
    userCode: startResult.userCode,
    displayOutput: startResult.rawOutput,
  });

  return {
    ...verificationReady,
    completion: startResult.completion.then((completionState) => ({
      exitCode:
        completionState.status === 'completed' ||
        completionState.status === 'already_authenticated'
          ? 0
          : 1,
      result: mapCompletionResult(completionState, verificationReady),
    })),
  };
}

function depsFromHarness(
  harness: ReturnType<typeof createMockCopilotDeviceAuthHarness>,
  overrides?: Partial<Parameters<typeof createCopilotDeviceAuthRouter>[0]>,
): Parameters<typeof createCopilotDeviceAuthRouter>[0] {
  return {
    getCopilotHome: () => '/tmp/copilot-home',
    getCopilotConfigDirForHome: (home: string) => home,
    ensureCopilotAuthFileStore: async (configDir: string) => ({
      changed: false,
      configDir,
    }),
    ensureCopilotPlaintextTokenStorage: async () => ({
      changed: false,
      settingsPath: '/tmp/copilot-home/settings.json',
    }),
    ensureCopilotAuthHomeCompatibility: async () => ({
      action: 'none',
      diagnostics: {
        homeDir: undefined,
        copilotHome: '/tmp/copilot-home',
        configDir: '/tmp/copilot-home',
        compatPath: undefined,
        copilotHomeExists: false,
        configDirExists: false,
        compatPathExists: false,
        compatStatus: 'missing_home',
      },
    }),
    inspectCopilotAuthLocations: async () => ({
      homeDir: undefined,
      copilotHome: '/tmp/copilot-home',
      configDir: '/tmp/copilot-home',
      compatPath: undefined,
      copilotHomeExists: false,
      configDirExists: false,
      compatPathExists: false,
      compatStatus: 'missing_home',
    }),
    runCopilotDeviceAuth: async () =>
      toDeviceAuthResult(await harness.startDeviceAuth()),
    resolveCopilotCli: () => ({ available: true }),
    createRuntime: () => ({
      start: async () => {},
      stop: async () => [],
      getAuthStatus: async () => ({
        isAuthenticated: false,
        authType: 'user',
      }),
    }),
    readDeviceAuthState: async () => harness.readDeviceAuthState(),
    env: {},
    ...overrides,
  };
}

describe('POST /copilot/device-auth integration behavior', () => {
  test('returns verification URL and one-time code before the full login completes', async () => {
    const harness = createMockCopilotDeviceAuthHarness(
      createVerificationReadyScenario({
        completionSequence: [{ status: 'completion_pending' }],
      }),
    );
    const res = await supertest(buildApp(depsFromHarness(harness)))
      .post('/copilot/device-auth')
      .send({});

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      provider: 'copilot',
      state: 'verification_ready',
      verificationUrl: 'https://github.com/login/device',
      userCode: 'ABCD-EFGH',
      displayOutput:
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code ABCD-EFGH',
    });
  });

  test('advisory existing-auth detection still allows a fresh verification flow', async () => {
    const harness = createMockCopilotDeviceAuthHarness(
      createVerificationReadyScenario({
        completionSequence: [{ status: 'completion_pending' }],
      }),
    );
    const res = await supertest(
      buildApp(
        depsFromHarness(harness, {
          createRuntime: () => ({
            start: async () => {},
            stop: async () => [],
            getAuthStatus: async () => ({
              isAuthenticated: true,
              authType: 'gh-cli',
            }),
          }),
        }),
      ),
    )
      .post('/copilot/device-auth')
      .send({});

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      provider: 'copilot',
      state: 'verification_ready',
      verificationUrl: 'https://github.com/login/device',
      userCode: 'ABCD-EFGH',
      detectedAuthState: 'already_authenticated',
      displayOutput:
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code ABCD-EFGH',
    });
  });

  test('completion remains observable through the mounted route', async () => {
    const harness = createMockCopilotDeviceAuthHarness(
      createVerificationReadyScenario({
        completionSequence: [
          { status: 'completion_pending' },
          { status: 'completed' },
        ],
      }),
    );
    const app = buildApp(depsFromHarness(harness));

    const first = await supertest(app).post('/copilot/device-auth').send({});
    assert.equal(first.status, 200);
    assert.equal(first.body.state, 'verification_ready');
    await new Promise((resolve) => setImmediate(resolve));

    const second = await supertest(app).post('/copilot/device-auth').send({});
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, {
      provider: 'copilot',
      state: 'completed',
    });
  });

  test('expired device-auth state is cleared so a retry returns a fresh verification code', async () => {
    const firstResponse = createCopilotVerificationReadyResponse({
      verificationUrl: 'https://github.com/login/device',
      userCode: 'ABCD-EFGH',
      displayOutput:
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code ABCD-EFGH',
    });
    const secondResponse = createCopilotVerificationReadyResponse({
      verificationUrl: 'https://github.com/login/device',
      userCode: 'WXYZ-1234',
      displayOutput:
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code WXYZ-1234',
    });
    let startCount = 0;
    const runCopilotDeviceAuth = mock.fn(async () => {
      startCount += 1;
      if (startCount === 1) {
        return {
          ...firstResponse,
          completion: Promise.resolve({
            exitCode: 1,
            result: createCopilotFailedResponse(
              'device code expired or was declined',
            ),
          }),
        };
      }
      return {
        ...secondResponse,
        completion: Promise.resolve({
          exitCode: 1,
          result: createCopilotCompletionPendingResponse(secondResponse),
        }),
      };
    });

    const app = buildApp(
      depsFromHarness(
        createMockCopilotDeviceAuthHarness(createVerificationReadyScenario()),
        {
          runCopilotDeviceAuth,
        },
      ),
    );

    const first = await supertest(app).post('/copilot/device-auth').send({});
    assert.equal(first.status, 200);
    assert.equal(first.body.state, 'verification_ready');
    assert.equal(first.body.userCode, 'ABCD-EFGH');

    await new Promise((resolve) => setImmediate(resolve));

    const second = await supertest(app).post('/copilot/device-auth').send({});
    assert.equal(second.status, 200);
    assert.equal(second.body.state, 'verification_ready');
    assert.equal(second.body.userCode, 'WXYZ-1234');
    assert.equal(runCopilotDeviceAuth.mock.calls.length, 2);
  });

  test('keychain-unavailable fallback still works through writable CODEINFO_COPILOT_HOME settings storage', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'copilot-device-auth-'),
    );
    const harness = createMockCopilotDeviceAuthHarness(
      createCompletedScenario(),
    );

    try {
      const app = buildApp(
        depsFromHarness(harness, {
          getCopilotHome: () => tempRoot,
          getCopilotConfigDirForHome: (home: string) => home,
          ensureCopilotAuthFileStore,
          ensureCopilotPlaintextTokenStorage: async (home: string) => {
            const settingsPath = path.join(home, 'settings.json');
            await fs.writeFile(
              settingsPath,
              JSON.stringify({ storeTokenPlaintext: true }, null, 2),
              'utf8',
            );
            return {
              changed: true,
              settingsPath,
            };
          },
        }),
      );

      const res = await supertest(app).post('/copilot/device-auth').send({});
      assert.equal(res.status, 200);
      assert.equal(res.body.state, 'verification_ready');
      await fs.access(path.join(tempRoot, 'settings.json'));
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('commented config.json does not block preflight when settings.json is missing', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'copilot-device-auth-jsonc-'),
    );
    const harness = createMockCopilotDeviceAuthHarness(
      createVerificationReadyScenario(),
    );
    const runCopilotDeviceAuth = mock.fn(async () =>
      toDeviceAuthResult(await harness.startDeviceAuth()),
    );

    try {
      await fs.writeFile(
        path.join(tempRoot, 'config.json'),
        '{\n  // Copilot-managed compatibility metadata\n  "store_token_plaintext": true,\n}\n',
        'utf8',
      );

      const res = await supertest(
        buildApp(
          depsFromHarness(harness, {
            getCopilotHome: () => tempRoot,
            getCopilotConfigDirForHome: (home: string) => home,
            ensureCopilotAuthFileStore,
            ensureCopilotPlaintextTokenStorage,
            runCopilotDeviceAuth,
          }),
        ),
      )
        .post('/copilot/device-auth')
        .send({});

      assert.equal(res.status, 200);
      assert.equal(res.body.state, 'verification_ready');
      assert.equal(runCopilotDeviceAuth.mock.calls.length, 1);
      assert.deepEqual(
        JSON.parse(
          await fs.readFile(path.join(tempRoot, 'settings.json'), 'utf8'),
        ),
        { storeTokenPlaintext: true },
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('settings bootstrap failures surface the shared unavailable-before-start contract', async () => {
    const harness = createMockCopilotDeviceAuthHarness(
      createVerificationReadyScenario(),
    );
    const runCopilotDeviceAuth = mock.fn(async () =>
      toDeviceAuthResult(await harness.startDeviceAuth()),
    );

    const res = await supertest(
      buildApp(
        depsFromHarness(harness, {
          ensureCopilotPlaintextTokenStorage: async () => {
            throw new Error('EACCES: settings.json');
          },
          runCopilotDeviceAuth,
        }),
      ),
    )
      .post('/copilot/device-auth')
      .send({});

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      provider: 'copilot',
      state: 'unavailable_before_start',
      reason: 'copilot config persistence unavailable',
    });
    assert.equal(runCopilotDeviceAuth.mock.calls.length, 0);
  });

  test('main-stack-style seeded runtime homes proceed past preflight instead of failing unavailable-before-start', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'copilot-device-auth-seed-'),
    );
    const seedHome = path.join(tempRoot, 'seed-home');
    const runtimeHome = path.join(tempRoot, 'runtime-home');
    const harness = createMockCopilotDeviceAuthHarness(
      createVerificationReadyScenario(),
    );

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

      const res = await supertest(
        buildApp(
          depsFromHarness(harness, {
            getCopilotHome: () => runtimeHome,
            getCopilotConfigDirForHome: (home: string) => home,
            ensureCopilotAuthFileStore,
            ensureCopilotPlaintextTokenStorage,
            env: currentRuntimeEnv({
              CODEINFO_COPILOT_HOME: runtimeHome,
              CODEINFO_COPILOT_SEED_HOME: seedHome,
            }),
          }),
        ),
      )
        .post('/copilot/device-auth')
        .send({});

      assert.equal(res.status, 200);
      assert.equal(res.body.provider, 'copilot');
      assert.equal(res.body.state, 'verification_ready');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('route honors CODEINFO_COPILOT_CLI_PATH when PATH discovery is unavailable', async () => {
    const harness = createMockCopilotDeviceAuthHarness(
      createVerificationReadyScenario(),
    );
    const runCopilotDeviceAuth = mock.fn(async () =>
      toDeviceAuthResult(await harness.startDeviceAuth()),
    );

    const app = buildApp(
      depsFromHarness(harness, {
        env: {
          CODEINFO_COPILOT_CLI_PATH: '/opt/copilot/bin/copilot',
        },
        resolveCopilotCli: (env) => ({
          available: true,
          cliPath: env?.CODEINFO_COPILOT_CLI_PATH,
        }),
        runCopilotDeviceAuth,
      }),
    );

    const res = await supertest(app).post('/copilot/device-auth').send({});

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      provider: 'copilot',
      state: 'verification_ready',
      verificationUrl: 'https://github.com/login/device',
      userCode: 'ABCD-EFGH',
      displayOutput:
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code ABCD-EFGH',
    });
    assert.equal(runCopilotDeviceAuth.mock.calls.length, 1);
    const firstCallArgs = runCopilotDeviceAuth.mock.calls[0]
      ?.arguments as unknown[];
    assert.equal(
      (firstCallArgs[0] as { cliPath?: string } | undefined)?.cliPath,
      '/opt/copilot/bin/copilot',
    );
  });

  test('concurrent auth-start requests share one single-flight attempt', async () => {
    let resolveRun!: (value: CopilotDeviceAuthResultWithCompletion) => void;
    const runPromise = new Promise<CopilotDeviceAuthResultWithCompletion>(
      (resolve) => {
        resolveRun = resolve;
      },
    );
    const runCopilotDeviceAuth = mock.fn(async () => runPromise);
    const app = buildApp(
      depsFromHarness(
        createMockCopilotDeviceAuthHarness(createVerificationReadyScenario()),
        {
          runCopilotDeviceAuth,
        },
      ),
    );

    const reqA = supertest(app).post('/copilot/device-auth').send({});
    await new Promise((resolve) => setTimeout(resolve, 25));
    const reqB = supertest(app).post('/copilot/device-auth').send({});
    await new Promise((resolve) => setTimeout(resolve, 25));

    resolveRun(
      toDeviceAuthResult({
        status: 'verification_ready',
        verificationUrl: 'https://github.com/login/device',
        userCode: 'ABCD-EFGH',
        rawOutput:
          'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code ABCD-EFGH',
        completion: Promise.resolve({ status: 'completion_pending' }),
      }),
    );

    const [resA, resB] = await Promise.all([reqA, reqB]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.equal(resA.body.state, 'verification_ready');
    assert.deepEqual(resB.body, {
      provider: 'copilot',
      state: 'completion_pending',
      verificationUrl: 'https://github.com/login/device',
      userCode: 'ABCD-EFGH',
      displayOutput:
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code ABCD-EFGH',
    });
    assert.equal(runCopilotDeviceAuth.mock.calls.length, 1);
  });

  test('failure-path auth logs stay secret-safe without raw verification or token output', async () => {
    resetStore();
    const secret = 'ghu_secret_token_should_not_leak';
    const harness = createMockCopilotDeviceAuthHarness(
      createFailureScenario({
        reason: `${secret} device auth failed`,
      }),
    );
    const res = await supertest(buildApp(depsFromHarness(harness)))
      .post('/copilot/device-auth')
      .send({});

    assert.equal(res.status, 200);
    const logged = query({ text: TASK9_LOG_MARKER }, 50)
      .map((entry) => `${entry.message} ${JSON.stringify(entry.context ?? {})}`)
      .join('\n');
    assert.equal(logged.includes(secret), false);
    assert.ok(logged.includes(TASK9_LOG_MARKER));
  });
});
