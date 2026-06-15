import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachOpenAiCompatEndpointKeys,
  normalizeOpenAiCompatEndpointLabelKey,
  parseOpenAiCompatEndpointConfig,
  resolveOpenAiCompatEndpointConfigsFromList,
  resolveOpenAiCompatEndpointKeysFromList,
  supportsOpenAiCompatBuiltInWebSearch,
} from '../../config/openaiCompatEndpoints.js';

test('accepts explicit http or https /v1 base URLs with normalized capabilities', () => {
  const parsed = parseOpenAiCompatEndpointConfig(
    ' https://LOCALHOST:1234/v1/ | RESPONSES, completions, responses ',
    { pathLabel: 'codeinfo_openai_endpoint' },
  );

  assert.equal(parsed.endpointId, 'https://localhost:1234/v1');
  assert.equal(parsed.baseUrl, 'https://localhost:1234/v1');
  assert.deepEqual(parsed.capabilities, ['responses', 'completions']);
});

test('rejects malformed URL strings that cannot normalize to an endpoint', () => {
  assert.throws(
    () =>
      parseOpenAiCompatEndpointConfig('not-a-url|responses', {
        pathLabel: 'codeinfo_openai_endpoint',
      }),
    /RUNTIME_CONFIG_INVALID: codeinfo_openai_endpoint: expected an explicit http or https \/v1 base URL/,
  );
});

test('rejects valid URLs whose normalized path does not end at /v1', () => {
  assert.throws(
    () =>
      parseOpenAiCompatEndpointConfig('https://example.com/v2|responses', {
        pathLabel: 'codeinfo_openai_endpoint',
      }),
    /RUNTIME_CONFIG_INVALID: codeinfo_openai_endpoint: the endpoint path must end at \/v1/,
  );
});

test('rejects query-string variants even when the base URL is otherwise valid', () => {
  assert.throws(
    () =>
      parseOpenAiCompatEndpointConfig(
        'https://example.com/v1?api_key=secret|responses',
        {
          pathLabel: 'codeinfo_openai_endpoint',
        },
      ),
    /RUNTIME_CONFIG_INVALID: codeinfo_openai_endpoint: query strings are not allowed on OpenAI-compatible endpoint URLs/,
  );
});

test('rejects fragment-bearing variants even when the base URL is otherwise valid', () => {
  assert.throws(
    () =>
      parseOpenAiCompatEndpointConfig('https://example.com/v1#frag|responses', {
        pathLabel: 'codeinfo_openai_endpoint',
      }),
    /RUNTIME_CONFIG_INVALID: codeinfo_openai_endpoint: fragments are not allowed on OpenAI-compatible endpoint URLs/,
  );
});

test('rejects credential-bearing endpoint URLs even when the base URL is otherwise valid', () => {
  assert.throws(
    () =>
      parseOpenAiCompatEndpointConfig(
        'https://user:secret@example.com/v1|responses',
        {
          pathLabel: 'codeinfo_openai_endpoint',
        },
      ),
    /RUNTIME_CONFIG_INVALID: codeinfo_openai_endpoint: credentials are not allowed on OpenAI-compatible endpoint URLs/,
  );
});

test('rejects unsupported capability names', () => {
  assert.throws(
    () =>
      parseOpenAiCompatEndpointConfig('https://example.com/v1|responses,foo', {
        pathLabel: 'codeinfo_openai_endpoint',
      }),
    /RUNTIME_CONFIG_INVALID: codeinfo_openai_endpoint: unsupported capability "foo"/,
  );
});

test('rejects entries that omit every supported capability token', () => {
  assert.throws(
    () =>
      parseOpenAiCompatEndpointConfig('https://example.com/v1| , ', {
        pathLabel: 'codeinfo_openai_endpoint',
      }),
    /RUNTIME_CONFIG_INVALID: codeinfo_openai_endpoint: at least one supported capability is required/,
  );
});

test('rejects blank codeinfo_openai_endpoint values', () => {
  assert.throws(
    () =>
      parseOpenAiCompatEndpointConfig('', {
        pathLabel: 'codeinfo_openai_endpoint',
      }),
    /RUNTIME_CONFIG_INVALID: codeinfo_openai_endpoint: expected an explicit http or https \/v1 base URL/,
  );
});

test('rejects whitespace-only codeinfo_openai_endpoint values', () => {
  assert.throws(
    () =>
      parseOpenAiCompatEndpointConfig('   ', {
        pathLabel: 'codeinfo_openai_endpoint',
      }),
    /RUNTIME_CONFIG_INVALID: codeinfo_openai_endpoint: expected an explicit http or https \/v1 base URL/,
  );
});

test('keeps same-host endpoints distinct when their normalized paths differ', () => {
  const first = parseOpenAiCompatEndpointConfig(
    'https://example.com/v1|responses',
    { pathLabel: 'endpoint-1' },
  );
  const second = parseOpenAiCompatEndpointConfig(
    'https://example.com/alt/v1|responses',
    { pathLabel: 'endpoint-2' },
  );

  assert.notEqual(first.endpointId, second.endpointId);
  assert.equal(first.endpointId, 'https://example.com/v1');
  assert.equal(second.endpointId, 'https://example.com/alt/v1');
});

test('normalizes endpoint labels into deterministic auth lookup keys', () => {
  assert.equal(
    normalizeOpenAiCompatEndpointLabelKey(' Open Router ', {
      pathLabel: 'label',
    }),
    'open-router',
  );
  assert.equal(
    normalizeOpenAiCompatEndpointLabelKey('OPENROUTER', {
      pathLabel: 'label',
    }),
    'openrouter',
  );
});

