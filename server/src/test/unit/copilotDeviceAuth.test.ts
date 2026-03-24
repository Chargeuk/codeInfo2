import assert from 'node:assert/strict';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, mock, test } from 'node:test';
import { PassThrough } from 'node:stream';

import express from 'express';
import supertest from 'supertest';

import { createCopilotDeviceAuthRouter } from '../../routes/copilotDeviceAuth.js';
import {
  createCopilotCompletionPendingResponse,
  createCopilotCompletedResponse,
  createCopilotFailedResponse,
  createCopilotVerificationReadyResponse,
  type CopilotDeviceAuthCompletion,
  type CopilotDeviceAuthResult,
  type CopilotDeviceAuthResultWithCompletion,
  runCopilotDeviceAuth,
} from '../../utils/copilotDeviceAuth.js';

function buildApp(deps?: Parameters<typeof createCopilotDeviceAuthRouter>[0]) {
  const app = express();
  app.use('/copilot', createCopilotDeviceAuthRouter(deps));
  return app;
}

function buildDeviceAuthResult(
  result: CopilotDeviceAuthResult,
  completionResult: CopilotDeviceAuthCompletion['result'] = result.state ===
  'verification_ready'
    ? createCopilotCompletedResponse()
    : result,
  exitCode = completionResult.state === 'completed' ? 0 : 1,
): CopilotDeviceAuthResultWithCompletion {
  return {
    ...result,
    completion: Promise.resolve({
      exitCode,
      result: completionResult,
    }),
  };
}

function verificationReadyResult() {
  return createCopilotVerificationReadyResponse({
    verificationUrl: 'https://github.com/login/device',
    userCode: 'ABCD-EFGH',
    displayOutput:
      'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code ABCD-EFGH',
  });
}

