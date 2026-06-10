import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseOpenAiCompatEndpointConfig,
  resolveOpenAiCompatEndpointConfigsFromList,
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

test('resolves env-list entries with deduped, first-wins endpoint ordering', () => {
  const resolved = resolveOpenAiCompatEndpointConfigsFromList({
    value:
      'https://example.com/v1|responses; https://example.com/v1/|completions; https://example.com/alt/v1|responses',
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
  });

  assert.deepEqual(
    resolved.endpoints.map((endpoint) => endpoint.endpointId),
    ['https://example.com/v1', 'https://example.com/alt/v1'],
  );
  assert.equal(resolved.warnings.length, 1);
  assert.match(
    resolved.warnings[0] ?? '',
    /duplicates normalized endpoint https:\/\/example\.com\/v1; keeping first entry/,
  );
});
