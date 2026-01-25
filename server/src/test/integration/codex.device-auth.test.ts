import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

import express from 'express';
import supertest from 'supertest';

import type { DiscoveredAgent } from '../../agents/types.js';
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
        verificationUrl: 'https://device.test/verify',
        userCode: 'CODE-123',
      }),
    resolveCodexCli: () => ({ available: true }),
    ...overrides,
  };
}

function makeAgent(name: string, home = '/tmp/agent-home'): DiscoveredAgent {
  return {
    name,
    home,
    configPath: `${home}/config.toml`,
    description: undefined,
    descriptionPath: undefined,
    systemPromptPath: undefined,
    warnings: undefined,
  };
}

describe('POST /codex/device-auth', () => {
  test('returns verification data for chat target', async () => {
    let receivedHome: string | undefined;
    const res = await supertest(
      buildApp(
        withDeps({
          discoverAgents: async () => [makeAgent('coding_agent')],
          runCodexDeviceAuth: async (params) => {
            receivedHome = params?.codexHome;
            return buildDeviceAuthResult({
              ok: true,
              verificationUrl: 'https://device.test/verify',
              userCode: 'CODE-123',
              expiresInSec: 600,
            });
          },
        }),
      ),
    )
      .post('/codex/device-auth')
      .send({ target: 'chat' });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'completed');
    assert.equal(res.body.target, 'chat');
    assert.equal(res.body.verificationUrl, 'https://device.test/verify');
    assert.equal(res.body.userCode, 'CODE-123');
    assert.equal(res.body.expiresInSec, 600);
    assert.equal(receivedHome, undefined);
  });

  test('unknown agentName returns 404', async () => {
    const res = await supertest(
      buildApp(
        withDeps({
          discoverAgents: async () => [makeAgent('known_agent')],
          runCodexDeviceAuth: async () => {
            throw new Error('should not run');
          },
        }),
      ),
    )
      .post('/codex/device-auth')
      .send({ target: 'agent', agentName: 'missing' });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'not_found' });
  });

  test('missing target returns 400 invalid_request', async () => {
    const res = await supertest(buildApp()).post('/codex/device-auth').send({});

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  });

  test('unsupported target returns 400 invalid_request', async () => {
    const res = await supertest(buildApp())
      .post('/codex/device-auth')
      .send({ target: 'other' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  });

  test('missing agentName returns 400 invalid_request', async () => {
    const res = await supertest(buildApp())
      .post('/codex/device-auth')
      .send({ target: 'agent' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  });

  test('codex unavailable returns 503', async () => {
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
      .send({ target: 'chat' });

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
      .send({ target: 'chat' });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: 'invalid_request',
      message: 'device auth output not recognized',
    });
  });

  test('oversized payload returns 400 payload too large', async () => {
    const prevLimit = process.env.LOG_MAX_CLIENT_BYTES;
    process.env.LOG_MAX_CLIENT_BYTES = '10';
    try {
      const res = await supertest(buildApp())
        .post('/codex/device-auth')
        .send({ target: 'chat', extra: 'toolarge' });

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: 'payload too large' });
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
      verificationUrl: 'https://device.test/verify',
      userCode: 'CODE-123',
    } as const satisfies CodexDeviceAuthResult;
    const propagateAgentAuthFromPrimary = mock.fn(async () => ({
      agentCount: 1,
    }));
    const refreshCodexDetection = mock.fn(() => defaultDetection);

    const res = await supertest(
      buildApp(
        withDeps({
          discoverAgents: async () => [makeAgent('coding_agent')],
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
      .send({ target: 'chat' });

    assert.equal(res.status, 200);
    assert.equal(propagateAgentAuthFromPrimary.mock.calls.length, 0);
    assert.equal(refreshCodexDetection.mock.calls.length, 0);

    resolveCompletion({ exitCode: 0, result: successResult });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(propagateAgentAuthFromPrimary.mock.calls.length, 1);
    assert.equal(refreshCodexDetection.mock.calls.length, 1);
  });
});
