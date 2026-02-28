import {
  CODEX_MODEL_REASONING_EFFORTS,
  type CodexDefaults,
} from '@codeinfo2/common';
import {
  getCodexEnvDefaults,
  getCodexModelList,
} from '../config/codexEnvDefaults.js';
import { baseLogger } from '../logger.js';

const T13_SUCCESS_LOG =
  '[DEV-0000037][T13] event=shared_capability_resolver_parity_enforced result=success';
const T13_ERROR_LOG =
  '[DEV-0000037][T13] event=shared_capability_resolver_parity_enforced result=error';

export type CodexModelCapability = {
  model: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
};

export type CodexCapabilityResolution = {
  defaults: CodexDefaults;
  models: CodexModelCapability[];
  byModel: Map<string, CodexModelCapability>;
  warnings: string[];
  fallbackUsed: boolean;
};

export type ResolveCodexCapabilitiesOptions = {
  consumer: 'chat_models' | 'chat_validation';
};

const parseReasoningEffortsMetadata = (
  raw: string | undefined,
  warnings: string[],
) => {
  if (raw === undefined) {
    return {
      efforts: [...CODEX_MODEL_REASONING_EFFORTS],
      fallbackUsed: true,
    };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    warnings.push(
      'Codex_reasoning_efforts_metadata is empty; using default reasoning capabilities.',
    );
    return {
      efforts: [...CODEX_MODEL_REASONING_EFFORTS],
      fallbackUsed: true,
    };
  }

  if (trimmed === '__throw__') {
    throw new Error(
      'Codex reasoning capability metadata resolution failed intentionally.',
    );
  }

  const parsed = trimmed
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const efforts = Array.from(new Set(parsed));

  if (efforts.length === 0) {
    warnings.push(
      'Codex_reasoning_efforts_metadata produced no usable values; using default reasoning capabilities.',
    );
    return {
      efforts: [...CODEX_MODEL_REASONING_EFFORTS],
      fallbackUsed: true,
    };
  }

  return { efforts, fallbackUsed: false };
};

export const resolveCodexCapabilities = (
  options: ResolveCodexCapabilitiesOptions,
): CodexCapabilityResolution => {
  const codexEnv = getCodexEnvDefaults();
  const modelList = getCodexModelList();
  const warnings = [...codexEnv.warnings, ...modelList.warnings];

  try {
    const metadata = parseReasoningEffortsMetadata(
      process.env.Codex_reasoning_efforts_metadata,
      warnings,
    );

    const normalizedEfforts = Array.from(
      new Set([...metadata.efforts, codexEnv.defaults.modelReasoningEffort]),
    );
    const defaultReasoningEffort = normalizedEfforts.includes(
      codexEnv.defaults.modelReasoningEffort,
    )
      ? codexEnv.defaults.modelReasoningEffort
      : (normalizedEfforts[0] ?? codexEnv.defaults.modelReasoningEffort);

    const models = modelList.models.map((model) => ({
      model,
      supportedReasoningEfforts: normalizedEfforts,
      defaultReasoningEffort,
    }));

    const resolution: CodexCapabilityResolution = {
      defaults: codexEnv.defaults,
      models,
      byModel: new Map(models.map((entry) => [entry.model, entry])),
      warnings,
      fallbackUsed: modelList.fallbackUsed || metadata.fallbackUsed,
    };

    baseLogger.info(
      {
        consumer: options.consumer,
        modelCount: models.length,
        warningCount: warnings.length,
        fallbackUsed: resolution.fallbackUsed,
      },
      T13_SUCCESS_LOG,
    );

    return resolution;
  } catch (error) {
    const fallbackEfforts = [
      ...CODEX_MODEL_REASONING_EFFORTS,
      codexEnv.defaults.modelReasoningEffort,
    ];
    const normalizedFallbackEfforts = Array.from(new Set(fallbackEfforts));
    const fallbackDefault =
      codexEnv.defaults.modelReasoningEffort ?? normalizedFallbackEfforts[0];
    const models = modelList.models.map((model) => ({
      model,
      supportedReasoningEfforts: normalizedFallbackEfforts,
      defaultReasoningEffort: fallbackDefault,
    }));

    baseLogger.error(
      {
        consumer: options.consumer,
        code: 'codex_capability_resolution_failed',
        message: error instanceof Error ? error.message : String(error),
      },
      T13_ERROR_LOG,
    );

    return {
      defaults: codexEnv.defaults,
      models,
      byModel: new Map(models.map((entry) => [entry.model, entry])),
      warnings: [
        ...warnings,
        'Codex capability metadata resolution failed; using fallback capabilities.',
      ],
      fallbackUsed: true,
    };
  }
};

export const getCodexCapabilityForModel = (
  resolution: CodexCapabilityResolution,
  model: string,
): CodexModelCapability => {
  const selected = resolution.byModel.get(model);
  if (selected) return selected;

  return (
    resolution.models[0] ?? {
      model,
      supportedReasoningEfforts: [...CODEX_MODEL_REASONING_EFFORTS],
      defaultReasoningEffort: resolution.defaults.modelReasoningEffort,
    }
  );
};
