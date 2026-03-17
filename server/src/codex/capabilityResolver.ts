import {
  CODEX_MODEL_REASONING_EFFORTS,
  type CodexDefaults,
} from '@codeinfo2/common';
import { resolveCodexChatDefaults } from '../config/chatDefaults.js';
import {
  getCodexModelList,
  mergeCodexModelList,
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
  resolveReasoningEffortsMetadata?: () => string | undefined;
  codexHome?: string;
};

const TASK7_LOG_MARKER = 'DEV_0000040_T07_REST_DEFAULTS_APPLIED';

const parseNetworkAccessEnv = (
  value: string | undefined,
  warnings: string[],
): boolean => {
  if (value === undefined) {
    return true;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  warnings.push(
    'Codex_network_access_enabled must be "true" or "false"; using default "true" instead.',
  );
  return true;
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

export const resolveCodexCapabilities = async (
  options: ResolveCodexCapabilitiesOptions,
): Promise<CodexCapabilityResolution> => {
  const codexDefaults = await resolveCodexChatDefaults({
    codexHome: options.codexHome ?? process.env.CODEX_HOME,
  });
  const modelList = getCodexModelList();
  const mergedModels = mergeCodexModelList(
    modelList.models,
    codexDefaults.values.model,
  );
  const warnings = [...codexDefaults.warnings, ...modelList.warnings];
  const resolveReasoningEffortsMetadata =
    options.resolveReasoningEffortsMetadata ??
    (() => process.env.Codex_reasoning_efforts_metadata);

  try {
    const metadata = parseReasoningEffortsMetadata(
      resolveReasoningEffortsMetadata(),
      warnings,
    );

    const normalizedEfforts = Array.from(
      new Set([...metadata.efforts, codexDefaults.values.modelReasoningEffort]),
    );
    const defaultReasoningEffort = normalizedEfforts.includes(
      codexDefaults.values.modelReasoningEffort,
    )
      ? codexDefaults.values.modelReasoningEffort
      : (normalizedEfforts[0] ?? codexDefaults.values.modelReasoningEffort);

    const models = mergedModels.map((model) => ({
      model,
      supportedReasoningEfforts: normalizedEfforts,
      defaultReasoningEffort,
    }));

    const networkAccessEnabled = parseNetworkAccessEnv(
      process.env.Codex_network_access_enabled,
      warnings,
    );
    const defaults: CodexDefaults = {
      sandboxMode: codexDefaults.values.sandboxMode,
      approvalPolicy: codexDefaults.values.approvalPolicy,
      modelReasoningEffort: codexDefaults.values.modelReasoningEffort,
      networkAccessEnabled,
      webSearchEnabled: codexDefaults.values.webSearch !== 'disabled',
    };

    const resolution: CodexCapabilityResolution = {
      defaults,
      models,
      byModel: new Map(models.map((entry) => [entry.model, entry])),
      warnings,
      fallbackUsed: modelList.fallbackUsed || metadata.fallbackUsed,
    };

    console.info(TASK7_LOG_MARKER, {
      surface: options.consumer,
      warningCount: warnings.length,
      defaultsSources: codexDefaults.sources,
      defaults,
    });

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
      codexDefaults.values.modelReasoningEffort,
    ];
    const normalizedFallbackEfforts = Array.from(new Set(fallbackEfforts));
    const fallbackDefault =
      codexDefaults.values.modelReasoningEffort ?? normalizedFallbackEfforts[0];
    const models = mergedModels.map((model) => ({
      model,
      supportedReasoningEfforts: normalizedFallbackEfforts,
      defaultReasoningEffort: fallbackDefault,
    }));
    const networkAccessEnabled = parseNetworkAccessEnv(
      process.env.Codex_network_access_enabled,
      warnings,
    );
    const defaults: CodexDefaults = {
      sandboxMode: codexDefaults.values.sandboxMode,
      approvalPolicy: codexDefaults.values.approvalPolicy,
      modelReasoningEffort: codexDefaults.values.modelReasoningEffort,
      networkAccessEnabled,
      webSearchEnabled: codexDefaults.values.webSearch !== 'disabled',
    };

    baseLogger.error(
      {
        consumer: options.consumer,
        code: 'codex_capability_resolution_failed',
        message: error instanceof Error ? error.message : String(error),
      },
      T13_ERROR_LOG,
    );

    return {
      defaults,
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
