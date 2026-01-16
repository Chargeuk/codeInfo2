import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { validateChatRequest } from '../../routes/chatValidators.js';

const ENV_KEYS = [
  'Codex_sandbox_mode',
  'Codex_approval_policy',
  'Codex_reasoning_effort',
  'Codex_network_access_enabled',
  'Codex_web_search_enabled',
];

const originalEnv = new Map<string, string | undefined>();

const setEnv = (values: Record<string, string | undefined>) => {
  ENV_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const value = values[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
};

beforeEach(() => {
  ENV_KEYS.forEach((key) => {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  });
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
});

test('env defaults apply when Codex flags are omitted', () => {
  setEnv({
    Codex_sandbox_mode: 'read-only',
    Codex_approval_policy: 'never',
    Codex_reasoning_effort: 'low',
    Codex_network_access_enabled: 'false',
    Codex_web_search_enabled: 'true',
  });

  const result = validateChatRequest({
    model: 'gpt-5.1-codex-max',
    message: 'hello',
    conversationId: 'c1',
    provider: 'codex',
  });

  assert.deepEqual(result.codexFlags, {
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    modelReasoningEffort: 'low',
    networkAccessEnabled: false,
    webSearchEnabled: true,
  });
  assert.equal(result.warnings.length, 0);
});

test('explicit Codex flags override env defaults', () => {
  setEnv({
    Codex_sandbox_mode: 'read-only',
    Codex_approval_policy: 'never',
    Codex_reasoning_effort: 'low',
    Codex_network_access_enabled: 'false',
    Codex_web_search_enabled: 'false',
  });

  const result = validateChatRequest({
    model: 'gpt-5.1-codex-max',
    message: 'hello',
    conversationId: 'c2',
    provider: 'codex',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-failure',
    modelReasoningEffort: 'high',
    networkAccessEnabled: true,
    webSearchEnabled: true,
  });

  assert.deepEqual(result.codexFlags, {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-failure',
    modelReasoningEffort: 'high',
    networkAccessEnabled: true,
    webSearchEnabled: true,
  });
  assert.equal(result.warnings.length, 0);
});

test('non-Codex validation ignores env defaults', () => {
  setEnv({
    Codex_sandbox_mode: 'read-only',
    Codex_network_access_enabled: 'false',
  });

  const result = validateChatRequest({
    model: 'model-1',
    message: 'hello',
    conversationId: 'c3',
    provider: 'lmstudio',
  });

  assert.deepEqual(result.codexFlags, {});
  assert.equal(result.warnings.length, 0);
});

test('non-Codex provider emits warnings for Codex-only flags', () => {
  const result = validateChatRequest({
    model: 'model-2',
    message: 'hello',
    conversationId: 'c4',
    provider: 'lmstudio',
    sandboxMode: 'read-only',
    approvalPolicy: 'on-request',
    modelReasoningEffort: 'medium',
    networkAccessEnabled: false,
    webSearchEnabled: true,
  });

  assert.equal(result.codexFlags.sandboxMode, undefined);
  assert.equal(result.warnings.length, 5);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('sandboxMode is Codex-only'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('approvalPolicy is Codex-only'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('modelReasoningEffort is Codex-only'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('networkAccessEnabled is Codex-only'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('webSearchEnabled is Codex-only'),
    ),
  );
});
