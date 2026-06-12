import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldIgnoreAutoLoggedRequest } from '../../logger.js';

test('request auto-logging ignores internal OpenAI-compatible proxy routes', () => {
  assert.equal(
    shouldIgnoreAutoLoggedRequest(
      '/internal/openai-compat/proxy-secret/codex/endpoint-token/v1/models',
    ),
    true,
  );
});

test('request auto-logging keeps ordinary API routes visible', () => {
  assert.equal(shouldIgnoreAutoLoggedRequest('/chat/providers'), false);
});
