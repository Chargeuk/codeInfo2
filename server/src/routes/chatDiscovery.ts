import type {
  ChatAgentFlagChoice,
  ChatAgentFlagDescriptor,
  ChatProviderDefaultsSource,
  ChatProviderId,
  ChatProviderInfo,
  ChatProvidersResponse,
  ChatAgentFlagValue,
  ChatModelsResponse,
  ChatModelFlagOverride,
  CodexDefaults,
  CodexModelReasoningEffort,
} from '@codeinfo2/common';
import type { ModelInfo } from '@github/copilot-sdk';
import {
  DEFAULT_LMSTUDIO_CONTEXT_OVERFLOW_POLICY,
  DEFAULT_LMSTUDIO_MAX_TOKENS,
  DEFAULT_LMSTUDIO_TEMPERATURE,
  DEFAULT_LMSTUDIO_TOOL_ACCESS,
  copilotReasoningEfforts,
  parseOptionalConfigString,
  resolveLmStudioConfigAgentFlags,
  toolAccessModes,
} from '../chat/providerRuntimeFlags.js';
import type {
  CodexCapabilityResolution,
  CodexModelCapability,
} from '../codex/capabilityResolver.js';
import { ORDERED_CHAT_PROVIDERS } from '../config/chatDefaults.js';
import { loadProviderChatDefaultsSnapshotSync } from '../config/runtimeConfig.js';

const toChoice = (
  value: ChatAgentFlagValue,
  label: string,
): ChatAgentFlagChoice => ({
  value,
  label,
});

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const aggregateModelChoices = (
  values: string[],
  labels?: Partial<Record<string, string>>,
): ChatAgentFlagChoice[] =>
  Array.from(new Set(values)).map((value) =>
    toChoice(value, labels?.[value] ?? value),
  );

const DEFAULT_COPILOT_REASONING_EFFORT = 'medium';
const DEFAULT_COPILOT_TOOL_ACCESS = 'on';
const DEFAULT_CODEX_REASONING_SUMMARY = 'auto';
const DEFAULT_CODEX_VERBOSITY = 'medium';

const COPILOT_TOOL_ACCESS_CHOICES = [
  toChoice('on', 'On'),
  toChoice('off', 'Off'),
] as const;

const LMSTUDIO_CONTEXT_OVERFLOW_CHOICES = [
  toChoice('stopAtLimit', 'Stop At Limit'),
  toChoice('truncateMiddle', 'Truncate Middle'),
  toChoice('rollingWindow', 'Rolling Window'),
] as const;

const CODEX_SANDBOX_CHOICES = [
  toChoice('read-only', 'Read Only'),
  toChoice('workspace-write', 'Workspace Write'),
  toChoice('danger-full-access', 'Danger Full Access'),
] as const;

const CODEX_APPROVAL_CHOICES = [
  toChoice('untrusted', 'Untrusted'),
  toChoice('on-request', 'On Request'),
  toChoice('never', 'Never'),
] as const;

const CODEX_REASONING_SUMMARY_CHOICES = [
  toChoice('auto', 'Auto'),
  toChoice('concise', 'Concise'),
  toChoice('detailed', 'Detailed'),
  toChoice('none', 'None'),
] as const;

const CODEX_VERBOSITY_CHOICES = [
  toChoice('low', 'Low'),
  toChoice('medium', 'Medium'),
  toChoice('high', 'High'),
] as const;

const CODEX_WEB_SEARCH_CHOICES = [
  toChoice('disabled', 'Disabled'),
  toChoice('cached', 'Cached'),
  toChoice('live', 'Live'),
] as const;

const PROVIDER_LABELS: Record<ChatProviderId, string> = {
  codex: 'OpenAI Codex',
  copilot: 'GitHub Copilot',
  lmstudio: 'LM Studio',
};

const DEFAULT_PROVIDER_MODELS = {
  codex: 'gpt-5.3-codex',
  copilot: 'copilot-gpt-5',
  lmstudio: 'model-1',
} as const;

