import {
  DEFAULT_CHAT_PROVIDER_ID,
  ORDERED_CHAT_PROVIDER_IDS,
  type ChatProviderId,
} from '@codeinfo2/common';
import {
  getProviderChatConfigPath,
  loadProviderChatDefaultsSnapshotSync,
} from './runtimeConfig.js';

export type ChatDefaultProvider = ChatProviderId;
export type CodexWebSearchMode = 'live' | 'cached' | 'disabled';
export type CodexDefaultSource = 'override' | 'config' | 'env' | 'hardcoded';

type ResolutionSource = 'request' | 'config' | 'env' | 'fallback';

export type ChatDefaultsResolution = {
  provider: ChatDefaultProvider;
  model: string;
  providerSource: ResolutionSource;
  modelSource: ResolutionSource;
  warnings: string[];
};

export class ChatDefaultsResolutionError extends Error {
  readonly provider: ChatDefaultProvider;
  readonly configPath: string;

  constructor(params: {
    provider: ChatDefaultProvider;
    configPath: string;
    message: string;
  }) {
    super(params.message);
    this.name = 'ChatDefaultsResolutionError';
    this.provider = params.provider;
    this.configPath = params.configPath;
  }
}

export type RuntimeProviderState = {
  available: boolean;
  models: string[];
  reason?: string;
};

export type RuntimeProviderSelection = {
  requestedProvider: ChatDefaultProvider;
  requestedModel: string;
  executionProvider: ChatDefaultProvider;
  executionModel: string;
  fallbackApplied: boolean;
  unavailable: boolean;
  decision: 'selected' | 'fallback' | 'unavailable';
  requestedReason?: string;
  fallbackReason?: string;
};

export type CodexChatDefaultOverrides = {
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never';
  modelReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  model?: string;
  webSearch?: CodexWebSearchMode;
  webSearchRequest?: boolean;
};

export type ResolvedCodexChatDefaults = {
  values: {
    sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy: 'untrusted' | 'on-request' | 'on-failure' | 'never';
    modelReasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    model: string;
    webSearch: CodexWebSearchMode;
  };
  sources: {
    sandboxMode: CodexDefaultSource;
    approvalPolicy: CodexDefaultSource;
    modelReasoningEffort: CodexDefaultSource;
    model: CodexDefaultSource;
    webSearch: CodexDefaultSource;
  };
  warnings: string[];
};

export type DefaultsAppliedMarkerPayload = {
  surface: string;
  requested_provider: ChatDefaultProvider;
  requested_model: string;
  resolved_model: string;
  model_source: ResolutionSource;
  codex_model_source?: CodexDefaultSource;
  success: true;
  warning_count: number;
  warnings: string[];
};

export const ORDERED_CHAT_PROVIDERS = ORDERED_CHAT_PROVIDER_IDS;

const FALLBACK_PROVIDER: ChatDefaultProvider = DEFAULT_CHAT_PROVIDER_ID;
const FALLBACK_MODEL = 'gpt-5.3-codex';
export const STORY_47_TASK_1_LOG_MARKER =
  'DEV_0000047_T01_CODEX_DEFAULTS_APPLIED';
const VALID_PROVIDERS: readonly ChatDefaultProvider[] = ORDERED_CHAT_PROVIDERS;
const FALLBACK_CODEX_SANDBOX_MODE = 'danger-full-access' as const;
const FALLBACK_CODEX_APPROVAL_POLICY = 'on-request' as const;
const FALLBACK_CODEX_REASONING = 'high' as const;
const FALLBACK_CODEX_MODEL = FALLBACK_MODEL;
const FALLBACK_CODEX_WEB_SEARCH = 'live' as const;
const SANDBOX_MODES = new Set([
  'read-only',
  'workspace-write',
  'danger-full-access',
]);
const APPROVAL_POLICIES = new Set([
  'untrusted',
  'on-request',
  'on-failure',
  'never',
]);
const MODEL_REASONING_EFFORTS = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);
const WEB_SEARCH_MODES = new Set(['live', 'cached', 'disabled']);

export const buildDefaultsAppliedMarkerPayload = (params: {
  surface: string;
  requestedProvider: ChatDefaultProvider;
  requestedModel: string;
  resolvedModel: string;
  modelSource: ResolutionSource;
  codexModelSource?: CodexDefaultSource;
  warnings: string[];
  extras?: Record<string, unknown>;
}): DefaultsAppliedMarkerPayload & Record<string, unknown> => ({
  surface: params.surface,
  requested_provider: params.requestedProvider,
  requested_model: params.requestedModel,
  resolved_model: params.resolvedModel,
  model_source: params.modelSource,
  codex_model_source: params.codexModelSource,
  success: true,
  warning_count: params.warnings.length,
  warnings: [...params.warnings],
  ...(params.extras ?? {}),
});

