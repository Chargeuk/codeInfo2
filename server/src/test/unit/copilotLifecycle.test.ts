import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CopilotLifecycle,
  type CopilotRuntimeClient,
} from '../../chat/copilotLifecycle.js';

const createRuntimeStub = (
  overrides: Partial<CopilotRuntimeClient> = {},
): CopilotRuntimeClient => ({
  start: async () => undefined,
  stop: async () => [],
  ping: async (message?: string) => ({
    message: message ?? 'pong',
    timestamp: Date.now(),
  }),
  getAuthStatus: async () => ({
    isAuthenticated: true,
    authType: 'user',
  }),
  listModels: async () => [],
  createSession: async () => ({ sessionId: 'created-session' }) as never,
  resumeSession: async () => ({ sessionId: 'resumed-session' }) as never,
  ...overrides,
});

test('copilot lifecycle forwards start to the injected runtime', async () => {
  let started = 0;
  const lifecycle = new CopilotLifecycle({
    clientFactory: () =>
      createRuntimeStub({
        start: async () => {
          started += 1;
        },
      }),
  });

  await lifecycle.start();

  assert.equal(started, 1);
});

test('copilot lifecycle forwards stop to the injected runtime', async () => {
  let stopped = 0;
  const lifecycle = new CopilotLifecycle({
    clientFactory: () =>
      createRuntimeStub({
        stop: async () => {
          stopped += 1;
          return [];
        },
      }),
  });

  const errors = await lifecycle.stop();

  assert.equal(stopped, 1);
  assert.deepEqual(errors, []);
});

test('copilot lifecycle uses the injected dependency instead of a hidden singleton', async () => {
  const runtime = createRuntimeStub();
  const lifecycle = new CopilotLifecycle({
    clientFactory: () => runtime,
  });

  const authStatus = await lifecycle.getAuthStatus();

  assert.equal(authStatus.isAuthenticated, true);
});

test('copilot lifecycle passes an explicit cliPath override into the runtime factory', () => {
  let receivedCliPath: string | undefined;
  const lifecycle = new CopilotLifecycle({
    cliPath: '/custom/copilot',
    clientFactory: (options) => {
      receivedCliPath = options.cliPath;
      return createRuntimeStub();
    },
  });

  assert.equal(receivedCliPath, '/custom/copilot');
  assert.equal(lifecycle.cliMode, 'cliPath');
});

test('copilot lifecycle leaves cliPath undefined when PATH discovery should be used', () => {
  let receivedCliPath: string | undefined = 'unset';
  const lifecycle = new CopilotLifecycle({
    clientFactory: (options) => {
      receivedCliPath = options.cliPath;
      return createRuntimeStub();
    },
  });

  assert.equal(receivedCliPath, undefined);
  assert.equal(lifecycle.cliMode, 'path');
});

test('copilot lifecycle passes getAuthStatus through unchanged', async () => {
  const lifecycle = new CopilotLifecycle({
    clientFactory: () =>
      createRuntimeStub({
        getAuthStatus: async () => ({
          isAuthenticated: false,
          authType: 'gh-cli',
          statusMessage: 'login required',
        }),
      }),
  });

  const result = await lifecycle.getAuthStatus();

  assert.deepEqual(result, {
    isAuthenticated: false,
    authType: 'gh-cli',
    statusMessage: 'login required',
  });
});

test('copilot lifecycle propagates startup errors from the injected runtime', async () => {
  const lifecycle = new CopilotLifecycle({
    clientFactory: () =>
      createRuntimeStub({
        start: async () => {
          throw new Error('copilot failed to start');
        },
      }),
  });

  await assert.rejects(() => lifecycle.start(), /copilot failed to start/u);
});

test('copilot lifecycle injects configDir without dropping create-session tool and permission config', async () => {
  let capturedConfig: import('@github/copilot-sdk').SessionConfig | undefined;
  const lifecycle = new CopilotLifecycle({
    clientFactory: () =>
      createRuntimeStub({
        createSession: async (config) => {
          capturedConfig = config;
          return { sessionId: 'created-session' } as never;
        },
      }),
  });

  const onPermissionRequest = async () => ({ kind: 'approve-once' as const });
  await lifecycle.createSession({
    model: 'copilot-gpt-5',
    reasoningEffort: 'high',
    tools: [{ name: 'VectorSearch', handler: async () => 'ok' }],
    availableTools: ['VectorSearch'],
    onPermissionRequest,
  });

  assert.equal(capturedConfig?.configDir, lifecycle.configDir);
  assert.equal(capturedConfig?.reasoningEffort, 'high');
  assert.deepEqual(capturedConfig?.availableTools, ['VectorSearch']);
  assert.equal(capturedConfig?.onPermissionRequest, onPermissionRequest);
});

test('copilot lifecycle preserves resume-session tool and permission config while injecting configDir', async () => {
  let capturedResume:
    | import('@github/copilot-sdk').ResumeSessionConfig
    | undefined;
  const lifecycle = new CopilotLifecycle({
    clientFactory: () =>
      createRuntimeStub({
        resumeSession: async (_sessionId, config) => {
          capturedResume = config;
          return { sessionId: 'resumed-session' } as never;
        },
      }),
  });

  const onPermissionRequest = async () => ({ kind: 'approve-once' as const });
  await lifecycle.resumeSession('resume-session-1', {
    model: 'copilot-gpt-5',
    reasoningEffort: 'medium',
    tools: [{ name: 'ListIngestedRepositories', handler: async () => 'ok' }],
    availableTools: ['ListIngestedRepositories'],
    onPermissionRequest,
  });

  assert.equal(capturedResume?.configDir, lifecycle.configDir);
  assert.equal(capturedResume?.reasoningEffort, 'medium');
  assert.deepEqual(capturedResume?.availableTools, [
    'ListIngestedRepositories',
  ]);
  assert.equal(capturedResume?.onPermissionRequest, onPermissionRequest);
});
