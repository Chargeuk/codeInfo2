import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COPILOT_REVIEW_REASONING_EFFORTS,
  CopilotReviewConfigurationError,
  parseCopilotReviewModels,
  resolveCopilotReviewModels,
  type CopilotReviewAvailabilityDeps,
} from '../../flows/copilotReviewModels.js';

describe('Copilot review model configuration', () => {
  test('missing and blank values disable Copilot reviews', () => {
    assert.deepEqual(parseCopilotReviewModels(undefined), []);
    assert.deepEqual(parseCopilotReviewModels('   '), []);
  });

  test('parses native, external, mixed, and whitespace-normalized entries in order', () => {
    const specs = parseCopilotReviewModels(
      ' gpt-5.4 | low , UnSloth :: google-gemini-3.6-flash | minimal ',
    );
    assert.deepEqual(
      specs.map(
        ({ selector, mode, modelId, reasoningEffort, endpointLabel }) => ({
          selector,
          mode,
          modelId,
          reasoningEffort,
          endpointLabel,
        }),
      ),
      [
        {
          selector: 'gpt-5.4',
          mode: 'native',
          modelId: 'gpt-5.4',
          reasoningEffort: 'low',
          endpointLabel: undefined,
        },
        {
          selector: 'unsloth::google-gemini-3.6-flash',
          mode: 'external',
          modelId: 'google-gemini-3.6-flash',
          reasoningEffort: 'minimal',
          endpointLabel: 'unsloth',
        },
      ],
    );
    assert.match(specs[0]?.stableId ?? '', /^[A-Za-z0-9._-]+$/u);
    assert.match(specs[1]?.stableId ?? '', /^[A-Za-z0-9._-]+$/u);
    assert.notEqual(specs[0]?.stableId, specs[1]?.stableId);
  });

  test('accepts every reasoning effort without making effort part of identity', () => {
    for (const effort of COPILOT_REVIEW_REASONING_EFFORTS) {
      const [spec] = parseCopilotReviewModels(`model|${effort}`);
      const [other] = parseCopilotReviewModels('model|medium');
      assert.equal(spec?.reasoningEffort, effort);
      assert.equal(spec?.stableId, other?.stableId);
    }
  });

  test('preserves exact model-id case and produces stable deterministic ids', () => {
    const first = parseCopilotReviewModels(
      'Native-Model|low,Endpoint::Exact/Model:Tag|minimal',
    );
    const second = parseCopilotReviewModels(
      'Native-Model|high,Endpoint::Exact/Model:Tag|max',
    );
    assert.deepEqual(
      first.map((spec) => spec.stableId),
      second.map((spec) => spec.stableId),
    );
    assert.equal(first[1]?.modelId, 'Exact/Model:Tag');
  });

  test('rejects malformed entries and duplicate selectors at any effort', () => {
    const invalid = [
      'model',
      '|low',
      'model|',
      'model|turbo',
      'model|low,',
      ',model|low',
      '::model|low',
      'endpoint::|low',
      'one::two::model|low',
      'model|low|high',
      'model|low,model|low',
      'model|low,model|high',
      'Endpoint::model|low, endpoint :: model |high',
    ];
    for (const value of invalid) {
      assert.throws(
        () => parseCopilotReviewModels(value),
        CopilotReviewConfigurationError,
        value,
      );
    }
  });

  test('configuration errors and parsed objects never expose unrelated secrets', () => {
    const secret = 'sk-do-not-leak';
    assert.throws(
      () => parseCopilotReviewModels(`${secret}|unknown`),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.doesNotMatch(error.message, new RegExp(secret, 'u'));
        return true;
      },
    );
    const parsed = parseCopilotReviewModels('model|low');
    assert.doesNotMatch(JSON.stringify(parsed), /api[_-]?key|https?:\/\//iu);
  });
});

const availableDeps = (): CopilotReviewAvailabilityDeps => ({
  checkCli: async () => true,
  discoverNative: async () => ({
    status: 'available',
    models: ['gpt-5.4'],
  }),
  discoverExternal: async () => ({
    available: true,
    models: ['google-gemini-3.6-flash'],
  }),
});