const parseModeBoolean = (value: unknown): CodexWebSearchMode | undefined => {
  if (typeof value === 'boolean') {
    return value ? 'live' : 'disabled';
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return 'live';
  if (normalized === 'false') return 'disabled';
  if (WEB_SEARCH_MODES.has(normalized)) {
    return normalized as CodexWebSearchMode;
  }
  return undefined;
};

const parseStringSetting = <T extends string>(
  value: unknown,
  allowed: Set<string>,
): T | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!allowed.has(trimmed)) return undefined;
  return trimmed as T;
};

const parseModelValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseLegacyBooleanEnv = (
  value: string | undefined,
): CodexWebSearchMode | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true') return 'live';
  if (trimmed === 'false') return 'disabled';
  return undefined;
};

const warningForLegacyEnvFallback = (field: string, envName: string) =>
  `Codex default field "${field}" fell back to legacy env "${envName}".`;

const warningForInvalidChatConfig = (field: string) =>
  `codex/chat/config.toml has invalid value for "${field}", falling back to env/hardcoded defaults.`;

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const warningForMissingProviderConfig = (
  provider: ChatDefaultProvider,
  configPath: string,
) =>
  `${provider}/chat/config.toml is missing at ${configPath}; provider defaults are unavailable.`;

const warningForUnreadableProviderConfig = (
  provider: ChatDefaultProvider,
  reason: string,
) =>
  `${provider}/chat/config.toml could not be read (${reason}); provider defaults are unavailable.`;

const warningForInvalidProviderConfig = (
  provider: ChatDefaultProvider,
  reason: string,
) =>
  `${provider}/chat/config.toml is invalid (${reason}); provider defaults are unavailable.`;

const warningForLegacyCodexApproval = (value: string) =>
  `codex/chat/config.toml uses legacy approval_policy "${value}"; normalized to "on-request".`;

const warningForLegacyCodexWebSearch = (field: string) =>
  `codex/chat/config.toml uses legacy ${field}; normalized to web_search_mode.`;

const readProviderConfigSafely = (params: {
  provider: ChatDefaultProvider;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
}): {
  config?: Record<string, unknown>;
  configPath: string;
  warnings: string[];
} => {
  const warnings: string[] = [];
  const { chatConfigPath } = getProviderChatConfigPath({
    provider: params.provider,
    codexHome: params.codexHome,
    copilotHome: params.copilotHome,
    lmstudioHome: params.lmstudioHome,
  });
  try {
    const snapshot = loadProviderChatDefaultsSnapshotSync({
      provider: params.provider,
      codexHome: params.codexHome,
      copilotHome: params.copilotHome,
      lmstudioHome: params.lmstudioHome,
    });
    if (snapshot.config && typeof snapshot.config === 'object') {
      return {
        config: snapshot.config as Record<string, unknown>,
        configPath: snapshot.chatConfigPath,
        warnings,
      };
    }
    warnings.push(
      warningForMissingProviderConfig(params.provider, snapshot.chatConfigPath),
    );
    return { configPath: snapshot.chatConfigPath, warnings };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message =
      reason.includes('RUNTIME_CONFIG_INVALID:') ||
      reason.includes('Invalid TOML')
        ? warningForInvalidProviderConfig(params.provider, reason)
        : warningForUnreadableProviderConfig(params.provider, reason);
    warnings.push(message);
    return { configPath: chatConfigPath, warnings };
  }
};

const resolveFieldWithPrecedence = <T>(params: {
  field: string;
  configValue: T | undefined;
  overrideValue: T | undefined;
  envValue: T | undefined;
  envName: string;
  hardcoded: T;
  warnings: string[];
}): { value: T; source: CodexDefaultSource } => {
  if (params.overrideValue !== undefined) {
    return { value: params.overrideValue, source: 'override' };
  }
  if (params.configValue !== undefined) {
    return { value: params.configValue, source: 'config' };
  }
  if (params.envValue !== undefined) {
    params.warnings.push(
      warningForLegacyEnvFallback(params.field, params.envName),
    );
    return { value: params.envValue, source: 'env' };
  }
  return { value: params.hardcoded, source: 'hardcoded' };
};

