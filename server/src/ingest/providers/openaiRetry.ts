import { delayWithAbort, runWithRetry } from '../../agents/retry.js';
import { getOpenAiIngestMaxRetries } from '../../config/openaiIngestRetries.js';
import {
  OPENAI_RETRY_BASE_DELAY_MS,
  OPENAI_RETRY_JITTER_MAX,
  OPENAI_RETRY_JITTER_MIN,
  OPENAI_RETRY_MAX_DELAY_MS,
} from './openaiConstants.js';
import {
  OpenAiEmbeddingError,
  isRetryableOpenAiCode,
  mapOpenAiError,
} from './openaiErrors.js';
import { appendIngestFailureLog } from './ingestFailureLogging.js';

export type RetryHeaders = Headers | Record<string, unknown> | undefined;

function getHeaderValue(
  headers: RetryHeaders,
  headerName: string,
): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    const value = headers.get(headerName);
    return value ?? undefined;
  }

  const entries = Object.entries(headers);
  const match = entries.find(
    ([key]) => key.toLowerCase() === headerName.toLowerCase(),
  );
  if (!match) return undefined;
  const value = match[1];
  return typeof value === 'string' ? value : undefined;
}

function parseRetryAfterMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function parseRetryAfterSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return Math.floor(asNumber * 1000);
  }

  const asDate = Date.parse(value);
  if (!Number.isFinite(asDate)) return undefined;
  const waitMs = asDate - Date.now();
  if (waitMs <= 0) return undefined;
  return Math.floor(waitMs);
}

export function resolveRetryAfterMs(headers: RetryHeaders): number | undefined {
  const hintMs = parseRetryAfterMs(getHeaderValue(headers, 'retry-after-ms'));
  if (typeof hintMs === 'number') return hintMs;

  return parseRetryAfterSeconds(getHeaderValue(headers, 'retry-after'));
}

export function computeExponentialDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  const base = OPENAI_RETRY_BASE_DELAY_MS * 2 ** exponent;
  const bounded = Math.min(OPENAI_RETRY_MAX_DELAY_MS, base);
  const jitter =
    OPENAI_RETRY_JITTER_MIN +
    Math.random() * (OPENAI_RETRY_JITTER_MAX - OPENAI_RETRY_JITTER_MIN);
  return Math.floor(bounded * jitter);
}

export async function runOpenAiWithRetry<T>(params: {
  model: string;
  inputCount: number;
  tokenEstimate: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  ingestFailureContext?: () => {
    runId?: string;
    path?: string;
    root?: string;
    currentFile?: string;
  };
  runStep: (attempt: number) => Promise<T>;
}): Promise<T> {
  let nextDelayMs = OPENAI_RETRY_BASE_DELAY_MS;
  let attemptCounter = 0;
  let terminalLogged = false;

  try {
    const maxRetries = getOpenAiIngestMaxRetries();
    return await runWithRetry({
      maxAttempts: maxRetries + 1,
      baseDelayMs: OPENAI_RETRY_BASE_DELAY_MS,
      signal: params.signal,
      sleep: async (_delayMs: number, signal?: AbortSignal) =>
        (params.sleep ?? delayWithAbort)(nextDelayMs, signal),
      isRetryableError: (error: unknown) => {
        const mapped = mapOpenAiError(error);
        return isRetryableOpenAiCode(mapped.code);
      },
      runStep: async () => {
        attemptCounter += 1;
        return params.runStep(attemptCounter);
      },
      onRetry: ({ attempt, error }) => {
        const mapped = mapOpenAiError(error);
        const retryAfterMs = resolveRetryAfterMs(
          error && typeof error === 'object'
            ? ((error as { headers?: RetryHeaders }).headers ?? undefined)
            : undefined,
        );
        nextDelayMs =
          typeof retryAfterMs === 'number'
            ? retryAfterMs
            : computeExponentialDelayMs(attempt);

        appendIngestFailureLog('warn', {
          ...params.ingestFailureContext?.(),
          provider: 'openai',
          code: mapped.code,
          retryable: mapped.retryable,
          attempt,
          waitMs: nextDelayMs,
          model: params.model,
          message: mapped.message,
          stage: 'retry',
          ...(typeof mapped.upstreamStatus === 'number'
            ? { upstreamStatus: mapped.upstreamStatus }
            : {}),
          ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
        });
      },
      onExhausted: ({ attempt, error }) => {
        const mapped = mapOpenAiError(error);
        terminalLogged = true;
        appendIngestFailureLog('error', {
          ...params.ingestFailureContext?.(),
          provider: 'openai',
          code: mapped.code,
          retryable: mapped.retryable,
          attempt,
          model: params.model,
          message: mapped.message,
          stage: 'terminal',
          ...(typeof mapped.upstreamStatus === 'number'
            ? { upstreamStatus: mapped.upstreamStatus }
            : {}),
        });
      },
    });
  } catch (error) {
    const mapped = mapOpenAiError(error);
    const retryAfterMs = resolveRetryAfterMs(
      error && typeof error === 'object'
        ? ((error as { headers?: RetryHeaders }).headers ?? undefined)
        : undefined,
    );
    if (!terminalLogged) {
      appendIngestFailureLog('error', {
        ...params.ingestFailureContext?.(),
        provider: 'openai',
        code: mapped.code,
        retryable: mapped.retryable,
        attempt: Math.max(attemptCounter, 1),
        model: params.model,
        message: mapped.message,
        stage: 'terminal',
        ...(typeof mapped.upstreamStatus === 'number'
          ? { upstreamStatus: mapped.upstreamStatus }
          : {}),
        ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
      });
    }
    throw new OpenAiEmbeddingError(
      mapped.code,
      mapped.message,
      mapped.retryable,
      mapped.upstreamStatus,
      retryAfterMs,
    );
  }
}
