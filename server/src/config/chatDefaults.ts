import { loadRuntimeConfigSnapshot } from './runtimeConfig.js';

export type ChatDefaultProvider = 'codex' | 'lmstudio';
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

const FALLBACK_PROVIDER: ChatDefaultProvider = 'codex';
const FALLBACK_MODEL = 'gpt-5.3-codex';
export const STORY_47_TASK_1_LOG_MARKER =
  'DEV_0000047_T01_CODEX_DEFAULTS_APPLIED';
const VALID_PROVIDERS: readonly ChatDefaultProvider[] = ['codex', 'lmstudio'];
const FALLBACK_CODEX_SANDBOX_MODE = 'danger-full-access' as const;
const FALLBACK_CODEX_APPROVAL_POLICY = 'on-failure' as const;
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

const warningForUnreadableChatConfig = (reason: string) =>
  `Unable to read codex/chat/config.toml (${reason}); falling back to legacy env/hardcoded defaults.`;

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const readChatConfigSafely = async (params?: {
  codexHome?: string;
}): Promise<{ config?: Record<string, unknown>; warnings: string[] }> => {
  const warnings: string[] = [];
  try {
    const snapshot = await loadRuntimeConfigSnapshot({
      codexHome: params?.codexHome,
      bootstrapChatConfig: false,
    });
    if (snapshot.chatConfig && typeof snapshot.chatConfig === 'object') {
      return {
        config: snapshot.chatConfig as Record<string, unknown>,
        warnings,
      };
    }
    return { warnings };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(warningForUnreadableChatConfig(reason));
    return { warnings };
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
  const { config, warnings: configWarnings } = await readChatConfigSafely({
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

  const configApprovalPolicy = parseStringSetting<
    'untrusted' | 'on-request' | 'on-failure' | 'never'
  >(config?.approval_policy, APPROVAL_POLICIES);
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

  const configWebSearch = parseModeBoolean(config?.web_search);
  if (config && hasOwn(config, 'web_search') && configWebSearch === undefined) {
    warnings.push(warningForInvalidChatConfig('web_search'));
  }
  const configWebSearchAlias = parseModeBoolean(config?.web_search_request);
  if (
    config &&
    hasOwn(config, 'web_search_request') &&
    configWebSearchAlias === undefined
  ) {
    warnings.push(warningForInvalidChatConfig('web_search_request'));
  }
  const effectiveConfigWebSearch = configWebSearch ?? configWebSearchAlias;

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
    envValue: parseModelValue(process.env.CHAT_DEFAULT_MODEL),
    envName: 'CHAT_DEFAULT_MODEL',
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

const alternateProvider = (
  provider: ChatDefaultProvider,
): ChatDefaultProvider => (provider === 'codex' ? 'lmstudio' : 'codex');

export const resolveRuntimeProviderSelection = ({
  requestedProvider,
  requestedModel,
  codex,
  lmstudio,
}: {
  requestedProvider: ChatDefaultProvider;
  requestedModel: string;
  codex: RuntimeProviderState;
  lmstudio: RuntimeProviderState;
}): RuntimeProviderSelection => {
  const requestedState = requestedProvider === 'codex' ? codex : lmstudio;
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

  const fallbackProvider = alternateProvider(requestedProvider);
  const fallbackState = fallbackProvider === 'codex' ? codex : lmstudio;
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

  return {
    requestedProvider,
    requestedModel,
    executionProvider: requestedProvider,
    executionModel: requestedModel,
    fallbackApplied: false,
    unavailable: true,
    decision: 'unavailable',
    requestedReason: requestedState.reason,
    fallbackReason: fallbackState.reason,
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
      'CHAT_DEFAULT_PROVIDER is empty; using fallback provider defaults.',
    );
    return undefined;
  }
  if (!VALID_PROVIDERS.includes(trimmed as ChatDefaultProvider)) {
    warnings.push(
      `CHAT_DEFAULT_PROVIDER must be one of ${VALID_PROVIDERS.join(', ')}; received "${trimmed}". Using fallback provider defaults.`,
    );
    return undefined;
  }
  return trimmed as ChatDefaultProvider;
};

const parseEnvModel = (
  value: string | undefined,
  warnings: string[],
): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) {
    warnings.push(
      'CHAT_DEFAULT_MODEL is empty; using fallback model defaults.',
    );
    return undefined;
  }
  return trimmed;
};

export const resolveChatDefaults = ({
  requestProvider,
  requestModel,
}: {
  requestProvider?: ChatDefaultProvider;
  requestModel?: string;
}): ChatDefaultsResolution => {
  const warnings: string[] = [];
  const envProvider = parseEnvProvider(
    process.env.CHAT_DEFAULT_PROVIDER,
    warnings,
  );
  const envModel = parseEnvModel(process.env.CHAT_DEFAULT_MODEL, warnings);

  const provider = requestProvider ?? envProvider ?? FALLBACK_PROVIDER;
  const model = requestModel ?? envModel ?? FALLBACK_MODEL;

  return {
    provider,
    model,
    providerSource: requestProvider
      ? 'request'
      : envProvider
        ? 'env'
        : 'fallback',
    modelSource: requestModel ? 'request' : envModel ? 'env' : 'fallback',
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
