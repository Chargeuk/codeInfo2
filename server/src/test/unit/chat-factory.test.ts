import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getChatInterface,
  UnsupportedProviderError,
} from '../../chat/factory.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import type { CopilotRuntimeClient } from '../../chat/copilotLifecycle.js';

test('returns codex chat interface instance', () => {
  const chat = getChatInterface('codex');
  assert.ok(chat instanceof ChatInterface);
});

test('returns lmstudio chat interface instance', () => {
  const chat = getChatInterface('lmstudio');
  assert.ok(chat instanceof ChatInterface);
});

test('throws for unsupported provider', () => {
  assert.throws(
    () => getChatInterface('unknown'),
    (err: unknown) =>
      err instanceof UnsupportedProviderError &&
      err.message.includes('Unsupported chat provider'),
  );
});

test('forwards copilotEnv into the Copilot runtime factory', () => {
  let capturedCodeinfoRoot: string | undefined;
  const runtime: CopilotRuntimeClient = {
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
  };

  const chat = getChatInterface('copilot', {
    copilotEnv: { CODEINFO_ROOT: '/tmp/codeinfo-root' },
    copilotClientFactory: (options) => {
      capturedCodeinfoRoot = options.env?.CODEINFO_ROOT;
      return runtime;
    },
  });

  assert.ok(chat instanceof ChatInterface);
  assert.equal(capturedCodeinfoRoot, '/tmp/codeinfo-root');
});
