import assert from 'node:assert/strict';
import test from 'node:test';

import {
  prepareProviderExecution,
  resolveOpenAiCompatEndpointById,
} from '../../chat/providerExecution.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';

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

test('prepareProviderExecution leaves managed web_tools warnings to the final caller surface', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    models: ['endpoint-model'],
  });

  try {
    const prepared = await prepareProviderExecution({
      requestedProvider: 'codex',
      requestedModel: 'endpoint-model',
      providerStates: {
        codex: { available: true, models: ['native-model'] },
        copilot: { available: true, models: ['copilot-model'] },
        lmstudio: { available: true, models: ['lmstudio-model'] },
      },
      loadRuntimeConfig: async () => ({
        config: {
          model: 'endpoint-model',
          web_search: 'cached',
          codeinfo_openai_endpoint: `${externalServer.baseUrl}/v1|responses`,
        },
        warnings: [],
        endpoint: {
          endpointId: `${externalServer.baseUrl}/v1`,
          baseUrl: `${externalServer.baseUrl}/v1`,
          capabilities: ['responses'],
          displayLabel: 'Pinned endpoint',
        },
      }),
      allowCrossProviderFallback: false,
      env: process.env,
    });

    assert.equal(prepared.executionProvider, 'codex');
    assert.equal(
      prepared.warnings.some((warning) =>
        warning.includes('web_tools will not be injected'),
      ),
      false,
    );
  } finally {
    await externalServer.stop();
  }
});