export const resolveCodexChatDefaults = async (params?: {
  codexHome?: string;
  overrides?: CodexChatDefaultOverrides;
}): Promise<ResolvedCodexChatDefaults> => {
  const warnings: string[] = [];
  const { config, warnings: configWarnings } = readProviderConfigSafely({
    provider: 'codex',
    codexHome: params?.codexHome,
  });
  warnings.push(...configWarnings);

  const configSandboxMode = parseStringSetting<
    'read-only' | 'workspace-write' | 'danger-full-access'
  >(config?.sandbox_mode, SANDBOX_MODES);
  if (
    config &&
    hasOwn(config, 'sandbox_mode') &&
    configSandboxMode === undefined
  ) {
    warnings.push(warningForInvalidChatConfig('sandbox_mode'));
  }

  let configApprovalPolicy = parseStringSetting<
    'untrusted' | 'on-request' | 'on-failure' | 'never'
  >(config?.approval_policy, APPROVAL_POLICIES);
  if (configApprovalPolicy === 'on-failure') {
    warnings.push(warningForLegacyCodexApproval('on-failure'));
    configApprovalPolicy = 'on-request';
  }
  if (
    config &&
    hasOwn(config, 'approval_policy') &&
    configApprovalPolicy === undefined
  ) {
    warnings.push(warningForInvalidChatConfig('approval_policy'));
  }

  const configModelReasoning = parseStringSetting<
    'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  >(config?.model_reasoning_effort, MODEL_REASONING_EFFORTS);
  if (
    config &&
    hasOwn(config, 'model_reasoning_effort') &&
    configModelReasoning === undefined
  ) {
    warnings.push(warningForInvalidChatConfig('model_reasoning_effort'));
  }

  const configModel = parseModelValue(config?.model);
  if (config && hasOwn(config, 'model') && configModel === undefined) {
    warnings.push(warningForInvalidChatConfig('model'));
  }

  const configWebSearchMode = parseModeBoolean(config?.web_search_mode);
  if (
    config &&
    hasOwn(config, 'web_search_mode') &&
    configWebSearchMode === undefined
  ) {
    warnings.push(warningForInvalidChatConfig('web_search_mode'));
  }
  const configWebSearch = parseModeBoolean(config?.web_search);
  if (config && hasOwn(config, 'web_search') && configWebSearch === undefined) {
    warnings.push(warningForInvalidChatConfig('web_search'));
  } else if (config && hasOwn(config, 'web_search')) {
    warnings.push(warningForLegacyCodexWebSearch('web_search'));
  }
  const configWebSearchAlias = parseModeBoolean(config?.web_search_request);
  if (
    config &&
    hasOwn(config, 'web_search_request') &&
    configWebSearchAlias === undefined
  ) {
    warnings.push(warningForInvalidChatConfig('web_search_request'));
  } else if (config && hasOwn(config, 'web_search_request')) {
    warnings.push(warningForLegacyCodexWebSearch('web_search_request'));
  }
  const effectiveConfigWebSearch =
    configWebSearchMode ?? configWebSearch ?? configWebSearchAlias;

  const overrideWebSearch =
    params?.overrides?.webSearch ??
    parseModeBoolean(params?.overrides?.webSearchRequest);

  const sandboxMode = resolveFieldWithPrecedence({
    field: 'sandbox_mode',
    overrideValue: params?.overrides?.sandboxMode,
    configValue: configSandboxMode,
    envValue: parseStringSetting<
      'read-only' | 'workspace-write' | 'danger-full-access'
    >(process.env.Codex_sandbox_mode, SANDBOX_MODES),
    envName: 'Codex_sandbox_mode',
    hardcoded: FALLBACK_CODEX_SANDBOX_MODE,
    warnings,
  });
  const approvalPolicy = resolveFieldWithPrecedence({
    field: 'approval_policy',
    overrideValue: params?.overrides?.approvalPolicy,
    configValue: configApprovalPolicy,
    envValue: parseStringSetting<
      'untrusted' | 'on-request' | 'on-failure' | 'never'
    >(process.env.Codex_approval_policy, APPROVAL_POLICIES),
    envName: 'Codex_approval_policy',
    hardcoded: FALLBACK_CODEX_APPROVAL_POLICY,
    warnings,
  });
  const modelReasoningEffort = resolveFieldWithPrecedence({
    field: 'model_reasoning_effort',
    overrideValue: params?.overrides?.modelReasoningEffort,
    configValue: configModelReasoning,
    envValue: parseStringSetting<
      'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    >(process.env.Codex_reasoning_effort, MODEL_REASONING_EFFORTS),
    envName: 'Codex_reasoning_effort',
    hardcoded: FALLBACK_CODEX_REASONING,
    warnings,
  });
  const model = resolveFieldWithPrecedence({
    field: 'model',
    overrideValue: parseModelValue(params?.overrides?.model),
    configValue: configModel,
    envValue: undefined,
    envName: 'CODEINFO_CHAT_DEFAULT_MODEL',
    hardcoded: FALLBACK_CODEX_MODEL,
    warnings,
  });
  const webSearch = resolveFieldWithPrecedence({
    field: 'web_search',
    overrideValue: overrideWebSearch,
    configValue: effectiveConfigWebSearch,
    envValue: parseLegacyBooleanEnv(process.env.Codex_web_search_enabled),
    envName: 'Codex_web_search_enabled',
    hardcoded: FALLBACK_CODEX_WEB_SEARCH,
    warnings,
  });

  console.info('DEV_0000040_T06_CHAT_DEFAULT_RESOLVER', {
    sandbox_mode: { source: sandboxMode.source, value: sandboxMode.value },
    approval_policy: {
      source: approvalPolicy.source,
      value: approvalPolicy.value,
    },
    model_reasoning_effort: {
      source: modelReasoningEffort.source,
      value: modelReasoningEffort.value,
    },
    model: { source: model.source, value: model.value },
    web_search: { source: webSearch.source, value: webSearch.value },
    warningCount: warnings.length,
  });

  return {
    values: {
      sandboxMode: sandboxMode.value,
      approvalPolicy: approvalPolicy.value,
      modelReasoningEffort: modelReasoningEffort.value,
      model: model.value,
      webSearch: webSearch.value,
    },
    sources: {
      sandboxMode: sandboxMode.source,
      approvalPolicy: approvalPolicy.source,
      modelReasoningEffort: modelReasoningEffort.source,
      model: model.source,
      webSearch: webSearch.source,
    },
    warnings,
  };
};

