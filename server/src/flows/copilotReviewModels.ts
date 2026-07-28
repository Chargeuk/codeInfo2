import { execFile as execFileCallback } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

import { CopilotLifecycle } from '../chat/copilotLifecycle.js';
import { resolveOpenAiCompatEndpointRuntimeState } from '../chat/openaiCompatModelDiscovery.js';
import {
  normalizeOpenAiCompatEndpointLabelKey,
  resolveOpenAiCompatEndpointConfigsFromList,
  validateOpenAiCompatEndpointConfigForProvider,
  type OpenAiCompatEndpointConfig,
} from '../config/openaiCompatEndpoints.js';
import {
  hasCopilotEnvToken,
  type CopilotReadinessRuntime,
} from '../providers/copilotReadiness.js';

const execFile = promisify(execFileCallback);

export const COPILOT_REVIEW_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type CopilotReviewReasoningEffort =
  (typeof COPILOT_REVIEW_REASONING_EFFORTS)[number];

export type CopilotReviewModelSpec = {
  selector: string;
  mode: 'native' | 'external';
  modelId: string;
  reasoningEffort: CopilotReviewReasoningEffort;
  endpointLabel?: string;
  stableId: string;
};

export type ResolvedCopilotReviewSpec = CopilotReviewModelSpec & {
  available: boolean;
  unavailableReason?: string;
  endpointId?: string;
};

export class CopilotReviewConfigurationError extends Error {
  constructor(message: string) {
    super(`Invalid CODEINFO_COPILOT_REVIEW_MODELS configuration: ${message}`);
    this.name = 'CopilotReviewConfigurationError';
  }
}

const SAFE_ID_CHARACTERS = /[^A-Za-z0-9_-]+/gu;
const REASONING_EFFORT_SET = new Set<string>(COPILOT_REVIEW_REASONING_EFFORTS);

const configurationError = (entryNumber: number, message: string): never => {
  throw new CopilotReviewConfigurationError(`entry ${entryNumber} ${message}.`);
};

const stableModelId = (
  mode: CopilotReviewModelSpec['mode'],
  selector: string,
): string => {
  const slug = `${mode}-${selector}`
    .replaceAll('::', '-')
    .replace(SAFE_ID_CHARACTERS, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 72);
  const digest = crypto
    .createHash('sha256')
    .update(`${mode}\0${selector}`)
    .digest('hex')
    .slice(0, 12);
  return `${slug || mode}-${digest}`;
};

export function parseCopilotReviewModels(
  value: string | undefined,
): CopilotReviewModelSpec[] {
  if (!value?.trim()) return [];

  const specs: CopilotReviewModelSpec[] = [];
  const seenSelectors = new Set<string>();
  const entries = value.split(',');
  for (const [index, rawEntry] of entries.entries()) {
    const entryNumber = index + 1;
    const entry = rawEntry.trim();
    if (!entry) configurationError(entryNumber, 'is empty');

    const pipeParts = entry.split('|');
    if (pipeParts.length !== 2) {
      configurationError(entryNumber, 'must contain exactly one "|" delimiter');
    }
    const rawSelector = pipeParts[0]?.trim() ?? '';
    const rawEffort = pipeParts[1]?.trim() ?? '';
    if (!rawSelector) configurationError(entryNumber, 'is missing a model');
    if (!rawEffort) {
      configurationError(entryNumber, 'is missing a reasoning effort');
    }
    if (!REASONING_EFFORT_SET.has(rawEffort)) {
      configurationError(entryNumber, 'uses an unsupported reasoning effort');
    }

    const endpointParts = rawSelector.split('::');
    if (endpointParts.length > 2) {
      configurationError(
        entryNumber,
        'contains an invalid endpoint qualification',
      );
    }

    let mode: CopilotReviewModelSpec['mode'] = 'native';
    let modelId = rawSelector;
    let endpointLabel: string | undefined;
    if (endpointParts.length === 2) {
      const rawEndpointLabel = endpointParts[0]?.trim() ?? '';
      modelId = endpointParts[1]?.trim() ?? '';
      if (!rawEndpointLabel || !modelId) {
        configurationError(
          entryNumber,
          'contains an invalid endpoint qualification',
        );
      }
      try {
        endpointLabel = normalizeOpenAiCompatEndpointLabelKey(
          rawEndpointLabel,
          {
            pathLabel: 'CODEINFO_COPILOT_REVIEW_MODELS endpoint label',
          },
        );
      } catch {
        configurationError(
          entryNumber,
          'contains an invalid endpoint qualification',
        );
      }
      mode = 'external';
    }

    if (!modelId || modelId.includes('::')) {
      configurationError(entryNumber, 'contains an invalid model id');
    }
    const selector =
      mode === 'external' ? `${endpointLabel}::${modelId}` : modelId;
    if (seenSelectors.has(selector)) {
      configurationError(entryNumber, 'duplicates an earlier model selector');
    }
    seenSelectors.add(selector);
    specs.push({
      selector,
      mode,
      modelId,
      reasoningEffort: rawEffort as CopilotReviewReasoningEffort,
      ...(endpointLabel ? { endpointLabel } : {}),
      stableId: stableModelId(mode, selector),
    });
  }
  return specs;
}

type NativeDiscovery =
  | { status: 'available'; models: string[] }
  | {
      status: 'authentication_required' | 'discovery_failed';
      models: string[];
    };

export type CopilotReviewAvailabilityDeps = {
  checkCli: (env: NodeJS.ProcessEnv) => Promise<boolean>;
  discoverNative: (env: NodeJS.ProcessEnv) => Promise<NativeDiscovery>;
  discoverExternal: (
    endpoint: OpenAiCompatEndpointConfig,
  ) => Promise<{ available: boolean; models: string[]; reason?: string }>;
};