describe('Copilot review model availability', () => {
  test('resolves available native and exact endpoint-qualified external models', async () => {
    const specs = parseCopilotReviewModels(
      'gpt-5.4|low,unsloth::google-gemini-3.6-flash|minimal',
    );
    const result = await resolveCopilotReviewModels(specs, {
      env: {
        CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
          'Unsloth,https://example.test/v1|completions',
      },
      deps: availableDeps(),
    });
    assert.deepEqual(
      result.map(({ mode, modelId, available, endpointId }) => ({
        mode,
        modelId,
        available,
        endpointId,
      })),
      [
        {
          mode: 'native',
          modelId: 'gpt-5.4',
          available: true,
          endpointId: undefined,
        },
        {
          mode: 'external',
          modelId: 'google-gemini-3.6-flash',
          available: true,
          endpointId: 'https://example.test/v1',
        },
      ],
    );
  });

  test('distinguishes CLI, authentication, native absence, and native discovery failures', async () => {
    const [spec] = parseCopilotReviewModels('gpt-5.4|low');
    assert(spec);
    const cases: Array<{
      deps: Partial<CopilotReviewAvailabilityDeps>;
      reason: RegExp;
    }> = [
      { deps: { checkCli: async () => false }, reason: /CLI is unavailable/u },
      {
        deps: {
          checkCli: async () => true,
          discoverNative: async () => ({
            status: 'authentication_required',
            models: [],
          }),
        },
        reason: /authentication is required/u,
      },
      {
        deps: {
          checkCli: async () => true,
          discoverNative: async () => ({
            status: 'available',
            models: ['other'],
          }),
        },
        reason: /not advertised/u,
      },
      {
        deps: {
          checkCli: async () => true,
          discoverNative: async () => ({
            status: 'discovery_failed',
            models: [],
          }),
        },
        reason: /discovery failed/u,
      },
    ];
    for (const candidate of cases) {
      const [resolved] = await resolveCopilotReviewModels([spec], {
        env: {},
        deps: {
          ...availableDeps(),
          ...candidate.deps,
        },
      });
      assert.equal(resolved?.available, false);
      assert.match(resolved?.unavailableReason ?? '', candidate.reason);
    }
  });

  test('keeps valid external models visible for endpoint configuration and discovery failures', async () => {
    const [spec] = parseCopilotReviewModels('unsloth::model|minimal');
    assert(spec);
    const cases: Array<{
      env: NodeJS.ProcessEnv;
      deps?: Partial<CopilotReviewAvailabilityDeps>;
      reason: RegExp;
    }> = [
      { env: {}, reason: /not configured/u },
      {
        env: {
          CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
            'Unsloth,https://example.test/v1|responses',
        },
        reason: /does not support/u,
      },
      {
        env: {
          CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
            'Unsloth,https://example.test/v1|completions',
        },
        deps: {
          discoverExternal: async () => ({
            available: true,
            models: ['other'],
          }),
        },
        reason: /not advertised/u,
      },
      {
        env: {
          CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
            'Unsloth,https://example.test/v1|completions',
        },
        deps: {
          discoverExternal: async () => {
            throw new Error('transport included sk-secret');
          },
        },
        reason: /discovery failed/u,
      },
    ];
    for (const candidate of cases) {
      const [resolved] = await resolveCopilotReviewModels([spec], {
        env: candidate.env,
        deps: {
          ...availableDeps(),
          ...candidate.deps,
        },
      });
      assert.equal(resolved?.available, false);
      assert.match(resolved?.unavailableReason ?? '', candidate.reason);
      assert.doesNotMatch(JSON.stringify(resolved), /sk-secret/u);
    }
  });

  test('availability remains secret-free whether an endpoint key is configured or absent', async () => {
    const specs = parseCopilotReviewModels('unsloth::model|minimal');
    for (const keys of [undefined, 'Unsloth,sk-secret-value']) {
      const [resolved] = await resolveCopilotReviewModels(specs, {
        env: {
          CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
            'Unsloth,https://example.test/v1|completions',
          CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS: keys,
        },
        deps: {
          ...availableDeps(),
          discoverExternal: async () => ({
            available: true,
            models: ['model'],
          }),
        },
      });
      assert.equal(resolved?.available, true);
      assert.doesNotMatch(JSON.stringify(resolved), /sk-secret-value/u);
    }
  });
});
