import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

import express from 'express';
import supertest from 'supertest';

import { createCopilotDeviceAuthRouter } from '../../routes/copilotDeviceAuth.js';
import {
  createCopilotCompletedResponse,
  createCopilotVerificationReadyResponse,
  type CopilotDeviceAuthCompletion,
  type CopilotDeviceAuthResult,
  type CopilotDeviceAuthResultWithCompletion,
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

  test('missing-cli and unwritable-config failures surface clear unavailable-before-start reasons', async () => {
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
  });
});
