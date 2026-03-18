import { OPENAI_RETRY_DEFAULT_MAX_RETRIES } from '../ingest/providers/openaiConstants.js';

/**
 * CODEINFO_OPENAI_INGEST_MAX_RETRIES is the number of retry attempts
 * after the initial attempt.
 */
export const resolveOpenAiIngestMaxRetries = (
  env: Record<string, string | undefined> = process.env,
): number => {
  const raw = env.CODEINFO_OPENAI_INGEST_MAX_RETRIES;
  if (!raw) return OPENAI_RETRY_DEFAULT_MAX_RETRIES;

  const normalized = raw.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    return OPENAI_RETRY_DEFAULT_MAX_RETRIES;
  }

  return Number(normalized);
};

export const getOpenAiIngestMaxRetries = (): number =>
  resolveOpenAiIngestMaxRetries();