const firstSelectableModel = (models: string[]): string | undefined => {
  for (const model of models) {
    if (typeof model !== 'string') continue;
    const trimmed = model.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
};

const getProviderState = (
  provider: ChatDefaultProvider,
  states: Record<ChatDefaultProvider, RuntimeProviderState>,
): RuntimeProviderState => states[provider];

const getFallbackProviders = (requestedProvider: ChatDefaultProvider) =>
  ORDERED_CHAT_PROVIDERS.filter((provider) => provider !== requestedProvider);

export const resolveRuntimeProviderSelection = ({
  requestedProvider,
  requestedModel,
  codex,
  copilot,
  lmstudio,
}: {
  requestedProvider: ChatDefaultProvider;
  requestedModel: string;
  codex: RuntimeProviderState;
  copilot: RuntimeProviderState;
  lmstudio: RuntimeProviderState;
}): RuntimeProviderSelection => {
  const providerStates: Record<ChatDefaultProvider, RuntimeProviderState> = {
    codex,
    copilot,
    lmstudio,
  };
  const requestedState = getProviderState(requestedProvider, providerStates);
  if (requestedState.available) {
    return {
      requestedProvider,
      requestedModel,
      executionProvider: requestedProvider,
      executionModel: requestedModel,
      fallbackApplied: false,
      unavailable: false,
      decision: 'selected',
      requestedReason: requestedState.reason,
    };
  }

  for (const fallbackProvider of getFallbackProviders(requestedProvider)) {
    const fallbackState = getProviderState(fallbackProvider, providerStates);
    const fallbackModel = firstSelectableModel(fallbackState.models);
    if (fallbackState.available && fallbackModel) {
      return {
        requestedProvider,
        requestedModel,
        executionProvider: fallbackProvider,
        executionModel: fallbackModel,
        fallbackApplied: true,
        unavailable: false,
        decision: 'fallback',
        requestedReason: requestedState.reason,
        fallbackReason: fallbackState.reason,
      };
    }
  }

  return {
    requestedProvider,
    requestedModel,
    executionProvider: requestedProvider,
    executionModel: requestedModel,
    fallbackApplied: false,
    unavailable: true,
    decision: 'unavailable',
    requestedReason: requestedState.reason,
    fallbackReason: getFallbackProviders(requestedProvider)
      .map((provider) => getProviderState(provider, providerStates).reason)
      .find((reason) => typeof reason === 'string' && reason.length > 0),
  };
};

const parseEnvProvider = (
  value: string | undefined,
  warnings: string[],
): ChatDefaultProvider | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) {
    warnings.push(
      'CODEINFO_CHAT_DEFAULT_PROVIDER is empty; using fallback provider defaults.',
    );
    return undefined;
  }
  if (!VALID_PROVIDERS.includes(trimmed as ChatDefaultProvider)) {
    warnings.push(
      `CODEINFO_CHAT_DEFAULT_PROVIDER must be one of ${VALID_PROVIDERS.join(', ')}; received "${trimmed}". Using fallback provider defaults.`,
    );
    return undefined;
  }
  return trimmed as ChatDefaultProvider;
};

