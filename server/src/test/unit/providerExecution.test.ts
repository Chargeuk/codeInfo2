import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOpenAiCompatEndpointById } from '../../chat/providerExecution.js';

test('resolveOpenAiCompatEndpointById prefers the configured endpoint over env when endpoint ids match', () => {
  const resolved = resolveOpenAiCompatEndpointById({
    provider: 'codex',
    endpointId: 'https://example.com/v1',
    configuredEndpoint: {
      endpointId: 'https://example.com/v1',
      baseUrl: 'https://example.com/v1',
      capabilities: ['responses'],
      displayLabel: 'Pinned endpoint',
    },
    env: {
      ...process.env,
      CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
        'EnvEndpoint,https://example.com/v1|responses,completions',
    },
  });

  assert.deepEqual(resolved, {
    endpointId: 'https://example.com/v1',
    baseUrl: 'https://example.com/v1',
    capabilities: ['responses'],
    displayLabel: 'Pinned endpoint',
  });
});
