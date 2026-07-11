import type {
  ChatAgentFlagChoice,
  ChatAgentFlagDescriptor,
  ChatProviderDefaultsSource,
  ChatProviderId,
  ChatModelInfo,
  ChatProviderInfo,
  ChatProvidersResponse,
  ChatAgentFlagValue,
  ChatModelsResponse,
  ChatModelFlagOverride,
  CodexDefaults,
  CodexModelReasoningEffort,
} from '@codeinfo2/common';
import type { ModelInfo } from '@github/copilot-sdk';
import { discoverOpenAiCompatEndpointModels } from '../chat/openaiCompatModelDiscovery.js';
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
import {
  describeOpenAiCompatEndpoint,
  type OpenAiCompatEndpointConfig,
  parseOpenAiCompatEndpointConfig,
} from '../config/openaiCompatEndpoints.js';
import {
  getProviderBootstrapStatus,
  loadProviderChatDefaultsSnapshotSync,
} from '../config/runtimeConfig.js';
import { resolveExternalOpenAiCompatEndpoints } from '../config/startupEnv.js';
import { resolveConfiguredWebSearchMode } from '../config/webSearchMcp.js';
import type { CodexDetection } from '../providers/codexRegistry.js';
import type { CopilotReadinessResult } from '../providers/copilotReadiness.js';

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
  codex: 'gpt-5.6-sol',
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

export type OpenAiCompatProviderDiscoveryResult = {
  models: ChatModelInfo[];
  liveModels: string[];
  warnings: string[];
  selectedEndpointId?: string;
  selectedModelKey?: string;
};

type BuildProviderInfoParams = ProviderHomeParams & {
  provider: ChatProviderId;
  available: boolean;
  toolsAvailable: boolean;
  endpointOnly?: boolean;
  reason?: string;
  liveModels?: string[];
  warnings?: string[];
  agentFlags?: ChatAgentFlagDescriptor[];
  compatibility?: ChatProviderInfo['compatibility'];
  modelMetadata?: ProviderConfigModel;
};

const pickLiveProviderModel = (
  models: string[] | undefined,
  preferredModel: string,
): string | undefined => {
  const normalizedModels = (models ?? [])
    .map((model) => normalizeString(model))
    .filter((model): model is string => model !== undefined);
  if (normalizedModels.includes(preferredModel)) {
    return preferredModel;
  }
  return normalizedModels[0];
};

const providerSupportsOpenAiCompatEndpoint = (
  provider: ChatProviderId,
  endpoint: OpenAiCompatEndpointConfig,
): boolean =>
  provider === 'codex'
    ? endpoint.capabilities.includes('responses')
    : endpoint.capabilities.includes('completions');

