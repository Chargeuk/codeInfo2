export type ChatDefaultProvider = 'codex' | 'lmstudio';

type ResolutionSource = 'request' | 'env' | 'fallback';

export type ChatDefaultsResolution = {
  provider: ChatDefaultProvider;
  model: string;
  providerSource: ResolutionSource;
  modelSource: ResolutionSource;
  warnings: string[];
};

const FALLBACK_PROVIDER: ChatDefaultProvider = 'codex';
const FALLBACK_MODEL = 'gpt-5.3-codex';
const VALID_PROVIDERS: readonly ChatDefaultProvider[] = ['codex', 'lmstudio'];

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