const defaultCheckCli = async (env: NodeJS.ProcessEnv): Promise<boolean> => {
  const cliPath = env.CODEINFO_COPILOT_CLI_PATH?.trim() || 'copilot';
  try {
    await execFile(cliPath, ['--version'], {
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
};

const modelKeys = (models: Array<{ id?: string | null }>): string[] =>
  models.flatMap((entry) =>
    typeof entry.id === 'string' && entry.id.trim() ? [entry.id.trim()] : [],
  );

const defaultDiscoverNative = async (
  env: NodeJS.ProcessEnv,
): Promise<NativeDiscovery> => {
  const runtime: CopilotReadinessRuntime = new CopilotLifecycle({ env });
  let started = false;
  try {
    try {
      await runtime.start();
      started = true;
      await runtime.ping('copilot-review-model-discovery');
    } catch {
      return { status: 'discovery_failed', models: [] };
    }

    if (!hasCopilotEnvToken(env)) {
      let authenticated = false;
      try {
        authenticated = (await runtime.getAuthStatus()).isAuthenticated;
      } catch {
        return { status: 'discovery_failed', models: [] };
      }
      if (!authenticated) {
        return { status: 'authentication_required', models: [] };
      }
    }

    try {
      return {
        status: 'available',
        models: modelKeys(await runtime.listModels()),
      };
    } catch {
      return { status: 'discovery_failed', models: [] };
    }
  } finally {
    if (started) await runtime.stop().catch(() => []);
  }
};

const defaultDiscoverExternal: CopilotReviewAvailabilityDeps['discoverExternal'] =
  async (endpoint) => {
    const result = await resolveOpenAiCompatEndpointRuntimeState({
      endpoint,
      provider: 'copilot',
    });
    return {
      available: result.available,
      models: result.models,
      reason: result.reason,
    };
  };

const unavailable = (
  spec: CopilotReviewModelSpec,
  unavailableReason: string,
  endpointId?: string,
): ResolvedCopilotReviewSpec => ({
  ...spec,
  available: false,
  unavailableReason,
  ...(endpointId ? { endpointId } : {}),
});

export async function resolveCopilotReviewModels(
  specs: readonly CopilotReviewModelSpec[],
  options: {
    env?: NodeJS.ProcessEnv;
    deps?: Partial<CopilotReviewAvailabilityDeps>;
  } = {},
): Promise<ResolvedCopilotReviewSpec[]> {
  if (specs.length === 0) return [];
  const env = options.env ?? process.env;
  const deps: CopilotReviewAvailabilityDeps = {
    checkCli: options.deps?.checkCli ?? defaultCheckCli,
    discoverNative: options.deps?.discoverNative ?? defaultDiscoverNative,
    discoverExternal: options.deps?.discoverExternal ?? defaultDiscoverExternal,
  };

  if (!(await deps.checkCli(env))) {
    return specs.map((spec) =>
      unavailable(spec, 'Copilot CLI is unavailable.'),
    );
  }

  const endpointResolution = resolveOpenAiCompatEndpointConfigsFromList({
    value: env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS,
    pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
  });
  const nativeSpecs = specs.filter((spec) => spec.mode === 'native');
  const nativeDiscovery =
    nativeSpecs.length > 0 ? await deps.discoverNative(env) : undefined;

  const resolved: ResolvedCopilotReviewSpec[] = [];
  for (const spec of specs) {
    if (spec.mode === 'native') {
      if (nativeDiscovery?.status === 'authentication_required') {
        resolved.push(unavailable(spec, 'Copilot authentication is required.'));
      } else if (nativeDiscovery?.status !== 'available') {
        resolved.push(
          unavailable(spec, 'Native Copilot model discovery failed.'),
        );
      } else if (!nativeDiscovery.models.includes(spec.modelId)) {
        resolved.push(
          unavailable(
            spec,
            `Native Copilot model "${spec.modelId}" is not advertised.`,
          ),
        );
      } else {
        resolved.push({ ...spec, available: true });
      }
      continue;
    }

    const endpoint = endpointResolution.endpoints.find(
      (candidate) => candidate.authLookupKey === spec.endpointLabel,
    );
    if (!endpoint) {
      resolved.push(
        unavailable(spec, 'The selected external endpoint is not configured.'),
      );
      continue;
    }
    try {
      validateOpenAiCompatEndpointConfigForProvider({
        endpoint,
        provider: 'copilot',
        pathLabel: 'selected Copilot review endpoint',
      });
    } catch {
      resolved.push(
        unavailable(
          spec,
          'The selected external endpoint does not support OpenAI-compatible completions.',
          endpoint.endpointId,
        ),
      );
      continue;
    }

    try {
      const discovery = await deps.discoverExternal(endpoint);
      if (!discovery.available) {
        resolved.push(
          unavailable(
            spec,
            'External endpoint model discovery failed.',
            endpoint.endpointId,
          ),
        );
      } else if (!discovery.models.includes(spec.modelId)) {
        resolved.push(
          unavailable(
            spec,
            `External model "${spec.modelId}" is not advertised by the selected endpoint.`,
            endpoint.endpointId,
          ),
        );
      } else {
        resolved.push({
          ...spec,
          available: true,
          endpointId: endpoint.endpointId,
        });
      }
    } catch {
      resolved.push(
        unavailable(
          spec,
          'External endpoint model discovery failed.',
          endpoint.endpointId,
        ),
      );
    }
  }
  return resolved;
}