function withDeps(
  overrides?: Partial<Parameters<typeof createCopilotDeviceAuthRouter>[0]>,
): Parameters<typeof createCopilotDeviceAuthRouter>[0] {
  return {
    getCopilotHome: () => '/tmp/copilot-home',
    getCopilotConfigDirForHome: (home: string) => `${home}/config`,
    ensureCopilotAuthFileStore: async (configDir: string) => ({
      changed: false,
      configDir,
    }),
    ensureCopilotPlaintextTokenStorage: async () => ({
      changed: false,
      configPath: '/tmp/copilot-home/config.json',
    }),
    ensureCopilotAuthHomeCompatibility: async () => ({
      action: 'none',
      diagnostics: {
        homeDir: undefined,
        copilotHome: '/tmp/copilot-home',
        configDir: '/tmp/copilot-home/config',
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
      configDir: '/tmp/copilot-home/config',
      compatPath: undefined,
      copilotHomeExists: false,
      configDirExists: false,
      compatPathExists: false,
      compatStatus: 'missing_home',
    }),
    runCopilotDeviceAuth: async () =>
      buildDeviceAuthResult(verificationReadyResult()),
    resolveCopilotCli: () => ({ available: true }),
    createRuntime: () => ({
      start: async () => {},
      stop: async () => [],
      getAuthStatus: async () => ({
        isAuthenticated: false,
        authType: 'user',
      }),
    }),
    env: {},
    ...overrides,
  };
}

function createSpawnStub(commandCalls: Array<{ command: string; args: string[] }>) {
  return mock.fn((command: string, args?: string[]) => {
    commandCalls.push({ command, args: args ?? [] });
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();

    setImmediate(() => {
      child.stdout.write(
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code ABCD-EFGH',
      );
      child.stdout.end();
      child.emit('close', 0);
    });

    return child;
  });
}

describe('POST /copilot/device-auth unit behavior', () => {
  test('env-token authentication short-circuits to already-authenticated without device flow', async () => {
    const runCopilotDeviceAuth = mock.fn(async () =>
      buildDeviceAuthResult(verificationReadyResult()),
    );

    const res = await supertest(
      buildApp(
        withDeps({
          runCopilotDeviceAuth,
          env: { GITHUB_TOKEN: 'ghu_test_token' },
        }),
      ),
    )
      .post('/copilot/device-auth')
      .send({});

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      provider: 'copilot',
      state: 'already_authenticated',
    });
    assert.equal(runCopilotDeviceAuth.mock.calls.length, 0);
  });

  test('stored login or gh-cli authentication also short-circuits before device flow', async () => {
    const runCopilotDeviceAuth = mock.fn(async () =>
      buildDeviceAuthResult(verificationReadyResult()),
    );

    const res = await supertest(
      buildApp(
        withDeps({
          runCopilotDeviceAuth,
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
      state: 'already_authenticated',
    });
    assert.equal(runCopilotDeviceAuth.mock.calls.length, 0);
  });

  test('missing-cli and config bootstrap failures surface clear unavailable-before-start reasons', async () => {
    const cliMissingRes = await supertest(
      buildApp(
        withDeps({
          resolveCopilotCli: () => ({
            available: false,
            reason: 'copilot not found',
          }),
          runCopilotDeviceAuth: async () => {
            throw new Error('should not run');
          },
        }),
      ),
    )
      .post('/copilot/device-auth')
      .send({});

    assert.equal(cliMissingRes.status, 200);
    assert.deepEqual(cliMissingRes.body, {
      provider: 'copilot',
      state: 'unavailable_before_start',
      reason: 'copilot not found',
    });

    const unwritableRes = await supertest(
      buildApp(
        withDeps({
          ensureCopilotAuthFileStore: async () => {
            throw new Error('copilot config persistence unavailable');
          },
        }),
      ),
    )
      .post('/copilot/device-auth')
      .send({});

    assert.equal(unwritableRes.status, 200);
    assert.deepEqual(unwritableRes.body, {
      provider: 'copilot',
      state: 'unavailable_before_start',
      reason: 'copilot config persistence unavailable',
    });

    const plaintextRes = await supertest(
      buildApp(
        withDeps({
          ensureCopilotPlaintextTokenStorage: async () => {
            throw new Error('EACCES: config.json');
          },
        }),
      ),
    )
      .post('/copilot/device-auth')
      .send({});

    assert.equal(plaintextRes.status, 200);
    assert.deepEqual(plaintextRes.body, {
      provider: 'copilot',
      state: 'unavailable_before_start',
      reason: 'copilot config persistence unavailable',
    });

    const malformedConfigRes = await supertest(
      buildApp(
        withDeps({
          ensureCopilotPlaintextTokenStorage: async () => {
            throw new Error('copilot config.json is malformed');
          },
        }),
      ),
    )
      .post('/copilot/device-auth')
      .send({});

    assert.equal(malformedConfigRes.status, 200);
    assert.deepEqual(malformedConfigRes.body, {
      provider: 'copilot',
      state: 'unavailable_before_start',
      reason: 'copilot config persistence unavailable',
    });
  });

  test('CODEINFO_COPILOT_CLI_PATH keeps the route available when PATH lookup is unavailable', async () => {
    const runCopilotDeviceAuth = mock.fn(async () =>
      buildDeviceAuthResult(verificationReadyResult()),
    );

    const res = await supertest(
      buildApp(
        withDeps({
          resolveCopilotCli: (env) => ({
            available: true,
            cliPath: env?.CODEINFO_COPILOT_CLI_PATH,
          }),
          runCopilotDeviceAuth,
          env: {
            CODEINFO_COPILOT_CLI_PATH: '/opt/copilot/bin/copilot',
          },
        }),
      ),
    )
      .post('/copilot/device-auth')
      .send({});

    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'verification_ready');
    assert.equal(runCopilotDeviceAuth.mock.calls.length, 1);
    const firstCallArgs = runCopilotDeviceAuth.mock.calls[0]
      ?.arguments as unknown[];
    assert.equal(
      (firstCallArgs[0] as { cliPath?: string } | undefined)?.cliPath,
      '/opt/copilot/bin/copilot',
    );
  });

  test('device-auth completion that cannot produce reusable auth is cleared for a fresh retry', async () => {
    const app = buildApp(
      withDeps({
        env: { HOME: '/tmp/test-home' },
      }),
    );
    const res = await supertest(app).post('/copilot/device-auth').send({});

    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'verification_ready');

    await new Promise((resolve) => setImmediate(resolve));

    const second = await supertest(app).post('/copilot/device-auth').send({});

    assert.equal(second.status, 200);
    assert.equal(second.body.state, 'verification_ready');
    assert.equal(second.body.userCode, 'ABCD-EFGH');
  });

  test('terminal failed state is cleared for retry while completion-pending state is still reused', async () => {
    const pendingResponse = createCopilotVerificationReadyResponse({
      verificationUrl: 'https://github.com/login/device',
      userCode: 'PENDING-CODE',
      displayOutput:
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code PENDING-CODE',
    });
    const pendingRun = mock.fn(async () =>
      buildDeviceAuthResult(
        pendingResponse,
        createCopilotCompletionPendingResponse(pendingResponse),
      ),
    );
    const pendingApp = buildApp(
      withDeps({
        runCopilotDeviceAuth: pendingRun,
        readDeviceAuthState: async () => ({ status: 'completion_pending' }),
      }),
    );

    const pendingFirst = await supertest(pendingApp)
      .post('/copilot/device-auth')
      .send({});
    assert.equal(pendingFirst.status, 200);
    assert.equal(pendingFirst.body.userCode, 'PENDING-CODE');

    await new Promise((resolve) => setImmediate(resolve));

    const pendingSecond = await supertest(pendingApp)
      .post('/copilot/device-auth')
      .send({});
    assert.equal(pendingSecond.status, 200);
    assert.equal(pendingSecond.body.state, 'completion_pending');
    assert.equal(pendingSecond.body.userCode, 'PENDING-CODE');
    assert.equal(pendingRun.mock.calls.length, 1);

    const firstExpiredResponse = createCopilotVerificationReadyResponse({
      verificationUrl: 'https://github.com/login/device',
      userCode: 'EXPIRED-OLD',
      displayOutput:
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code EXPIRED-OLD',
    });
    const retriedResponse = createCopilotVerificationReadyResponse({
      verificationUrl: 'https://github.com/login/device',
      userCode: 'EXPIRED-NEW',
      displayOutput:
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code EXPIRED-NEW',
    });
    let retryCallCount = 0;
    const retryRun = mock.fn(async () => {
      retryCallCount += 1;
      if (retryCallCount === 1) {
        return buildDeviceAuthResult(
          firstExpiredResponse,
          createCopilotFailedResponse('device code expired or was declined'),
        );
      }
      return buildDeviceAuthResult(
        retriedResponse,
        createCopilotCompletionPendingResponse(retriedResponse),
      );
    });
    const retryApp = buildApp(
      withDeps({
        runCopilotDeviceAuth: retryRun,
      }),
    );

    const retryFirst = await supertest(retryApp)
      .post('/copilot/device-auth')
      .send({});
    assert.equal(retryFirst.status, 200);
    assert.equal(retryFirst.body.userCode, 'EXPIRED-OLD');

    await new Promise((resolve) => setImmediate(resolve));

    const retrySecond = await supertest(retryApp)
      .post('/copilot/device-auth')
      .send({});
    assert.equal(retrySecond.status, 200);
    assert.equal(retrySecond.body.state, 'verification_ready');
    assert.equal(retrySecond.body.userCode, 'EXPIRED-NEW');
    assert.equal(retryRun.mock.calls.length, 2);
  });

  test('completion-pending state is reused even when no device-auth state reader is injected', async () => {
    const pendingResponse = createCopilotVerificationReadyResponse({
      verificationUrl: 'https://github.com/login/device',
      userCode: 'PERSIST-CODE',
      displayOutput:
        'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code PERSIST-CODE',
    });
    const pendingRun = mock.fn(async () =>
      buildDeviceAuthResult(
        pendingResponse,
        createCopilotCompletionPendingResponse(pendingResponse),
      ),
    );
    const pendingApp = buildApp(
      withDeps({
        runCopilotDeviceAuth: pendingRun,
      }),
    );

    const first = await supertest(pendingApp)
      .post('/copilot/device-auth')
      .send({});
    assert.equal(first.status, 200);
    assert.equal(first.body.state, 'verification_ready');

    await new Promise((resolve) => setImmediate(resolve));

    const second = await supertest(pendingApp)
      .post('/copilot/device-auth')
      .send({});
    assert.equal(second.status, 200);
    assert.equal(second.body.state, 'completion_pending');
    assert.equal(second.body.userCode, 'PERSIST-CODE');
    assert.equal(pendingRun.mock.calls.length, 1);
  });
});

