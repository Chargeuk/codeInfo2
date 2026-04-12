export const OPENAI_PROVIDER_ID = 'openai' as const;

export const OPENAI_EMBEDDING_MODEL_ALLOWLIST = [
  'text-embedding-3-small',
  'text-embedding-3-large',
] as const;

export const OPENAI_MAX_INPUTS_PER_REQUEST = 2048;
export const OPENAI_MAX_TOTAL_TOKENS_PER_REQUEST = 300_000;

export const OPENAI_RETRY_DEFAULT_MAX_RETRIES = 3;
// Backward-compatible alias retained for existing imports/tests.
export const OPENAI_RETRY_MAX_RETRIES = OPENAI_RETRY_DEFAULT_MAX_RETRIES;
export const OPENAI_RETRY_BASE_DELAY_MS = 500;
export const OPENAI_RETRY_MAX_DELAY_MS = 8_000;
export const OPENAI_RETRY_JITTER_MIN = 0.75;
export const OPENAI_RETRY_JITTER_MAX = 1.0;

export const OPENAI_REQUEST_TIMEOUT_MS = 30_000;

const OPENAI_MODEL_TOKEN_LIMITS: Record<string, number> = {
  'text-embedding-3-small': 8192,
  'text-embedding-3-large': 8192,
};

export function resolveOpenAiModelTokenLimit(model: string): number {
  const trimmed = model.trim();
  return OPENAI_MODEL_TOKEN_LIMITS[trimmed] ?? 8192;
}

export function isOpenAiAllowlistedEmbeddingModel(model: string): boolean {
  return OPENAI_EMBEDDING_MODEL_ALLOWLIST.includes(
    model as (typeof OPENAI_EMBEDDING_MODEL_ALLOWLIST)[number],
  );
}
