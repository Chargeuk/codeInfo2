import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

import express from 'express';
import supertest from 'supertest';

import type { CodexDetection } from '../../providers/codexRegistry.js';
import { createCodexDeviceAuthRouter } from '../../routes/codexDeviceAuth.js';
import type {
  CodexDeviceAuthCompletion,
  CodexDeviceAuthResult,
  CodexDeviceAuthResultWithCompletion,
} from '../../utils/codexDeviceAuth.js';

function buildApp(deps?: Parameters<typeof createCodexDeviceAuthRouter>[0]) {
  const app = express();
  app.use('/codex', createCodexDeviceAuthRouter(deps));
  return app;
}

const defaultDetection: CodexDetection = {
  available: true,
  authPresent: true,
  configPresent: true,
};

type DeviceAuthResult = CodexDeviceAuthResultWithCompletion;

function buildDeviceAuthResult(
  result: CodexDeviceAuthResult,
  exitCode = result.ok ? 0 : 1,
): DeviceAuthResult {
  return {
    ...result,
    completion: Promise.resolve({ exitCode, result }),
  };
}

function withDeps(
  overrides?: Partial<Parameters<typeof createCodexDeviceAuthRouter>[0]>,
): Parameters<typeof createCodexDeviceAuthRouter>[0] {
  return {
    discoverAgents: async () => [],
    propagateAgentAuthFromPrimary: async () => ({ agentCount: 0 }),
    refreshCodexDetection: () => defaultDetection,
    getCodexHome: () => '/tmp/codex-home',
    ensureCodexAuthFileStore: async (configPath: string) => ({
      changed: false,
      configPath,
    }),
    getCodexConfigPathForHome: (home: string) => `${home}/config.toml`,
    runCodexDeviceAuth: async () =>
      buildDeviceAuthResult({
        ok: true,
        rawOutput: 'Open https://device.test/verify and enter code CODE-123.',
      }),
    resolveCodexCli: () => ({ available: true }),
    ...overrides,
  };
}