test('resolves labeled env-list entries with deduped, first-wins endpoint ordering', () => {
  const resolved = resolveOpenAiCompatEndpointConfigsFromList({
    value:
      'OpenRouter,https://example.com/v1|responses; Duplicate Name,https://example.com/v1/|completions; Local Gateway,https://example.com/alt/v1|responses',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
  });

  assert.deepEqual(
    resolved.endpoints.map((endpoint) => endpoint.endpointId),
    ['https://example.com/v1', 'https://example.com/alt/v1'],
  );
  assert.equal(resolved.endpoints[0]?.displayLabel, 'OpenRouter');
  assert.equal(resolved.endpoints[0]?.authLookupKey, 'openrouter');
  assert.equal(resolved.endpoints[1]?.displayLabel, 'Local Gateway');
  assert.equal(resolved.endpoints[1]?.authLookupKey, 'local-gateway');
  assert.equal(resolved.warnings.length, 1);
  assert.match(
    resolved.warnings[0] ?? '',
    /duplicates normalized endpoint https:\/\/example\.com\/v1; keeping first entry/,
  );
});

test('continues to accept legacy unlabeled env-list entries for backward compatibility', () => {
  const resolved = resolveOpenAiCompatEndpointConfigsFromList({
    value: 'https://example.com/v1|responses',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
  });

  assert.equal(resolved.endpoints[0]?.endpointId, 'https://example.com/v1');
  assert.equal(resolved.endpoints[0]?.displayLabel, undefined);
  assert.equal(resolved.endpoints[0]?.authLookupKey, undefined);
});

test('rejects duplicate normalized endpoint labels in the env list', () => {
  assert.throws(
    () =>
      resolveOpenAiCompatEndpointConfigsFromList({
        value:
          'Open Router,https://example.com/v1|responses;open-router,https://example.com/alt/v1|responses',
        pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
      }),
    /duplicate normalized endpoint label "open-router"/,
  );
});

test('parses endpoint key entries using the same label normalization rules', () => {
  const resolved = resolveOpenAiCompatEndpointKeysFromList({
    value: 'Open Router,sk-test-1;OPENROUTER-ALT,sk-test-2',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
  });

  assert.deepEqual(resolved.keys, [
    { authLookupKey: 'open-router', apiKey: 'sk-test-1' },
    { authLookupKey: 'openrouter-alt', apiKey: 'sk-test-2' },
  ]);
});

test('rejects duplicate normalized endpoint labels in the key list', () => {
  assert.throws(
    () =>
      resolveOpenAiCompatEndpointKeysFromList({
        value: 'Open Router,sk-a;open-router,sk-b',
        pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
      }),
    /duplicate normalized endpoint label "open-router"/,
  );
});

test('attaches matching endpoint keys without changing URL-backed identity', () => {
  const endpoints = resolveOpenAiCompatEndpointConfigsFromList({
    value:
      'OpenRouter,https://example.com/v1|responses;Legacy,https://example.com/alt/v1|responses',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
  });
  const keys = resolveOpenAiCompatEndpointKeysFromList({
    value: 'openrouter,sk-test',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
  });
  const attached = attachOpenAiCompatEndpointKeys({
    endpoints: endpoints.endpoints,
    keys: keys.keys,
  });

  assert.equal(attached.endpoints[0]?.endpointId, 'https://example.com/v1');
  assert.equal(attached.endpoints[0]?.displayLabel, 'OpenRouter');
  assert.equal(
    attached.apiKeysByEndpointId.get('https://example.com/v1'),
    'sk-test',
  );
  assert.equal(attached.apiKeysByAuthLookupKey.get('openrouter'), 'sk-test');
  assert.equal(attached.endpoints[1]?.endpointId, 'https://example.com/alt/v1');
  assert.equal(
    attached.apiKeysByEndpointId.get('https://example.com/alt/v1'),
    undefined,
  );
});

test('marks endpoints with sk-unsloth keys as supporting built-in web search', () => {
  const endpoints = resolveOpenAiCompatEndpointConfigsFromList({
    value: 'Unsloth,https://example.com/v1|responses',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
  });
  const keys = resolveOpenAiCompatEndpointKeysFromList({
    value: 'Unsloth,sk-unsloth-test',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
  });
  const attached = attachOpenAiCompatEndpointKeys({
    endpoints: endpoints.endpoints,
    keys: keys.keys,
  });

  assert.equal(
    supportsOpenAiCompatBuiltInWebSearch(attached.endpoints[0]),
    true,
  );
});

test('does not mark non-unsloth keyed endpoints as supporting built-in web search', () => {
  const endpoints = resolveOpenAiCompatEndpointConfigsFromList({
    value: 'OpenRouter,https://example.com/v1|responses',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
  });
  const keys = resolveOpenAiCompatEndpointKeysFromList({
    value: 'OpenRouter,sk-or-v1-test',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
  });
  const attached = attachOpenAiCompatEndpointKeys({
    endpoints: endpoints.endpoints,
    keys: keys.keys,
  });

  assert.equal(
    supportsOpenAiCompatBuiltInWebSearch(attached.endpoints[0]),
    false,
  );
});

test('warns when a configured endpoint key does not match any labeled external endpoint', () => {
  const endpoints = resolveOpenAiCompatEndpointConfigsFromList({
    value: 'https://example.com/v1|responses',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
  });
  const keys = resolveOpenAiCompatEndpointKeysFromList({
    value: 'openrouter,sk-test',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
  });
  const attached = attachOpenAiCompatEndpointKeys({
    endpoints: endpoints.endpoints,
    keys: keys.keys,
  });

  assert.equal(attached.warnings.length, 1);
  assert.match(
    attached.warnings[0] ?? '',
    /does not match any labeled external endpoint/,
  );
  assert.equal(attached.apiKeysByAuthLookupKey.get('openrouter'), 'sk-test');
});
