import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { getCodexEnvDefaults } from '../../config/codexEnvDefaults.js';

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

test('valid env values map into defaults', () => {
  setEnv({
    Codex_sandbox_mode: 'workspace-write',
    Codex_approval_policy: 'on-request',
    Codex_reasoning_effort: 'medium',
    Codex_network_access_enabled: 'true',
    Codex_web_search_enabled: 'false',
  });

  const { defaults, warnings } = getCodexEnvDefaults();

  assert.deepEqual(defaults, {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    modelReasoningEffort: 'medium',
    networkAccessEnabled: true,
    webSearchEnabled: false,
  });
  assert.equal(warnings.length, 0);
});

test('missing env values fall back without warnings', () => {
  const { defaults, warnings } = getCodexEnvDefaults();

  assert.deepEqual(defaults, {
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'on-failure',
    modelReasoningEffort: 'high',
    networkAccessEnabled: true,
    webSearchEnabled: true,
  });
  assert.equal(warnings.length, 0);
});

test('invalid enum values and empty strings warn + fall back', () => {
  setEnv({
    Codex_sandbox_mode: 'invalid-mode',
    Codex_approval_policy: 'nope',
    Codex_reasoning_effort: '   ',
    Codex_network_access_enabled: 'false',
  });

  const { defaults, warnings } = getCodexEnvDefaults();

  assert.equal(defaults.sandboxMode, 'danger-full-access');
  assert.equal(defaults.approvalPolicy, 'on-failure');
  assert.equal(defaults.modelReasoningEffort, 'high');
  assert.ok(
    warnings.some((warning) =>
      warning.includes('Codex_sandbox_mode must be one of'),
    ),
  );
  assert.ok(
    warnings.some((warning) =>
      warning.includes('Codex_approval_policy must be one of'),
    ),
  );
  assert.ok(
    warnings.some((warning) =>
      warning.includes('Codex_reasoning_effort is empty'),
    ),
  );
});

test('boolean parsing handles valid and invalid values', () => {
  setEnv({
    Codex_sandbox_mode: 'workspace-write',
    Codex_network_access_enabled: 'TRUE',
    Codex_web_search_enabled: 'not-bool',
  });

  const { defaults, warnings } = getCodexEnvDefaults();

  assert.equal(defaults.networkAccessEnabled, true);
  assert.equal(defaults.webSearchEnabled, true);
  assert.ok(
    warnings.some((warning) =>
      warning.includes('Codex_web_search_enabled must be "true" or "false"'),
    ),
  );
});

test('network access warning appears outside workspace-write', () => {
  setEnv({
    Codex_sandbox_mode: 'danger-full-access',
    Codex_network_access_enabled: 'true',
  });

  const { warnings } = getCodexEnvDefaults();

  assert.ok(
    warnings.some((warning) =>
      warning.includes('network access requires workspace-write mode'),
    ),
  );
});
