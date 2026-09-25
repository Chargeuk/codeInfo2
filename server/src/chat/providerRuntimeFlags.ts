import { loadProviderChatDefaultsSnapshotSync } from '../config/runtimeConfig.js';
import { getScopedEnvValue } from '../test/support/testEnvOverrideScope.js';

const COPILOT_REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
const TOOL_ACCESS_MODES = ['on', 'off'] as const;
const LMSTUDIO_CONTEXT_OVERFLOW_POLICIES = [
  'stopAtLimit',
  'truncateMiddle',
  'rollingWindow',
] as const;

const DEFAULT_COPILOT_REASONING_EFFORT = 'medium';
const DEFAULT_COPILOT_TOOL_ACCESS = 'on';
export const DEFAULT_LMSTUDIO_TEMPERATURE = 0.2;
export const DEFAULT_LMSTUDIO_MAX_TOKENS = 4096;
export const DEFAULT_LMSTUDIO_CONTEXT_OVERFLOW_POLICY = 'truncateMiddle';
export const DEFAULT_LMSTUDIO_TOOL_ACCESS = 'on';
export const LMSTUDIO_TEMPERATURE_MIN = 0;
export const LMSTUDIO_TEMPERATURE_MAX = 2;
export const LMSTUDIO_MAX_TOKENS_MIN = 1;

export class ProviderRuntimeFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRuntimeFlagError';
  }
}

export type CopilotRuntimeAgentFlags = {
  modelReasoningEffort?: (typeof COPILOT_REASONING_EFFORTS)[number];
  toolAccess: (typeof TOOL_ACCESS_MODES)[number];
};

export type LmStudioRuntimeAgentFlags = {
  temperature: number;
  maxTokens: number;
  contextOverflowPolicy: (typeof LMSTUDIO_CONTEXT_OVERFLOW_POLICIES)[number];
  toolAccess: (typeof TOOL_ACCESS_MODES)[number];
};

export const copilotReasoningEfforts = COPILOT_REASONING_EFFORTS;
export const toolAccessModes = TOOL_ACCESS_MODES;
export const lmStudioContextOverflowPolicies =
  LMSTUDIO_CONTEXT_OVERFLOW_POLICIES;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeAgentFlagsInput = (
  provider: 'copilot' | 'lmstudio',
  value: unknown,
): Record<string, unknown> => {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new ProviderRuntimeFlagError(
      `${provider} agentFlags must be an object`,
    );
  }
  return value;
};

const parseChoice = <T extends string>(
  value: unknown,
  field: string,
  choices: readonly T[],
): T => {
  if (typeof value !== 'string') {
    throw new ProviderRuntimeFlagError(
      `${field} must be one of: ${choices.join(', ')}`,
    );
  }
  const trimmed = value.trim();
  if (!trimmed || !choices.includes(trimmed as T)) {
    throw new ProviderRuntimeFlagError(
      `${field} must be one of: ${choices.join(', ')}`,
    );
  }
  return trimmed as T;
};

export const parseOptionalConfigString = <T extends string>(
  value: unknown,
  choices: readonly T[],
): T | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return choices.includes(trimmed as T) ? (trimmed as T) : undefined;
};

const parseFiniteNumber = (
  value: unknown,
  field: string,
  options?: { min?: number; max?: number; integer?: boolean },
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProviderRuntimeFlagError(`${field} must be a number`);
  }
  if (options?.integer && !Number.isInteger(value)) {
    throw new ProviderRuntimeFlagError(`${field} must be an integer`);
  }
  if (options?.min !== undefined && value < options.min) {
    throw new ProviderRuntimeFlagError(
      `${field} must be at least ${options.min}`,
    );
  }
  if (options?.max !== undefined && value > options.max) {
    throw new ProviderRuntimeFlagError(
      `${field} must be at most ${options.max}`,
    );
  }
  return value;
};

const parseOptionalPositiveInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
};

const parseOptionalFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const loadProviderConfigForAgentFlags = (
  provider: 'codex' | 'copilot' | 'lmstudio',
  options?: {
    codexHome?: string;
    copilotHome?: string;
    lmstudioHome?: string;
  },
) => {
  try {
    const snapshot = loadProviderChatDefaultsSnapshotSync({
      provider,
      ...(options?.codexHome ? { codexHome: options.codexHome } : {}),
      ...(options?.copilotHome ? { copilotHome: options.copilotHome } : {}),
      ...(options?.lmstudioHome
        ? { lmstudioHome: options.lmstudioHome }
        : provider === 'lmstudio' &&
            typeof getScopedEnvValue('CODEINFO_LMSTUDIO_HOME') === 'string' &&
            getScopedEnvValue('CODEINFO_LMSTUDIO_HOME')!.trim().length > 0
          ? { lmstudioHome: getScopedEnvValue('CODEINFO_LMSTUDIO_HOME') }
          : {}),
    });
    return snapshot.config ?? {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderRuntimeFlagError(
      `${provider}/chat/config.toml could not be loaded for agentFlags resolution (${message})`,
    );
  }
};

const parseOptionalLmStudioTemperature = (
  value: unknown,
): number | undefined => {
  const normalized = parseOptionalFiniteNumber(value);
  if (normalized === undefined) return undefined;
  if (
    normalized < LMSTUDIO_TEMPERATURE_MIN ||
    normalized > LMSTUDIO_TEMPERATURE_MAX
  ) {
    return undefined;
  }
  return normalized;
};

const parseOptionalLmStudioMaxTokens = (value: unknown): number | undefined => {
  const normalized = parseOptionalPositiveInteger(value);
  if (normalized === undefined) return undefined;
  if (normalized < LMSTUDIO_MAX_TOKENS_MIN) return undefined;
  return normalized;
};

export function resolveLmStudioConfigAgentFlags(options?: {
  lmstudioHome?: string;
}): LmStudioRuntimeAgentFlags {
  const config = loadProviderConfigForAgentFlags('lmstudio', {
    lmstudioHome: options?.lmstudioHome,
  });
  return {
    temperature:
      parseOptionalLmStudioTemperature(config.temperature) ??
      DEFAULT_LMSTUDIO_TEMPERATURE,
    maxTokens:
      parseOptionalLmStudioMaxTokens(config.max_tokens) ??
      DEFAULT_LMSTUDIO_MAX_TOKENS,
    contextOverflowPolicy:
      parseOptionalConfigString(
        config.context_overflow_policy,
        LMSTUDIO_CONTEXT_OVERFLOW_POLICIES,
      ) ?? DEFAULT_LMSTUDIO_CONTEXT_OVERFLOW_POLICY,
    toolAccess:
      parseOptionalConfigString(config.tool_access, TOOL_ACCESS_MODES) ??
      DEFAULT_LMSTUDIO_TOOL_ACCESS,
  };
}

export function resolveCopilotRuntimeAgentFlags(
  rawAgentFlags: unknown,
  options?: {
    modelSupportsReasoningEffort?: boolean;
  },
): CopilotRuntimeAgentFlags {
  const agentFlags = normalizeAgentFlagsInput('copilot', rawAgentFlags);
  const config = loadProviderConfigForAgentFlags('copilot');
  const configReasoningEffort =
    parseOptionalConfigString(
      config.reasoning_effort,
      COPILOT_REASONING_EFFORTS,
    ) ?? DEFAULT_COPILOT_REASONING_EFFORT;
  const configToolAccess =
    parseOptionalConfigString(config.tool_access, TOOL_ACCESS_MODES) ??
    DEFAULT_COPILOT_TOOL_ACCESS;

  return {
    modelReasoningEffort:
      options?.modelSupportsReasoningEffort === false
        ? undefined
        : agentFlags.modelReasoningEffort !== undefined
          ? parseChoice(
              agentFlags.modelReasoningEffort,
              'agentFlags.modelReasoningEffort',
              COPILOT_REASONING_EFFORTS,
            )
          : configReasoningEffort,
    toolAccess:
      agentFlags.toolAccess !== undefined
        ? parseChoice(
            agentFlags.toolAccess,
            'agentFlags.toolAccess',
            TOOL_ACCESS_MODES,
          )
        : configToolAccess,
  };
}

export function resolveLmStudioRuntimeAgentFlags(
  rawAgentFlags: unknown,
): LmStudioRuntimeAgentFlags {
  const agentFlags = normalizeAgentFlagsInput('lmstudio', rawAgentFlags);
  const configDefaults = resolveLmStudioConfigAgentFlags();

  return {
    temperature:
      agentFlags.temperature !== undefined
        ? parseFiniteNumber(agentFlags.temperature, 'agentFlags.temperature', {
            min: LMSTUDIO_TEMPERATURE_MIN,
            max: LMSTUDIO_TEMPERATURE_MAX,
          })
        : configDefaults.temperature,
    maxTokens:
      agentFlags.maxTokens !== undefined
        ? parseFiniteNumber(agentFlags.maxTokens, 'agentFlags.maxTokens', {
            min: LMSTUDIO_MAX_TOKENS_MIN,
            integer: true,
          })
        : configDefaults.maxTokens,
    contextOverflowPolicy:
      agentFlags.contextOverflowPolicy !== undefined
        ? parseChoice(
            agentFlags.contextOverflowPolicy,
            'agentFlags.contextOverflowPolicy',
            LMSTUDIO_CONTEXT_OVERFLOW_POLICIES,
          )
        : configDefaults.contextOverflowPolicy,
    toolAccess:
      agentFlags.toolAccess !== undefined
        ? parseChoice(
            agentFlags.toolAccess,
            'agentFlags.toolAccess',
            TOOL_ACCESS_MODES,
          )
        : configDefaults.toolAccess,
  };
}
