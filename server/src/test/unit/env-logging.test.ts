import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOpenAiEmbeddingCapabilityState } from '../../config/startupEnv.js';

test('capability state enables when CODEINFO_OPENAI_EMBEDDING_KEY is populated', () => {
  const secret = 'sk-secret-test-value';
  const state = resolveOpenAiEmbeddingCapabilityState({
    CODEINFO_OPENAI_EMBEDDING_KEY: secret,
  });

  assert.deepEqual(state, { enabled: true });
  assert.equal(JSON.stringify(state).includes(secret), false);
});

test('capability state disables when CODEINFO_OPENAI_EMBEDDING_KEY is missing or empty', () => {
  const missing = resolveOpenAiEmbeddingCapabilityState({});
  const empty = resolveOpenAiEmbeddingCapabilityState({
    CODEINFO_OPENAI_EMBEDDING_KEY: '   ',
  });

  assert.deepEqual(missing, { enabled: false });
  assert.deepEqual(empty, { enabled: false });
});
