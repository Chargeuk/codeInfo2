import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { resolveChatDefaults } from '../../config/chatDefaults.js';

const ENV_KEYS = ['CHAT_DEFAULT_PROVIDER', 'CHAT_DEFAULT_MODEL'] as const;
const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  ENV_KEYS.forEach((key) => {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  });
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

test('explicit values win', () => {
  process.env.CHAT_DEFAULT_PROVIDER = 'lmstudio';
  process.env.CHAT_DEFAULT_MODEL = 'env-model';

  const result = resolveChatDefaults({
    requestProvider: 'codex',
    requestModel: 'request-model',
  });

  assert.equal(result.provider, 'codex');
  assert.equal(result.model, 'request-model');
  assert.equal(result.providerSource, 'request');
  assert.equal(result.modelSource, 'request');
});

test('env values apply when explicit values are missing', () => {
  process.env.CHAT_DEFAULT_PROVIDER = 'lmstudio';
  process.env.CHAT_DEFAULT_MODEL = 'env-model';

  const result = resolveChatDefaults({});

  assert.equal(result.provider, 'lmstudio');
  assert.equal(result.model, 'env-model');
  assert.equal(result.providerSource, 'env');
  assert.equal(result.modelSource, 'env');
});

test('hardcoded fallback applies when env is missing or invalid', () => {
  process.env.CHAT_DEFAULT_PROVIDER = 'invalid-provider';
  process.env.CHAT_DEFAULT_MODEL = '   ';

  const result = resolveChatDefaults({});

  assert.equal(result.provider, 'codex');
  assert.equal(result.model, 'gpt-5.3-codex');
  assert.equal(result.providerSource, 'fallback');
  assert.equal(result.modelSource, 'fallback');
});

test('partial env override resolves missing fields via fallback', () => {
  process.env.CHAT_DEFAULT_PROVIDER = 'lmstudio';

  const result = resolveChatDefaults({});

  assert.equal(result.provider, 'lmstudio');
  assert.equal(result.model, 'gpt-5.3-codex');
  assert.equal(result.providerSource, 'env');
  assert.equal(result.modelSource, 'fallback');
});

test('invalid and empty env values are ignored', () => {
  process.env.CHAT_DEFAULT_PROVIDER = '';
  process.env.CHAT_DEFAULT_MODEL = '';

  const result = resolveChatDefaults({});

  assert.equal(result.provider, 'codex');
  assert.equal(result.model, 'gpt-5.3-codex');
  assert.equal(result.providerSource, 'fallback');
  assert.equal(result.modelSource, 'fallback');
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('CHAT_DEFAULT_PROVIDER is empty'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes('CHAT_DEFAULT_MODEL is empty'),
    ),
  );
});
