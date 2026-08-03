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
  reasoningEffort?: CopilotReviewReasoningEffort;
  endpointLabel?: string;
  stableId: string;
};

export type ResolvedCopilotReviewSpec = CopilotReviewModelSpec & {
  available: boolean;
  unavailableReason?: string;
  endpointId?: string;
};

export type CopilotReviewConfigurationWarning = {
  entryNumber: number;
  code:
    | 'empty_entry'
    | 'invalid_delimiters'
    | 'missing_model'
    | 'missing_reasoning_effort'
    | 'unsupported_reasoning_effort'
    | 'invalid_endpoint_qualification'
    | 'invalid_model_id'
    | 'duplicate_selector';
  message: string;
  duplicateOfEntryNumber?: number;
};

export type CopilotReviewEndpointWarning = {
  code: 'external_endpoint_configuration';
  message: string;
};

export type CopilotReviewPreparationWarning =
  | CopilotReviewConfigurationWarning
  | CopilotReviewEndpointWarning;

const SAFE_ID_CHARACTERS = /[^A-Za-z0-9_-]+/gu;
const REASONING_EFFORT_SET = new Set<string>(COPILOT_REVIEW_REASONING_EFFORTS);

const configurationWarning = (
  entryNumber: number,
  code: CopilotReviewConfigurationWarning['code'],
  message: string,
  duplicateOfEntryNumber?: number,
): CopilotReviewConfigurationWarning => ({
  entryNumber,
  code,
  message: `CODEINFO_COPILOT_REVIEW_MODELS entry ${entryNumber} ${message}.`,
  ...(duplicateOfEntryNumber ? { duplicateOfEntryNumber } : {}),
});

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
  options: {
    onWarning?: (warning: CopilotReviewConfigurationWarning) => void;
  } = {},
): CopilotReviewModelSpec[] {
  if (!value?.trim()) return [];

  const specs: CopilotReviewModelSpec[] = [];
  const seenSelectors = new Map<string, number>();
  const entries = value.split(',');
  for (const [index, rawEntry] of entries.entries()) {
    const entryNumber = index + 1;
    const entry = rawEntry.trim();
    const warn = (
      code: CopilotReviewConfigurationWarning['code'],
      message: string,
      duplicateOfEntryNumber?: number,
    ) =>
      options.onWarning?.(
        configurationWarning(
          entryNumber,
          code,
          message,
          duplicateOfEntryNumber,
        ),
      );
    if (!entry) {
      warn('empty_entry', 'is empty and was ignored');
      continue;
    }

    const pipeParts = entry.split('|');
    if (pipeParts.length > 2) {
      warn(
        'invalid_delimiters',
        'must contain at most one "|" delimiter and was ignored',
      );
      continue;
    }
    const rawSelector = pipeParts[0]?.trim() ?? '';
    const rawEffort = pipeParts[1]?.trim();
    if (!rawSelector) {
      warn('missing_model', 'is missing a model and was ignored');
      continue;
    }
    if (pipeParts.length === 2 && !rawEffort) {
      warn(
        'missing_reasoning_effort',
        'is missing a reasoning effort and was ignored',
      );
      continue;
    }
    if (rawEffort !== undefined && !REASONING_EFFORT_SET.has(rawEffort)) {
      warn(
        'unsupported_reasoning_effort',
        'uses an unsupported reasoning effort and was ignored',
      );
      continue;
    }

    const endpointParts = rawSelector.split('::');
    if (endpointParts.length > 2) {
      warn(
        'invalid_endpoint_qualification',
        'contains an invalid endpoint qualification and was ignored',
      );
      continue;
    }

    let mode: CopilotReviewModelSpec['mode'] = 'native';
    let modelId = rawSelector;
    let endpointLabel: string | undefined;
    if (endpointParts.length === 2) {
      const rawEndpointLabel = endpointParts[0]?.trim() ?? '';
      modelId = endpointParts[1]?.trim() ?? '';
      if (!rawEndpointLabel || !modelId) {
        warn(
          'invalid_endpoint_qualification',
          'contains an invalid endpoint qualification and was ignored',
        );
        continue;
      }
      try {
        endpointLabel = normalizeOpenAiCompatEndpointLabelKey(
          rawEndpointLabel,
          {
            pathLabel: 'CODEINFO_COPILOT_REVIEW_MODELS endpoint label',
          },
        );
      } catch {
        warn(
          'invalid_endpoint_qualification',
          'contains an invalid endpoint qualification and was ignored',
        );
        continue;
      }
      mode = 'external';
    }

    if (!modelId || modelId.includes('::')) {
      warn('invalid_model_id', 'contains an invalid model id and was ignored');
      continue;
    }
    const selector =
      mode === 'external' ? `${endpointLabel}::${modelId}` : modelId;
    const duplicateOfEntryNumber = seenSelectors.get(selector);
    if (duplicateOfEntryNumber !== undefined) {
      warn(
        'duplicate_selector',
        `duplicates entry ${duplicateOfEntryNumber}; the first valid entry was kept`,
        duplicateOfEntryNumber,
      );
      continue;
    }
    seenSelectors.set(selector, entryNumber);
    specs.push({
      selector,
      mode,
      modelId,
      ...(rawEffort
        ? { reasoningEffort: rawEffort as CopilotReviewReasoningEffort }
        : {}),
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
  checkCli: (env: NodeJS.ProcessEnv, signal?: AbortSignal) => Promise<boolean>;
  discoverNative: (
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ) => Promise<NativeDiscovery>;
  discoverExternal: (
    endpoint: OpenAiCompatEndpointConfig,
    signal?: AbortSignal,
  ) => Promise<{ available: boolean; models: string[]; reason?: string }>;
};

const abortError = (): Error => {
  const error = new Error('Copilot review model discovery was cancelled.');
  error.name = 'AbortError';
  return error;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError();
};

const awaitAbortable = <T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void | Promise<void>,
): Promise<T> => {
  if (!signal) return operation;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      void Promise.resolve(onAbort?.()).catch(() => undefined);
      reject(abortError());
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
};

const buildCliReadinessEnvironment = (
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const result = { ...process.env, ...source };
  for (const key of Object.keys(result)) {
    if (key.startsWith('COPILOT_PROVIDER_')) delete result[key];
  }
  delete result.COPILOT_MODEL;
  delete result.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  delete result.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  return result;
};

const defaultCheckCli = async (
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<boolean> => {
  throwIfAborted(signal);
  const cliPath = env.CODEINFO_COPILOT_CLI_PATH?.trim() || 'copilot';
  try {
    await execFile(cliPath, ['--version'], {
      env,
      encoding: 'utf8',
      timeout: 10_000,
      signal,
    });
    return true;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return false;
  }
};

const modelKeys = (models: Array<{ id?: string | null }>): string[] =>
  models.flatMap((entry) =>
    typeof entry.id === 'string' && entry.id.trim() ? [entry.id.trim()] : [],
  );

const defaultDiscoverNative = async (
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<NativeDiscovery> => {
  throwIfAborted(signal);
  const runtime: CopilotReadinessRuntime = new CopilotLifecycle({ env });
  let stopPromise: Promise<void> | undefined;
  const stopRuntime = (): Promise<void> => {
    stopPromise ??= runtime
      .stop()
      .then(() => undefined)
      .catch(() => undefined);
    return stopPromise;
  };
  let started = false;
  try {
    try {
      await awaitAbortable(runtime.start(), signal, stopRuntime);
      started = true;
      await awaitAbortable(
        runtime.ping('copilot-review-model-discovery'),
        signal,
        stopRuntime,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      return { status: 'discovery_failed', models: [] };
    }

    if (!hasCopilotEnvToken(env)) {
      let authenticated = false;
      try {
        authenticated = (
          await awaitAbortable(runtime.getAuthStatus(), signal, stopRuntime)
        ).isAuthenticated;
      } catch (error) {
        if (isAbortError(error)) throw error;
        return { status: 'discovery_failed', models: [] };
      }
      if (!authenticated) {
        return { status: 'authentication_required', models: [] };
      }
    }

    try {
      return {
        status: 'available',
        models: modelKeys(
          await awaitAbortable(runtime.listModels(), signal, stopRuntime),
        ),
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return { status: 'discovery_failed', models: [] };
    }
  } finally {
    if (started || stopPromise) await stopRuntime();
  }
};

const defaultDiscoverExternal: CopilotReviewAvailabilityDeps['discoverExternal'] =
  async (endpoint, signal) => {
    throwIfAborted(signal);
    const result = await awaitAbortable(
      resolveOpenAiCompatEndpointRuntimeState({
        endpoint,
        provider: 'copilot',
      }),
      signal,
    );
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
    signal?: AbortSignal;
    onWarning?: (warning: CopilotReviewEndpointWarning) => void;
  } = {},
): Promise<ResolvedCopilotReviewSpec[]> {
  throwIfAborted(options.signal);
  if (specs.length === 0) return [];
  const env = options.env ?? process.env;
  const deps: CopilotReviewAvailabilityDeps = {
    checkCli: options.deps?.checkCli ?? defaultCheckCli,
    discoverNative: options.deps?.discoverNative ?? defaultDiscoverNative,
    discoverExternal: options.deps?.discoverExternal ?? defaultDiscoverExternal,
  };

  let cliAvailable = false;
  try {
    cliAvailable = await deps.checkCli(
      buildCliReadinessEnvironment(env),
      options.signal,
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    return specs.map((spec) =>
      unavailable(spec, 'Copilot CLI readiness check failed.'),
    );
  }
  if (!cliAvailable) {
    return specs.map((spec) =>
      unavailable(spec, 'Copilot CLI is unavailable.'),
    );
  }

  const nativeSpecs = specs.filter((spec) => spec.mode === 'native');
  const externalSpecs = specs.filter((spec) => spec.mode === 'external');
  let nativeDiscovery: NativeDiscovery | undefined;
  if (nativeSpecs.length > 0) {
    try {
      nativeDiscovery = await deps.discoverNative(
        buildCliReadinessEnvironment(env),
        options.signal,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      nativeDiscovery = { status: 'discovery_failed', models: [] };
    }
  }
  let endpointResolution:
    | ReturnType<typeof resolveOpenAiCompatEndpointConfigsFromList>
    | undefined;
  let endpointConfigurationUnavailable = false;
  if (externalSpecs.length > 0) {
    try {
      endpointResolution = resolveOpenAiCompatEndpointConfigsFromList({
        value: env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS,
        pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
      });
      for (const message of endpointResolution.warnings) {
        options.onWarning?.({
          code: 'external_endpoint_configuration',
          message,
        });
      }
    } catch {
      endpointConfigurationUnavailable = true;
    }
  }

  const resolved: ResolvedCopilotReviewSpec[] = [];
  const externalDiscoveryByEndpoint = new Map<
    string,
    Promise<{ available: boolean; models: string[]; reason?: string }>
  >();
  for (const spec of specs) {
    throwIfAborted(options.signal);
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

    if (endpointConfigurationUnavailable || !endpointResolution) {
      resolved.push(
        unavailable(
          spec,
          'External endpoint configuration could not be resolved.',
        ),
      );
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
      let discoveryPromise = externalDiscoveryByEndpoint.get(
        endpoint.endpointId,
      );
      if (!discoveryPromise) {
        discoveryPromise = deps.discoverExternal(endpoint, options.signal);
        externalDiscoveryByEndpoint.set(endpoint.endpointId, discoveryPromise);
      }
      const discovery = await discoveryPromise;
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
    } catch (error) {
      if (isAbortError(error)) throw error;
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
