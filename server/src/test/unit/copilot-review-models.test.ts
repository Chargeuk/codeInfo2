import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COPILOT_REVIEW_REASONING_EFFORTS,
  parseCopilotReviewModels,
  resolveCopilotReviewModels,
  type CopilotReviewAvailabilityDeps,
} from '../../flows/copilotReviewModels.js';
import { waitForCondition } from '../support/waitForCondition.js';

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

  test('accepts native and external provider-default entries without changing identity', () => {
    const [nativeDefault, externalDefault] = parseCopilotReviewModels(
      ' gpt-5.4 , OpenRouter :: deepseek/deepseek-v4-flash-0731 ',
    );
    const [nativeExplicit, externalExplicit] = parseCopilotReviewModels(
      'gpt-5.4|high,openrouter::deepseek/deepseek-v4-flash-0731|none',
    );

    assert.equal(nativeDefault?.reasoningEffort, undefined);
    assert.equal(externalDefault?.reasoningEffort, undefined);
    assert.equal(nativeDefault?.stableId, nativeExplicit?.stableId);
    assert.equal(externalDefault?.stableId, externalExplicit?.stableId);
    assert.equal(
      externalDefault?.selector,
      'openrouter::deepseek/deepseek-v4-flash-0731',
    );
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

  test('salvages valid entries, keeps the first duplicate, and warns for every discarded entry', () => {
    const warnings: Array<{ code: string; entryNumber: number }> = [];
    const specs = parseCopilotReviewModels(
      'model-a|low,bad|,model-a|high,Endpoint::model-b|minimal,,model-c|turbo,one::two::model|low',
      { onWarning: (warning) => warnings.push(warning) },
    );
    assert.deepEqual(
      specs.map(({ selector, reasoningEffort }) => ({
        selector,
        reasoningEffort,
      })),
      [
        { selector: 'model-a', reasoningEffort: 'low' },
        { selector: 'endpoint::model-b', reasoningEffort: 'minimal' },
      ],
    );
    assert.deepEqual(
      warnings.map(({ code, entryNumber }) => ({ code, entryNumber })),
      [
        { code: 'missing_reasoning_effort', entryNumber: 2 },
        { code: 'duplicate_selector', entryNumber: 3 },
        { code: 'empty_entry', entryNumber: 5 },
        { code: 'unsupported_reasoning_effort', entryNumber: 6 },
        { code: 'invalid_endpoint_qualification', entryNumber: 7 },
      ],
    );
  });

  test('all malformed forms are isolated without exposing their values', () => {
    const secret = 'sk-do-not-leak';
    const warnings: string[] = [];
    const parsedMalformed = parseCopilotReviewModels(
      [
        '|low',
        'model|',
        `${secret}|turbo`,
        '::model|low',
        'endpoint::|low',
        'one::two::model|low',
        'model|low|high',
      ].join(','),
      { onWarning: (warning) => warnings.push(JSON.stringify(warning)) },
    );
    assert.deepEqual(parsedMalformed, []);
    assert.equal(warnings.length, 7);
    assert.doesNotMatch(warnings.join('\n'), new RegExp(secret, 'u'));
    const parsed = parseCopilotReviewModels('model,other|low');
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
  test('sanitizes only external provider state from CLI readiness', async () => {
    const specs = parseCopilotReviewModels('gpt-5.4|low');
    const env: NodeJS.ProcessEnv = {
      PATH: '/test/bin',
      CODEINFO_COPILOT_CLI_PATH: '/test/bin/copilot',
      CODEINFO_COPILOT_HOME: '/test/copilot-home',
      COPILOT_GITHUB_TOKEN: 'copilot-native-token',
      GH_TOKEN: 'gh-native-token',
      GITHUB_TOKEN: 'github-native-token',
      COPILOT_PROVIDER_TYPE: 'openai',
      COPILOT_PROVIDER_API_KEY: 'external-secret',
      COPILOT_PROVIDER_CUSTOM: 'external-setting',
      COPILOT_MODEL: 'external-model',
      CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
        'External,https://external.test/v1|completions',
      CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS: 'External,external-secret',
      UNRELATED_SETTING: 'preserved',
    };
    let readinessEnv: NodeJS.ProcessEnv | undefined;
    let discoveryEnv: NodeJS.ProcessEnv | undefined;

    const [resolved] = await resolveCopilotReviewModels(specs, {
      env,
      deps: {
        ...availableDeps(),
        checkCli: async (candidate) => {
          readinessEnv = candidate;
          return true;
        },
        discoverNative: async (candidate) => {
          discoveryEnv = candidate;
          return { status: 'available', models: ['gpt-5.4'] };
        },
      },
    });

    assert.equal(resolved?.available, true);
    assert.notStrictEqual(readinessEnv, env);
    assert.notStrictEqual(discoveryEnv, env);
    assert.deepEqual(discoveryEnv, readinessEnv);
    assert.equal(readinessEnv?.PATH, '/test/bin');
    assert.equal(readinessEnv?.CODEINFO_COPILOT_CLI_PATH, '/test/bin/copilot');
    assert.equal(readinessEnv?.CODEINFO_COPILOT_HOME, '/test/copilot-home');
    assert.equal(readinessEnv?.COPILOT_GITHUB_TOKEN, 'copilot-native-token');
    assert.equal(readinessEnv?.GH_TOKEN, 'gh-native-token');
    assert.equal(readinessEnv?.GITHUB_TOKEN, 'github-native-token');
    assert.equal(readinessEnv?.UNRELATED_SETTING, 'preserved');
    assert.equal(readinessEnv?.COPILOT_PROVIDER_TYPE, undefined);
    assert.equal(readinessEnv?.COPILOT_PROVIDER_API_KEY, undefined);
    assert.equal(readinessEnv?.COPILOT_PROVIDER_CUSTOM, undefined);
    assert.equal(readinessEnv?.COPILOT_MODEL, undefined);
    assert.equal(
      readinessEnv?.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS,
      undefined,
    );
    assert.equal(
      readinessEnv?.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS,
      undefined,
    );
    for (const maskedKey of [
      'COPILOT_PROVIDER_TYPE',
      'COPILOT_PROVIDER_API_KEY',
      'COPILOT_PROVIDER_CUSTOM',
      'COPILOT_MODEL',
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
      'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS',
    ]) {
      assert.equal(Object.hasOwn(readinessEnv ?? {}, maskedKey), false);
      assert.equal(Object.hasOwn(discoveryEnv ?? {}, maskedKey), false);
    }
    assert.equal(env.COPILOT_PROVIDER_API_KEY, 'external-secret');
    assert.equal(
      env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS,
      'External,external-secret',
    );
  });

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

  test('surfaces endpoint warnings and discovers shared endpoints once', async () => {
    const specs = parseCopilotReviewModels(
      'openrouter::model-a|minimal,openrouter::model-b|high',
    );
    const warnings: string[] = [];
    let discoveryCalls = 0;
    const resolved = await resolveCopilotReviewModels(specs, {
      env: {
        CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
          'OpenRouter,https://openrouter.test/v1|completions;Duplicate,https://openrouter.test/v1|completions',
      },
      deps: {
        ...availableDeps(),
        discoverExternal: async () => {
          discoveryCalls += 1;
          return {
            available: true,
            models: ['model-a', 'model-b'],
          };
        },
      },
      onWarning: (warning) => warnings.push(warning.message),
    });

    assert.equal(discoveryCalls, 1);
    assert.equal(
      resolved.every((spec) => spec.available),
      true,
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /keeping first entry/u);
  });

  test('propagates explicit cancellation instead of converting it to unavailability', async () => {
    const specs = parseCopilotReviewModels('gpt-5.4|low');
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const resolution = resolveCopilotReviewModels(specs, {
      env: {},
      signal: controller.signal,
      deps: {
        ...availableDeps(),
        checkCli: async (_env, signal) => {
          receivedSignal = signal;
          return new Promise<boolean>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                const error = new Error('cancelled');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true },
            );
          });
        },
      },
    });

    await waitForCondition(
      () => receivedSignal !== undefined,
      'Copilot model resolution did not receive its cancellation signal.',
    );
    controller.abort();
    await assert.rejects(resolution, { name: 'AbortError' });
    assert.equal(receivedSignal, controller.signal);
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
      {
        deps: {
          checkCli: async () => true,
          discoverNative: async () => {
            throw new Error('native discovery secret');
          },
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

  test('native availability is independent of malformed external endpoint configuration', async () => {
    const specs = parseCopilotReviewModels('gpt-5.4|low');
    const [resolved] = await resolveCopilotReviewModels(specs, {
      env: {
        CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
          'malformed-secret-bearing-value',
      },
      deps: availableDeps(),
    });
    assert.equal(resolved?.available, true);
  });

  test('malformed external endpoint configuration leaves external models visible and unavailable', async () => {
    const specs = parseCopilotReviewModels('unsloth::model|minimal');
    const warnings: string[] = [];
    const [resolved] = await resolveCopilotReviewModels(specs, {
      env: {
        CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
          'malformed-secret-bearing-value',
      },
      deps: availableDeps(),
      onWarning: (warning) => warnings.push(warning.message),
    });
    assert.equal(resolved?.available, false);
    assert.match(
      resolved?.unavailableReason ?? '',
      /selected external endpoint is not configured/u,
    );
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(
      JSON.stringify({ resolved, warnings }),
      /malformed-secret-bearing-value/u,
    );
  });

  test('malformed unrelated endpoint entries do not suppress a valid selected external model', async () => {
    const secret = 'sk-malformed-endpoint-secret';
    const specs = parseCopilotReviewModels('openrouter::model|minimal');
    const warnings: string[] = [];
    const [resolved] = await resolveCopilotReviewModels(specs, {
      env: {
        CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS: [
          'OpenRouter,https://openrouter.test/v1|completions',
          `malformed-${secret}`,
          'Other,https://other.test/v1|responses',
        ].join(';'),
      },
      deps: {
        ...availableDeps(),
        discoverExternal: async () => ({
          available: true,
          models: ['model'],
        }),
      },
      onWarning: (warning) => warnings.push(warning.message),
    });

    assert.equal(resolved?.available, true);
    assert.equal(resolved?.endpointId, 'https://openrouter.test/v1');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /\[2\].*malformed.*ignored/u);
    assert.doesNotMatch(
      JSON.stringify({ resolved, warnings }),
      new RegExp(secret, 'u'),
    );
  });

  test('native discovery failure does not suppress an independently available external model', async () => {
    const specs = parseCopilotReviewModels(
      'native-model|low,unsloth::external-model|minimal',
    );
    const resolved = await resolveCopilotReviewModels(specs, {
      env: {
        CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
          'Unsloth,https://example.test/v1|completions',
      },
      deps: {
        ...availableDeps(),
        discoverNative: async () => {
          throw new Error('native discovery failed');
        },
        discoverExternal: async () => ({
          available: true,
          models: ['external-model'],
        }),
      },
    });
    assert.equal(resolved[0]?.available, false);
    assert.equal(resolved[1]?.available, true);
  });

  test('missing native login does not suppress an independently available external model', async () => {
    const specs = parseCopilotReviewModels(
      'native-model|low,openrouter::external-model|minimal',
    );
    const resolved = await resolveCopilotReviewModels(specs, {
      env: {
        CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS:
          'OpenRouter,https://openrouter.test/api/v1|completions',
      },
      deps: {
        ...availableDeps(),
        discoverNative: async () => ({
          status: 'authentication_required',
          models: [],
        }),
        discoverExternal: async () => ({
          available: true,
          models: ['external-model'],
        }),
      },
    });
    assert.equal(resolved[0]?.available, false);
    assert.match(
      resolved[0]?.unavailableReason ?? '',
      /authentication is required/u,
    );
    assert.equal(resolved[1]?.available, true);
  });
});