type ProviderHomeParams = {
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
};

type ProviderConfigModel = {
  defaultModel: string;
  defaultModelSource: ChatProviderDefaultsSource;
  warnings: string[];
};

type BuildProviderInfoParams = ProviderHomeParams & {
  provider: ChatProviderId;
  available: boolean;
  toolsAvailable: boolean;
  reason?: string;
  warnings?: string[];
  agentFlags?: ChatAgentFlagDescriptor[];
  compatibility?: ChatProviderInfo['compatibility'];
  modelMetadata?: ProviderConfigModel;
};

export function buildCodexCompatibilityDefaults(params: {
  capabilities: CodexCapabilityResolution;
  codexHome?: string;
  warnings?: string[];
}): CodexDefaults {
  let config: Record<string, unknown> = {};

  try {
    const snapshot = loadProviderChatDefaultsSnapshotSync({
      provider: 'codex',
      codexHome: params.codexHome,
    });
    config = snapshot.config ?? {};
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    params.warnings?.push(
      `codex/chat/config.toml could not be loaded for discovery defaults resolution (${reason}).`,
    );
  }

  const modelReasoningSummary = normalizeString(config.model_reasoning_summary);
  const modelVerbosity = normalizeString(config.model_verbosity);
  const webSearchMode = normalizeString(config.web_search_mode);

  return {
    ...params.capabilities.defaults,
    modelReasoningSummary:
      modelReasoningSummary === 'auto' ||
      modelReasoningSummary === 'concise' ||
      modelReasoningSummary === 'detailed' ||
      modelReasoningSummary === 'none'
        ? modelReasoningSummary
        : DEFAULT_CODEX_REASONING_SUMMARY,
    modelVerbosity:
      modelVerbosity === 'low' ||
      modelVerbosity === 'medium' ||
      modelVerbosity === 'high'
        ? modelVerbosity
        : DEFAULT_CODEX_VERBOSITY,
    webSearchMode:
      webSearchMode === 'disabled' ||
      webSearchMode === 'cached' ||
      webSearchMode === 'live'
        ? webSearchMode
        : (params.capabilities.defaults.webSearchMode ?? 'live'),
  };
}

export function buildCodexAgentFlags(params: {
  capabilities: CodexCapabilityResolution;
  codexHome?: string;
  defaults?: CodexDefaults;
}): ChatAgentFlagDescriptor[] {
  const defaults = params.defaults ?? buildCodexCompatibilityDefaults(params);
  const reasoningChoices = aggregateModelChoices(
    params.capabilities.models.flatMap(
      (entry) => entry.supportedReasoningEfforts,
    ),
    {
      minimal: 'Minimal',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      xhigh: 'Extra High',
    },
  );

  return [
    {
      key: 'sandboxMode',
      label: 'Sandbox Mode',
      controlType: 'select',
      editable: true,
      seedDefault: 'danger-full-access',
      resolvedDefault: defaults.sandboxMode,
      supportedValues: [...CODEX_SANDBOX_CHOICES],
    },
    {
      key: 'approvalPolicy',
      label: 'Approval Policy',
      controlType: 'select',
      editable: true,
      seedDefault: 'on-request',
      resolvedDefault:
        defaults.approvalPolicy === 'on-failure'
          ? 'on-request'
          : defaults.approvalPolicy,
      supportedValues: [...CODEX_APPROVAL_CHOICES],
    },
    {
      key: 'modelReasoningEffort',
      label: 'Reasoning Effort',
      controlType: 'select',
      editable: true,
      seedDefault: 'high',
      resolvedDefault: defaults.modelReasoningEffort,
      supportedValues: reasoningChoices,
    },
    {
      key: 'modelReasoningSummary',
      label: 'Reasoning Summary',
      controlType: 'select',
      editable: true,
      seedDefault: DEFAULT_CODEX_REASONING_SUMMARY,
      resolvedDefault:
        defaults.modelReasoningSummary ?? DEFAULT_CODEX_REASONING_SUMMARY,
      supportedValues: [...CODEX_REASONING_SUMMARY_CHOICES],
    },
    {
      key: 'modelVerbosity',
      label: 'Verbosity',
      controlType: 'select',
      editable: true,
      seedDefault: DEFAULT_CODEX_VERBOSITY,
      resolvedDefault: defaults.modelVerbosity ?? DEFAULT_CODEX_VERBOSITY,
      supportedValues: [...CODEX_VERBOSITY_CHOICES],
    },
    {
      key: 'networkAccessEnabled',
      label: 'Network Access',
      controlType: 'boolean',
      editable: true,
      seedDefault: true,
      resolvedDefault: defaults.networkAccessEnabled,
    },
    {
      key: 'webSearchMode',
      label: 'Web Search Mode',
      controlType: 'select',
      editable: true,
      seedDefault: 'live',
      resolvedDefault: defaults.webSearchMode ?? 'live',
      supportedValues: [...CODEX_WEB_SEARCH_CHOICES],
    },
  ];
}

