import assert from 'node:assert/strict';
import test from 'node:test';

import {
  flattenCodexNamespaceToolsForCustomProvider,
  restoreCodexNamespaceToolCallsFromCustomProviderResponse,
} from '../../chat/openaiCompatToolFlattening.js';

test('flattenCodexNamespaceToolsForCustomProvider leaves non-JSON bodies unchanged', () => {
  const raw = 'not-json';
  const flattened = flattenCodexNamespaceToolsForCustomProvider(raw);
  assert.equal(flattened.bodyText, raw);
  assert.deepEqual(flattened.namespaceToolCallMap, {});
});

test('flattenCodexNamespaceToolsForCustomProvider leaves non-namespace tools unchanged', () => {
  const raw = JSON.stringify({
    model: 'alpha',
    tools: [
      {
        type: 'function',
        name: 'exec_command',
        description: 'run shell command',
      },
    ],
  });

  const flattened = flattenCodexNamespaceToolsForCustomProvider(raw);
  assert.equal(flattened.bodyText, raw);
  assert.deepEqual(flattened.namespaceToolCallMap, {});
});

test('flattenCodexNamespaceToolsForCustomProvider flattens namespace tools into prefixed function tools', () => {
  const raw = JSON.stringify({
    model: 'alpha',
    tools: [
      {
        type: 'function',
        name: 'exec_command',
        description: 'run shell command',
      },
      {
        type: 'namespace',
        name: 'mcp__code_info__',
        description: 'namespace wrapper',
        tools: [
          {
            type: 'function',
            name: 'ListIngestedRepositories',
            description: 'list repos',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
              additionalProperties: false,
            },
          },
          {
            type: 'function',
            name: 'VectorSearch',
            description: 'search chunks',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
              additionalProperties: false,
            },
          },
        ],
      },
    ],
  });

  const flattened = flattenCodexNamespaceToolsForCustomProvider(raw);
  assert.ok(flattened.bodyText, 'expected flattened body');
  const parsed = JSON.parse(flattened.bodyText as string) as {
    tools: Array<Record<string, unknown>>;
  };
  const encodedToolNames = Object.keys(flattened.namespaceToolCallMap);

  assert.deepEqual(
    parsed.tools.map((tool) => tool.name),
    [
      'exec_command',
      ...encodedToolNames,
    ],
  );
  for (const tool of parsed.tools.slice(1)) {
    assert.match(String(tool.name), /^[A-Za-z0-9_-]+$/);
    assert.doesNotMatch(String(tool.name), /\./);
  }
  assert.equal(parsed.tools[1]?.type, 'function');
  assert.equal(parsed.tools[2]?.type, 'function');
  assert.deepEqual(parsed.tools[2]?.parameters, {
    type: 'object',
    properties: {
      query: { type: 'string' },
    },
    required: ['query'],
    additionalProperties: false,
  });
  assert.deepEqual(flattened.namespaceToolCallMap, {
    [encodedToolNames[0]]: {
      namespace: 'mcp__code_info__',
      name: 'ListIngestedRepositories',
    },
    [encodedToolNames[1]]: {
      namespace: 'mcp__code_info__',
      name: 'VectorSearch',
    },
  });
});

test('restoreCodexNamespaceToolCallsFromCustomProviderResponse restores namespace on flattened function calls', () => {
  const flattenedName = Object.keys(
    flattenCodexNamespaceToolsForCustomProvider(
      JSON.stringify({
        tools: [
          {
            type: 'namespace',
            name: 'mcp__code_info__',
            tools: [{ type: 'function', name: 'ListIngestedRepositories' }],
          },
        ],
      }),
    ).namespaceToolCallMap,
  )[0];
  const response = JSON.stringify({
    id: 'resp_123',
    object: 'response',
    status: 'completed',
    output: [
      {
        type: 'function_call',
        name: flattenedName,
        arguments: '{}',
        call_id: 'call_123',
      },
    ],
  });

  const restored = restoreCodexNamespaceToolCallsFromCustomProviderResponse(
    response,
    {
      [flattenedName]: {
        namespace: 'mcp__code_info__',
        name: 'ListIngestedRepositories',
      },
    },
  );
  const parsed = JSON.parse(restored) as {
    output: Array<Record<string, unknown>>;
  };

  assert.deepEqual(parsed.output[0], {
    type: 'function_call',
    name: 'ListIngestedRepositories',
    namespace: 'mcp__code_info__',
    arguments: '{}',
    call_id: 'call_123',
  });
});
