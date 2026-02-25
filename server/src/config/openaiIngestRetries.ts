import { OPENAI_RETRY_DEFAULT_MAX_RETRIES } from '../ingest/providers/openaiConstants.js';

/**
 * OPENAI_INGEST_MAX_RETRIES is the number of retry attempts
 * after the initial attempt.
 */
export const resolveOpenAiIngestMaxRetries = (
  env: Record<string, string | undefined> = process.env,
): number => {
  const raw = env.OPENAI_INGEST_MAX_RETRIES;
  if (!raw) return OPENAI_RETRY_DEFAULT_MAX_RETRIES;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return OPENAI_RETRY_DEFAULT_MAX_RETRIES;
  }

  return parsed;
};

export const getOpenAiIngestMaxRetries = (): number =>
  resolveOpenAiIngestMaxRetries();
