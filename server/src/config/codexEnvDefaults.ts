import type { CodexDefaults as SharedCodexDefaults } from '@codeinfo2/common';
import { baseLogger } from '../logger.js';
import {
  approvalPolicies,
  modelReasoningEfforts,
  sandboxModes,
} from '../routes/chatValidators.js';

export type CodexDefaults = SharedCodexDefaults;

const DEFAULT_CODEX_DEFAULTS: CodexDefaults = {
  sandboxMode: 'danger-full-access',
  approvalPolicy: 'on-failure',
  modelReasoningEffort: 'high',
  networkAccessEnabled: true,
  webSearchEnabled: true,
};

const DEFAULT_CODEX_MODEL_LIST = [
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.1',
  'gpt-5.2',
  'gpt-5.2-codex',
];

const parseEnumEnv = <T extends string>(
  envName: string,
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  warnings: string[],
): { value: T; envVarPresent: boolean } => {
  if (value === undefined) {
    return { value: fallback, envVarPresent: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    warnings.push(`${envName} is empty; using default "${fallback}" instead.`);
    return { value: fallback, envVarPresent: true };
  }

  if (!allowed.includes(trimmed as T)) {
    warnings.push(
      `${envName} must be one of ${allowed.join(', ')}; received "${trimmed}". Using default "${fallback}" instead.`,
    );
    return { value: fallback, envVarPresent: true };
  }

  return { value: trimmed as T, envVarPresent: true };
};

const parseBooleanEnv = (
  envName: string,
  value: string | undefined,
  fallback: boolean,
  warnings: string[],
): { value: boolean; envVarPresent: boolean } => {
  if (value === undefined) {
    return { value: fallback, envVarPresent: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    warnings.push(`${envName} is empty; using default "${fallback}" instead.`);
    return { value: fallback, envVarPresent: true };
  }

  const normalized = trimmed.toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') {
    warnings.push(
      `${envName} must be "true" or "false"; received "${trimmed}". Using default "${fallback}" instead.`,
    );
    return { value: fallback, envVarPresent: true };
  }

  return { value: normalized === 'true', envVarPresent: true };
};

export const getCodexEnvDefaults = (): {
  defaults: CodexDefaults;
  warnings: string[];
} => {
  const warnings: string[] = [];

  const sandboxMode = parseEnumEnv(
    'Codex_sandbox_mode',
    process.env.Codex_sandbox_mode,
    sandboxModes,
    DEFAULT_CODEX_DEFAULTS.sandboxMode,
    warnings,
  );
  const approvalPolicy = parseEnumEnv(
    'Codex_approval_policy',
    process.env.Codex_approval_policy,
    approvalPolicies,
    DEFAULT_CODEX_DEFAULTS.approvalPolicy,
    warnings,
  );
  const modelReasoningEffort = parseEnumEnv(
    'Codex_reasoning_effort',
    process.env.Codex_reasoning_effort,
    modelReasoningEfforts as CodexDefaults['modelReasoningEffort'][],
    DEFAULT_CODEX_DEFAULTS.modelReasoningEffort,
    warnings,
  );
  const networkAccessEnabled = parseBooleanEnv(
    'Codex_network_access_enabled',
    process.env.Codex_network_access_enabled,
    DEFAULT_CODEX_DEFAULTS.networkAccessEnabled,
    warnings,
  );
  const webSearchEnabled = parseBooleanEnv(
    'Codex_web_search_enabled',
    process.env.Codex_web_search_enabled,
    DEFAULT_CODEX_DEFAULTS.webSearchEnabled,
    warnings,
  );

  const defaults: CodexDefaults = {
    sandboxMode: sandboxMode.value,
    approvalPolicy: approvalPolicy.value,
    modelReasoningEffort: modelReasoningEffort.value,
    networkAccessEnabled: networkAccessEnabled.value,
    webSearchEnabled: webSearchEnabled.value,
  };

  baseLogger.info(
    {
      defaults,
      warningsCount: warnings.length,
    },
    '[codex-env-defaults] resolved',
  );

  return { defaults, warnings };
};

export const getCodexModelList = (): {
  models: string[];
  warnings: string[];
  fallbackUsed: boolean;
} => {
  const warnings: string[] = [];
  const rawList = process.env.Codex_model_list;

  if (rawList === undefined) {
    return {
      models: DEFAULT_CODEX_MODEL_LIST,
      warnings,
      fallbackUsed: true,
    };
  }

  const parsed = rawList
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const models = Array.from(new Set(parsed));

  if (models.length === 0) {
    warnings.push(
      'Codex_model_list is empty; using the default model list instead.',
    );
    return {
      models: DEFAULT_CODEX_MODEL_LIST,
      warnings,
      fallbackUsed: true,
    };
  }

  return {
    models,
    warnings,
    fallbackUsed: false,
  };
};