function buildProviderModelMetadata(
  provider: ChatProviderId,
  params: ProviderHomeParams = {},
): ProviderConfigModel {
  const seedModel = DEFAULT_PROVIDER_MODELS[provider];

  try {
    const snapshot = loadProviderChatDefaultsSnapshotSync({
      provider,
      codexHome: params.codexHome,
      copilotHome: params.copilotHome,
      lmstudioHome: params.lmstudioHome,
    });
    const config = snapshot.config ?? {};
    const configuredModel = normalizeString(config.model);
    if (configuredModel) {
      return {
        defaultModel: configuredModel,
        defaultModelSource: 'config',
        warnings: [],
      };
    }
    return {
      defaultModel: seedModel,
      defaultModelSource: 'hardcoded',
      warnings: [],
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      defaultModel: seedModel,
      defaultModelSource: 'hardcoded',
      warnings: [
        `${provider}/chat/config.toml could not be used for default model resolution (${reason}).`,
      ],
    };
  }
}

export function buildProviderInfo(
  params: BuildProviderInfoParams,
): ChatProviderInfo {
  const modelMetadata =
    params.modelMetadata ?? buildProviderModelMetadata(params.provider, params);
  const warnings = [...modelMetadata.warnings, ...(params.warnings ?? [])];

  return {
    id: params.provider,
    label: PROVIDER_LABELS[params.provider],
    available: params.available,
    toolsAvailable: params.toolsAvailable,
    reason: params.reason,
    defaultModel: modelMetadata.defaultModel,
    defaultModelSource: modelMetadata.defaultModelSource,
    warnings: warnings.length > 0 ? warnings : [],
    agentFlags: params.agentFlags,
    compatibility: params.compatibility,
  };
}

export function orderProviders(
  providerMap: Record<ChatProviderId, ChatProviderInfo>,
  selectedProvider: ChatProviderId,
): ChatProviderInfo[] {
  const orderedIds: ChatProviderId[] = [
    selectedProvider,
    ...ORDERED_CHAT_PROVIDERS.filter((id) => id !== selectedProvider),
  ];

  return orderedIds.map((id) => providerMap[id]);
}

export function buildProvidersResponse(params: {
  providerMap: Record<ChatProviderId, ChatProviderInfo>;
  selectedProvider: ChatProviderId;
  selectedModel?: string;
  fallbackApplied?: boolean;
  compatibility?: ChatProvidersResponse['compatibility'];
  codexDefaults?: CodexDefaults;
  codexWarnings?: string[];
}): ChatProvidersResponse {
  return {
    providers: orderProviders(params.providerMap, params.selectedProvider),
    selectedProvider: params.selectedProvider,
    selectedModel: params.selectedModel,
    fallbackApplied: params.fallbackApplied,
    compatibility: params.compatibility,
    codexDefaults: params.codexDefaults,
    codexWarnings: params.codexWarnings,
  };
}