describe('runCopilotDeviceAuth', () => {
  test('uses the resolved CODEINFO_COPILOT_CLI_PATH when no explicit cliPath argument is provided', async () => {
    const commandCalls: Array<{ command: string; args: string[] }> = [];
    const spawnFn = createSpawnStub(commandCalls);

    const result = await runCopilotDeviceAuth({
      env: {
        CODEINFO_COPILOT_HOME: '/tmp/copilot-home',
        CODEINFO_COPILOT_CLI_PATH: '/opt/copilot/bin/copilot',
      },
      spawnFn: spawnFn as unknown as typeof spawn,
    });

    assert.equal(result.state, 'verification_ready');
    assert.deepEqual(commandCalls, [
      {
        command: '/opt/copilot/bin/copilot',
        args: ['login', '--config-dir', '/tmp/copilot-home'],
      },
    ]);
  });

  test('parses verification instructions that arrive on stderr', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const spawnFn = mock.fn(() => child);

    const runPromise = runCopilotDeviceAuth({
      spawnFn: spawnFn as unknown as typeof spawn,
    });

    child.stderr.write(
      'To continue signing in with GitHub Copilot:\n' +
        '1. Open https://github.com/login/device\n' +
        '2. Enter one-time code STDERR-CODE\n',
    );
    child.emit('close', 0);

    const result = await runPromise;
    assert.equal(result.state, 'verification_ready');
    assert.equal(result.userCode, 'STDERR-CODE');
    assert.equal(result.verificationUrl, 'https://github.com/login/device');
  });
});