const parseProviderChatModel = (
  provider: ChatDefaultProvider,
  config: Record<string, unknown> | undefined,
  warnings: string[],
): string | undefined => {
  const model = parseModelValue(config?.model);
  if (!config) return undefined;
  if (hasOwn(config, 'model') && model === undefined) {
    warnings.push(
      `${provider}/chat/config.toml has invalid value for "model"; provider defaults are unavailable.`,
    );
  }
  return model;
};

const resolveProviderDefaultModel = (params: {
  provider: ChatDefaultProvider;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
}): { model: string; warnings: string[] } => {
  const { config, warnings, configPath } = readProviderConfigSafely({
    provider: params.provider,
    codexHome: params.codexHome,
    copilotHome: params.copilotHome,
    lmstudioHome: params.lmstudioHome,
  });
  const model = parseProviderChatModel(params.provider, config, warnings);
  if (model) {
    return { model, warnings };
  }
  throw new ChatDefaultsResolutionError({
    provider: params.provider,
    configPath,
    message: `${params.provider}/chat/config.toml could not provide a valid default model.`,
  });
};

export const resolveChatDefaults = ({
  requestProvider,
  requestModel,
  codexHome,
  copilotHome,
  lmstudioHome,
}: {
  requestProvider?: ChatDefaultProvider;
  requestModel?: string;
  codexHome?: string;
  copilotHome?: string;
  lmstudioHome?: string;
}): ChatDefaultsResolution => {
  const warnings: string[] = [];
  const envProvider = parseEnvProvider(
    process.env.CODEINFO_CHAT_DEFAULT_PROVIDER,
    warnings,
  );
  const requestedProvider = requestProvider ?? envProvider ?? FALLBACK_PROVIDER;

  if (requestModel) {
    return {
      provider: requestedProvider,
      model: requestModel,
      providerSource: requestProvider
        ? 'request'
        : envProvider
          ? 'env'
          : 'fallback',
      modelSource: 'request',
      warnings,
    };
  }

  const providerOrder: ChatDefaultProvider[] = [
    requestedProvider,
    ...ORDERED_CHAT_PROVIDERS.filter(
      (provider) => provider !== requestedProvider,
    ),
  ];

  const explicitProviderSelected = requestProvider !== undefined;
  let lastError: ChatDefaultsResolutionError | undefined;
  for (const provider of providerOrder) {
    try {
      const resolvedModel = resolveProviderDefaultModel({
        provider,
        codexHome,
        copilotHome,
        lmstudioHome,
      });
      return {
        provider,
        model: resolvedModel.model,
        providerSource:
          provider === requestProvider
            ? 'request'
            : provider === envProvider
              ? 'env'
              : 'fallback',
        modelSource: 'config',
        warnings: [...warnings, ...resolvedModel.warnings],
      };
    } catch (error) {
      if (error instanceof ChatDefaultsResolutionError) {
        lastError = error;
        if (explicitProviderSelected) {
          throw error;
        }
        warnings.push(error.message);
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return {
    provider: requestedProvider,
    model: FALLBACK_MODEL,
    providerSource: requestProvider
      ? 'request'
      : envProvider
        ? 'env'
        : 'fallback',
    modelSource: 'fallback',
    warnings,
  };
};

export const toChatResolutionSource = (
  source: CodexDefaultSource,
): ResolutionSource => {
  if (source === 'override') return 'request';
  if (source === 'hardcoded') return 'fallback';
  return source;
};

export const toCodexDefaultSource = (
  source: ResolutionSource,
): CodexDefaultSource => {
  if (source === 'request') return 'override';
  if (source === 'fallback') return 'hardcoded';
  return source;
};