export function buildModelsResponse(params: {
  provider: ChatProviderId;
  available: boolean;
  toolsAvailable: boolean;
  reason?: string;
  models: ChatModelsResponse['models'];
  providers: ChatProviderInfo[];
  providerInfo: ChatProviderInfo;
  compatibility?: ChatModelsResponse['compatibility'];
  codexDefaults?: CodexDefaults;
  codexWarnings?: string[];
}): ChatModelsResponse {
  return {
    provider: params.provider,
    available: params.available,
    toolsAvailable: params.toolsAvailable,
    reason: params.reason,
    models: params.models,
    providers: params.providers,
    providerInfo: params.providerInfo,
    agentFlags: params.providerInfo.agentFlags,
    defaultModel: params.providerInfo.defaultModel,
    defaultModelSource: params.providerInfo.defaultModelSource,
    warnings: params.providerInfo.warnings,
    compatibility: params.compatibility,
    codexDefaults: params.codexDefaults,
    codexWarnings: params.codexWarnings,
  };
}

export function buildCodexModelFlagOverrides(
  capability: CodexModelCapability,
): ChatModelFlagOverride[] {
  return [
    {
      key: 'modelReasoningEffort',
      resolvedDefault: capability.defaultReasoningEffort,
      supportedValues: aggregateModelChoices(
        capability.supportedReasoningEfforts,
        {
          minimal: 'Minimal',
          low: 'Low',
          medium: 'Medium',
          high: 'High',
          xhigh: 'Extra High',
        },
      ),
    },
  ];
}

export function buildCopilotAgentFlags(params: {
  models: ModelInfo[];
  copilotHome?: string;
}): {
  agentFlags: ChatAgentFlagDescriptor[];
  warnings: string[];
} {
  let config: Record<string, unknown> = {};
  const warnings: string[] = [];

  try {
    const snapshot = loadProviderChatDefaultsSnapshotSync({
      provider: 'copilot',
      copilotHome: params.copilotHome,
    });
    config = snapshot.config ?? {};
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(
      `copilot/chat/config.toml could not be loaded for agentFlags resolution (${reason}).`,
    );
  }

  const configuredReasoningEffort =
    parseOptionalConfigString(
      config.reasoning_effort,
      copilotReasoningEfforts,
    ) ?? DEFAULT_COPILOT_REASONING_EFFORT;
  const configuredToolAccess =
    parseOptionalConfigString(config.tool_access, toolAccessModes) ??
    DEFAULT_COPILOT_TOOL_ACCESS;
  const reasoningChoices = aggregateModelChoices(
    params.models.flatMap((model) => {
      if (!Array.isArray(model.supportedReasoningEfforts)) return [];
      return model.supportedReasoningEfforts.flatMap((entry) =>
        typeof entry === 'string' && entry.trim().length > 0
          ? [entry.trim()]
          : [],
      );
    }),
    {
      minimal: 'Minimal',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      xhigh: 'Extra High',
    },
  );

  return {
    agentFlags: [
      {
        key: 'modelReasoningEffort',
        label: 'Reasoning Effort',
        controlType: 'select',
        editable: true,
        seedDefault: DEFAULT_COPILOT_REASONING_EFFORT,
        resolvedDefault: configuredReasoningEffort,
        supportedValues:
          reasoningChoices.length > 0
            ? reasoningChoices
            : [
                toChoice('low', 'Low'),
                toChoice('medium', 'Medium'),
                toChoice('high', 'High'),
              ],
      },
      {
        key: 'toolAccess',
        label: 'Tool Access',
        controlType: 'select',
        editable: true,
        seedDefault: DEFAULT_COPILOT_TOOL_ACCESS,
        resolvedDefault: configuredToolAccess,
        supportedValues: [...COPILOT_TOOL_ACCESS_CHOICES],
      },
    ],
    warnings,
  };
}

