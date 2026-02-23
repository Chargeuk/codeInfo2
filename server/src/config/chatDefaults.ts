export type ChatDefaultProvider = 'codex' | 'lmstudio';

type ResolutionSource = 'request' | 'env' | 'fallback';

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

const FALLBACK_PROVIDER: ChatDefaultProvider = 'codex';
const FALLBACK_MODEL = 'gpt-5.3-codex';
const VALID_PROVIDERS: readonly ChatDefaultProvider[] = ['codex', 'lmstudio'];

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