describe('POST /codex/device-auth', () => {
  test('returns verification data for empty object request', async () => {
    let receivedHome: string | undefined;
    const res = await supertest(
      buildApp(
        withDeps({
          runCodexDeviceAuth: async (params) => {
            receivedHome = params?.codexHome;
            return buildDeviceAuthResult({
              ok: true,
              rawOutput:
                'Open https://device.test/verify and enter code CODE-123.',
            });
          },
        }),
      ),
    )
      .post('/codex/device-auth')
      .send({});

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(
      res.body.rawOutput,
      'Open https://device.test/verify and enter code CODE-123.',
    );
    assert.equal(receivedHome, undefined);
  });

  test('selector fields are rejected with 400 invalid_request', async () => {
    const payloads = [
      { target: 'chat' },
      { target: 'agent' },
      { target: 'agent', agentName: 'coding_agent' },
      { agentName: 'coding_agent' },
    ];
    for (const payload of payloads) {
      const res = await supertest(buildApp())
        .post('/codex/device-auth')
        .send(payload);
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, {
        error: 'invalid_request',
        message: 'request body must be an empty JSON object',
      });
    }
  });

  test('unknown non-empty fields are rejected with 400 invalid_request', async () => {
    const res = await supertest(buildApp())
      .post('/codex/device-auth')
      .send({ foo: 'bar' });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: 'invalid_request',
      message: 'request body must be an empty JSON object',
    });
  });

  test('non-object bodies are rejected with deterministic invalid_request payload', async () => {
    const payloads: unknown[] = [null, [], 'hello', 123];
    for (const payload of payloads) {
      const res = await supertest(buildApp())
        .post('/codex/device-auth')
        .set('content-type', 'application/json')
        .send(JSON.stringify(payload));
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, {
        error: 'invalid_request',
        message: 'request body must be an empty JSON object',
      });
    }
  });

  test('codex unavailable returns 503 codex_unavailable payload', async () => {
    const res = await supertest(
      buildApp(
        withDeps({
          resolveCodexCli: () => ({
            available: false,
            reason: 'codex not found',
          }),
          runCodexDeviceAuth: async () => {
            throw new Error('should not run');
          },
        }),
      ),
    )
      .post('/codex/device-auth')
      .send({});

    assert.equal(res.status, 503);
    assert.deepEqual(res.body, {
      error: 'codex_unavailable',
      reason: 'codex not found',
    });
  });

  test('device-auth parse error returns 400 invalid_request', async () => {
    const res = await supertest(
      buildApp(
        withDeps({
          runCodexDeviceAuth: async () =>
            buildDeviceAuthResult({
              ok: false,
              message: 'device auth output not recognized',
            }),
        }),
      ),
    )
      .post('/codex/device-auth')
      .send({});

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: 'invalid_request',
      message: 'device auth output not recognized',
    });
  });

  test('oversized payload returns standardized invalid_request contract', async () => {
    const prevLimit = process.env.LOG_MAX_CLIENT_BYTES;
    process.env.LOG_MAX_CLIENT_BYTES = '10';
    try {
      const res = await supertest(buildApp())
        .post('/codex/device-auth')
        .send({ extra: 'toolarge' });

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, {
        error: 'invalid_request',
        message: 'request body exceeds maximum size',
      });
      assert.equal('reason' in res.body, false);
      assert.equal(res.body.error === 'payload too large', false);
    } finally {
      if (prevLimit === undefined) {
        delete process.env.LOG_MAX_CLIENT_BYTES;
      } else {
        process.env.LOG_MAX_CLIENT_BYTES = prevLimit;
      }
    }
  });

  test('propagates auth only after completion resolves', async () => {
    let resolveCompletion!: (value: CodexDeviceAuthCompletion) => void;
    const completion = new Promise<CodexDeviceAuthCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const successResult = {
      ok: true,
      rawOutput: 'Open https://device.test/verify and enter code CODE-123.',
    } as const satisfies CodexDeviceAuthResult;
    const propagateAgentAuthFromPrimary = mock.fn(async () => ({
      agentCount: 1,
    }));
    const refreshCodexDetection = mock.fn(() => defaultDetection);

    const res = await supertest(
      buildApp(
        withDeps({
          propagateAgentAuthFromPrimary,
          refreshCodexDetection,
          runCodexDeviceAuth: async () => ({
            ...successResult,
            completion,
          }),
        }),
      ),
    )
      .post('/codex/device-auth')
      .send({});

    assert.equal(res.status, 200);
    assert.equal(propagateAgentAuthFromPrimary.mock.calls.length, 0);
    assert.equal(refreshCodexDetection.mock.calls.length, 0);

    resolveCompletion({ exitCode: 0, result: successResult });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(propagateAgentAuthFromPrimary.mock.calls.length, 1);
    assert.equal(refreshCodexDetection.mock.calls.length, 1);
  });

  test('overlapping requests reuse one auth run and keep side effects idempotent', async () => {
    let resolveRun!: (value: DeviceAuthResult) => void;
    const runPromise = new Promise<DeviceAuthResult>((resolve) => {
      resolveRun = resolve;
    });
    let resolveCompletion!: (value: CodexDeviceAuthCompletion) => void;
    const completion = new Promise<CodexDeviceAuthCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const successResult = {
      ok: true,
      rawOutput: 'Open https://device.test/verify and enter code CODE-123.',
    } as const satisfies CodexDeviceAuthResult;
    const runCodexDeviceAuth = mock.fn(async () => runPromise);
    const propagateAgentAuthFromPrimary = mock.fn(async () => ({
      agentCount: 2,
    }));
    const refreshCodexDetection = mock.fn(() => defaultDetection);
    const app = buildApp(
      withDeps({
        runCodexDeviceAuth,
        propagateAgentAuthFromPrimary,
        refreshCodexDetection,
      }),
    );

    const reqA = supertest(app)
      .post('/codex/device-auth')
      .send({})
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const reqB = supertest(app)
      .post('/codex/device-auth')
      .send({})
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 25));

    resolveRun({
      ...successResult,
      completion,
    });
    const [resA, resB] = await Promise.all([reqA, reqB]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.deepEqual(resA.body, resB.body);
    assert.equal(runCodexDeviceAuth.mock.calls.length, 1);
    assert.equal(propagateAgentAuthFromPrimary.mock.calls.length, 0);
    assert.equal(refreshCodexDetection.mock.calls.length, 0);

    resolveCompletion({ exitCode: 0, result: successResult });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(propagateAgentAuthFromPrimary.mock.calls.length, 1);
    assert.equal(refreshCodexDetection.mock.calls.length, 1);
  });

  test('emits deterministic T10 success log for strict contract happy path', async () => {
    const infoMock = mock.method(console, 'info', () => {});
    try {
      const res = await supertest(buildApp(withDeps()))
        .post('/codex/device-auth')
        .send({});
      assert.equal(res.status, 200);
      const successCall = infoMock.mock.calls.find(
        (call) =>
          typeof call.arguments[0] === 'string' &&
          call.arguments[0].startsWith(
            '[DEV-0000037][T10] event=device_auth_contract_validated result=success',
          ),
      );
      assert.ok(successCall);
    } finally {
      infoMock.mock.restore();
    }
  });

  test('emits deterministic T10 error log for strict contract failures', async () => {
    const errorMock = mock.method(console, 'error', () => {});
    try {
      const res = await supertest(buildApp())
        .post('/codex/device-auth')
        .send({ target: 'chat' });
      assert.equal(res.status, 400);
      const errorCall = errorMock.mock.calls.find(
        (call) =>
          typeof call.arguments[0] === 'string' &&
          call.arguments[0].startsWith(
            '[DEV-0000037][T10] event=device_auth_contract_validated result=error',
          ),
      );
      assert.ok(errorCall);
    } finally {
      errorMock.mock.restore();
    }
  });

  test('device-auth error logs remain secret-safe and exclude raw token-like output', async () => {
    const secretLikeToken = 'sk-test-secret-token-should-not-leak';
    const errorMock = mock.method(console, 'error', () => {});
    try {
      const res = await supertest(
        buildApp(
          withDeps({
            runCodexDeviceAuth: async () =>
              buildDeviceAuthResult({
                ok: false,
                message: `${secretLikeToken} device auth command failed`,
              }),
          }),
        ),
      )
        .post('/codex/device-auth')
        .send({});

      assert.equal(res.status, 503);
      const loggedLines = errorMock.mock.calls
        .map((call) => call.arguments.map(String).join(' '))
        .join('\n');
      assert.equal(loggedLines.includes(secretLikeToken), false);
      assert.equal(
        loggedLines.includes(
          '[DEV-0000037][T10] event=device_auth_contract_validated result=error',
        ),
        true,
      );
    } finally {
      errorMock.mock.restore();
    }
  });

  test('emits deterministic T11 success log after completion side effects', async () => {
    let resolveCompletion!: (value: CodexDeviceAuthCompletion) => void;
    const completion = new Promise<CodexDeviceAuthCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const successResult = {
      ok: true,
      rawOutput: 'Open https://device.test/verify and enter code CODE-123.',
    } as const satisfies CodexDeviceAuthResult;
    const infoMock = mock.method(console, 'info', () => {});
    try {
      const res = await supertest(
        buildApp(
          withDeps({
            runCodexDeviceAuth: async () => ({
              ...successResult,
              completion,
            }),
          }),
        ),
      )
        .post('/codex/device-auth')
        .send({});
      assert.equal(res.status, 200);

      resolveCompletion({ exitCode: 0, result: successResult });
      await new Promise((resolve) => setImmediate(resolve));

      const successCall = infoMock.mock.calls.find(
        (call) =>
          typeof call.arguments[0] === 'string' &&
          call.arguments[0].startsWith(
            '[DEV-0000037][T11] event=device_auth_concurrency_and_side_effects_completed result=success',
          ),
      );
      assert.ok(successCall);
    } finally {
      infoMock.mock.restore();
    }
  });

  test('emits deterministic T11 error log for completion side-effect failures', async () => {
    const errorMock = mock.method(console, 'error', () => {});
    try {
      const res = await supertest(
        buildApp(
          withDeps({
            runCodexDeviceAuth: async () =>
              buildDeviceAuthResult({
                ok: false,
                message: 'device auth command failed',
              }),
          }),
        ),
      )
        .post('/codex/device-auth')
        .send({});
      assert.equal(res.status, 503);
      await new Promise((resolve) => setImmediate(resolve));
      const errorCall = errorMock.mock.calls.find(
        (call) =>
          typeof call.arguments[0] === 'string' &&
          call.arguments[0].startsWith(
            '[DEV-0000037][T11] event=device_auth_concurrency_and_side_effects_completed result=error',
          ),
      );
      assert.ok(errorCall);
    } finally {
      errorMock.mock.restore();
    }
  });
});