function getProviderChatOpenAiCompatDefaults(params: {
  provider: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
  warnings: string[];
}): {
  configuredModel?: string;
  pinnedEndpoint?: OpenAiCompatEndpointConfig;
} {
  try {
    const snapshot = loadProviderChatDefaultsSnapshotSync({
      provider: params.provider,
      codexHome: params.codexHome,
      copilotHome: params.copilotHome,
      lmstudioHome: params.lmstudioHome,
    });
    const configuredModel = normalizeString(snapshot.config?.model);
    const rawEndpoint = snapshot.config?.codeinfo_openai_endpoint;
    if (typeof rawEndpoint !== 'string') {
      return { configuredModel };
    }
    return {
      configuredModel,
      pinnedEndpoint: parseOpenAiCompatEndpointConfig(rawEndpoint, {
        pathLabel: `${snapshot.chatConfigPath}.codeinfo_openai_endpoint`,
      }),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    params.warnings.push(
      `${params.provider}/chat/config.toml could not be used for external endpoint discovery (${reason}).`,
    );
    return {};
  }
}

const normalizeModelIdentity = (
  value: string | undefined,
): string | undefined => {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : undefined;
};

function resolveSelectedPinnedModelKey(params: {
  models: readonly Pick<ChatModelInfo, 'key' | 'endpointId'>[];
  configuredModel?: string;
  selectedEndpointId?: string;
}): string | undefined {
  if (!params.configuredModel || !params.selectedEndpointId) {
    return undefined;
  }

  const endpointModels = params.models.filter(
    (model) => (model.endpointId ?? undefined) === params.selectedEndpointId,
  );
  const exactMatch = endpointModels.find(
    (model) => model.key === params.configuredModel,
  );
  if (exactMatch) {
    return exactMatch.key;
  }

  const normalizedConfiguredModel = normalizeModelIdentity(
    params.configuredModel,
  );
  if (!normalizedConfiguredModel) {
    return undefined;
  }

  const normalizedMatches = endpointModels.filter(
    (model) => normalizeModelIdentity(model.key) === normalizedConfiguredModel,
  );
  return normalizedMatches.length === 1 ? normalizedMatches[0].key : undefined;
}

export async function resolveOpenAiCompatProviderDiscovery(params: {
  provider: ChatProviderId;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OpenAiCompatProviderDiscoveryResult> {
  const warnings: string[] = [];
  const envResolution = resolveExternalOpenAiCompatEndpoints({
    env: params.env ?? process.env,
  });
  warnings.push(...envResolution.warnings);

  const providerChatDefaults = getProviderChatOpenAiCompatDefaults({
    provider: params.provider,
    codexHome: params.codexHome,
    copilotHome: params.copilotHome,
    lmstudioHome: params.lmstudioHome,
    warnings,
  });
  const pinnedEndpoint = providerChatDefaults.pinnedEndpoint;
  if (
    pinnedEndpoint &&
    !providerSupportsOpenAiCompatEndpoint(params.provider, pinnedEndpoint)
  ) {
    warnings.push(
      `${params.provider}/chat/config.toml pinned endpoint "${pinnedEndpoint.endpointId}" is ignored for discovery because it does not advertise the capabilities required by provider "${params.provider}".`,
    );
  }

  const discovery = await discoverOpenAiCompatEndpointModels({
    endpoints: envResolution.endpoints.filter((endpoint) =>
      providerSupportsOpenAiCompatEndpoint(params.provider, endpoint),
    ),
    provider:
      params.provider === 'codex' || params.provider === 'copilot'
        ? params.provider
        : undefined,
    pinnedEndpoint:
      pinnedEndpoint &&
      providerSupportsOpenAiCompatEndpoint(params.provider, pinnedEndpoint)
        ? pinnedEndpoint
        : undefined,
    fetchImpl: params.fetchImpl,
    timeoutMs: params.timeoutMs,
  });

  warnings.push(...discovery.warnings.map((warning) => warning.message));

  const models: ChatModelInfo[] = [];
  const liveModels: string[] = [];
  for (const endpoint of discovery.endpoints) {
    for (const modelId of endpoint.modelIds) {
      models.push({
        key: modelId,
        displayName: endpoint.endpoint.displayLabel
          ? `${describeOpenAiCompatEndpoint(endpoint.endpoint)} / ${modelId}`
          : modelId,
        type: params.provider,
        endpointId: endpoint.endpoint.endpointId,
        endpointLabel: endpoint.endpoint.displayLabel?.trim() || undefined,
      });
      liveModels.push(modelId);
    }
  }

  const selectedEndpointId =
    discovery.selectedEndpointId &&
    models.some(
      (model) =>
        (model.endpointId ?? undefined) === discovery.selectedEndpointId,
    )
      ? discovery.selectedEndpointId
      : undefined;

  return {
    models,
    liveModels,
    warnings,
    selectedEndpointId,
    selectedModelKey: resolveSelectedPinnedModelKey({
      models,
      configuredModel: providerChatDefaults.configuredModel,
      selectedEndpointId,
    }),
  };
}

export function buildCodexCompatibilityDefaults(params: {
  capabilities: CodexCapabilityResolution;
  codexHome?: string;
  warnings?: string[];
}): CodexDefaults {
  const bootstrapStatus = getProviderBootstrapStatus('codex');
  if (bootstrapStatus.warnings.length > 0) {
    params.warnings?.push(...bootstrapStatus.warnings);
  }
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
  const webSearchMode = resolveConfiguredWebSearchMode(config);

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
      webSearchMode ?? params.capabilities.defaults.webSearchMode ?? 'live',
  };
}

export function buildEndpointOnlyProviderWarning(
  provider: Extract<ChatProviderId, 'codex' | 'copilot'>,
): string {
  return `${
    provider === 'codex' ? 'Codex' : 'Copilot'
  } authentication is unavailable; showing external OpenAI-compatible endpoint models only.`;
}

export function isCodexEndpointOnlyAvailable(params: {
  detection: Pick<CodexDetection, 'available' | 'authPresent'>;
  bootstrapHealthy: boolean;
  endpointModelCount: number;
}): boolean {
  return (
    !params.detection.available &&
    !params.detection.authPresent &&
    params.bootstrapHealthy &&
    params.endpointModelCount > 0
  );
}

export function isCopilotEndpointOnlyAvailable(params: {
  readiness: Pick<CopilotReadinessResult, 'available' | 'blockingStage'>;
  bootstrapHealthy: boolean;
  endpointModelCount: number;
}): boolean {
  return (
    !params.readiness.available &&
    params.readiness.blockingStage === 'authentication' &&
    params.bootstrapHealthy &&
    params.endpointModelCount > 0
  );
}

export function selectProviderNativeAndEndpointModels<T>(params: {
  nativeAvailable: boolean;
  nativeModels: T[];
  endpointModels: T[];
}): T[] {
  return params.nativeAvailable
    ? [...params.nativeModels, ...params.endpointModels]
    : [...params.endpointModels];
}

export function selectProviderNativeAndEndpointLiveModels(params: {
  nativeAvailable: boolean;
  nativeModels: string[];
  endpointModels: string[];
}): string[] {
  return [
    ...new Set(
      selectProviderNativeAndEndpointModels({
        nativeAvailable: params.nativeAvailable,
        nativeModels: params.nativeModels,
        endpointModels: params.endpointModels,
      }),
    ),
  ];
}

export function getProviderBootstrapWarnings(
  provider: ChatProviderId,
): string[] {
  return getProviderBootstrapStatus(provider).warnings;
}

export function isProviderBootstrapHealthy(provider: ChatProviderId): boolean {
  return getProviderBootstrapStatus(provider).healthy;
}

export function getProviderBootstrapReason(
  provider: ChatProviderId,
): string | undefined {
  return getProviderBootstrapStatus(provider).reason;
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
  params: ProviderHomeParams & { liveModels?: string[] } = {},
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
    const requestedModel = configuredModel ?? seedModel;
    const resolvedModel =
      pickLiveProviderModel(params.liveModels, requestedModel) ??
      requestedModel;
    if (resolvedModel !== requestedModel) {
      return {
        defaultModel: resolvedModel,
        defaultModelSource: configuredModel ? 'config' : 'hardcoded',
        warnings: [
          `${provider} default model "${requestedModel}" is unavailable in the live model list; normalized to "${resolvedModel}".`,
        ],
      };
    }
    return {
      defaultModel: resolvedModel,
      defaultModelSource: configuredModel ? 'config' : 'hardcoded',
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
    endpointOnly: params.endpointOnly ?? false,
    reason: params.reason,
    defaultModel: modelMetadata.defaultModel,
    defaultModelSource: modelMetadata.defaultModelSource,
    warnings: warnings.length > 0 ? warnings : [],
    agentFlags: params.agentFlags,
    compatibility: params.compatibility,
  };
}

const NON_USER_FACING_WARNING_PATTERNS = [
  /^Skipping config-pinned endpoint .*; it is already present after normalization$/,
] as const;

export function filterUserFacingWarnings(
  warnings?: readonly string[],
): string[] | undefined {
  if (!warnings) {
    return undefined;
  }

  return warnings.filter(
    (warning) =>
      !NON_USER_FACING_WARNING_PATTERNS.some((pattern) =>
        pattern.test(warning),
      ),
  );
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
  selectedEndpointId?: string;
  fallbackApplied?: boolean;
  compatibility?: ChatProvidersResponse['compatibility'];
  codexDefaults?: CodexDefaults;
  codexWarnings?: string[];
}): ChatProvidersResponse {
  return {
    providers: orderProviders(params.providerMap, params.selectedProvider),
    selectedProvider: params.selectedProvider,
    selectedModel: params.selectedModel,
    selectedEndpointId: params.selectedEndpointId,
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
  selectedEndpointId?: string;
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
    selectedEndpointId: params.selectedEndpointId,
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