export function buildCopilotModelFlagOverrides(
  model: ModelInfo,
): ChatModelFlagOverride[] {
  const supportedReasoningEfforts = Array.isArray(
    model.supportedReasoningEfforts,
  )
    ? model.supportedReasoningEfforts.flatMap((entry) =>
        typeof entry === 'string' && entry.trim().length > 0
          ? [entry.trim()]
          : [],
      )
    : [];
  const defaultReasoningEffort = normalizeString(model.defaultReasoningEffort);

  if (supportedReasoningEfforts.length === 0 && !defaultReasoningEffort) {
    return [];
  }

  return [
    {
      key: 'modelReasoningEffort',
      resolvedDefault: defaultReasoningEffort,
      supportedValues: aggregateModelChoices(supportedReasoningEfforts, {
        minimal: 'Minimal',
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        xhigh: 'Extra High',
      }),
    },
  ];
}

export function buildLmStudioAgentFlags(params: { lmstudioHome?: string }): {
  agentFlags: ChatAgentFlagDescriptor[];
  warnings: string[];
} {
  const warnings: string[] = [];
  let configDefaults = {
    temperature: DEFAULT_LMSTUDIO_TEMPERATURE,
    maxTokens: DEFAULT_LMSTUDIO_MAX_TOKENS,
    contextOverflowPolicy: DEFAULT_LMSTUDIO_CONTEXT_OVERFLOW_POLICY,
    toolAccess: DEFAULT_LMSTUDIO_TOOL_ACCESS,
  };

  try {
    configDefaults = resolveLmStudioConfigAgentFlags({
      lmstudioHome: params.lmstudioHome,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(reason);
  }

  return {
    agentFlags: [
      {
        key: 'temperature',
        label: 'Temperature',
        controlType: 'number',
        editable: true,
        seedDefault: DEFAULT_LMSTUDIO_TEMPERATURE,
        resolvedDefault: configDefaults.temperature,
        min: 0,
        max: 2,
      },
      {
        key: 'maxTokens',
        label: 'Max Tokens',
        controlType: 'number',
        editable: true,
        seedDefault: DEFAULT_LMSTUDIO_MAX_TOKENS,
        resolvedDefault: configDefaults.maxTokens,
        min: 1,
        integer: true,
      },
      {
        key: 'contextOverflowPolicy',
        label: 'Context Overflow Policy',
        controlType: 'select',
        editable: true,
        seedDefault: DEFAULT_LMSTUDIO_CONTEXT_OVERFLOW_POLICY,
        resolvedDefault: configDefaults.contextOverflowPolicy,
        supportedValues: [...LMSTUDIO_CONTEXT_OVERFLOW_CHOICES],
      },
      {
        key: 'toolAccess',
        label: 'Tool Access',
        controlType: 'select',
        editable: true,
        seedDefault: DEFAULT_LMSTUDIO_TOOL_ACCESS,
        resolvedDefault: configDefaults.toolAccess,
        supportedValues: [...COPILOT_TOOL_ACCESS_CHOICES],
      },
    ],
    warnings,
  };
}

export function toCompatibilityCodexWarnings(
  warnings: string[] | undefined,
): string[] {
  return warnings ? [...warnings] : [];
}

export function toCompatibilityReasoningEfforts(
  value: ChatModelFlagOverride[] | undefined,
): {
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
} {
  const reasoningOverride = value?.find(
    (entry) => entry.key === 'modelReasoningEffort',
  );
  const supportedReasoningEfforts = reasoningOverride?.supportedValues
    ?.map((entry) =>
      typeof entry.value === 'string' ? entry.value : undefined,
    )
    .filter((entry): entry is string => entry !== undefined);
  const defaultReasoningEffort =
    typeof reasoningOverride?.resolvedDefault === 'string'
      ? reasoningOverride.resolvedDefault
      : undefined;

  return {
    supportedReasoningEfforts,
    defaultReasoningEffort,
  };
}

export function normalizeCodexReasoningEffort(
  value: string,
): CodexModelReasoningEffort {
  const normalized = value as CodexModelReasoningEffort;
  if (
    normalized === 'minimal' ||
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high' ||
    normalized === 'xhigh'
  ) {
    return normalized;
  }
  return 'high';
}
