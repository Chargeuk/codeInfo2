import { delayWithAbort, runWithRetry } from '../../agents/retry.js';
import { getOpenAiIngestMaxRetries } from '../../config/openaiIngestRetries.js';
import { appendIngestFailureLog } from './ingestFailureLogging.js';
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

export type RetryHeaders = Headers | Record<string, unknown> | undefined;
const OPENAI_RATE_LIMIT_SAFETY_PAD_MS = 250;

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

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseRateLimitResetMs(
  value: string | undefined,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parts = [...trimmed.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/gi)];
  if (parts.length > 0) {
    let consumed = '';
    let totalMs = 0;
    for (const part of parts) {
      const amount = Number(part[1]);
      const unit = part[2]?.toLowerCase();
      if (!Number.isFinite(amount) || !unit) {
        return undefined;
      }
      consumed += part[0];
      switch (unit) {
        case 'ms':
          totalMs += amount;
          break;
        case 's':
          totalMs += amount * 1000;
          break;
        case 'm':
          totalMs += amount * 60_000;
          break;
        case 'h':
          totalMs += amount * 3_600_000;
          break;
        default:
          return undefined;
      }
    }

    if (consumed.length === trimmed.length && totalMs >= 0) {
      return Math.floor(totalMs);
    }
  }

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return Math.floor(asNumber * 1000);
  }

  const asDate = Date.parse(trimmed);
  if (!Number.isFinite(asDate)) return undefined;
  const waitMs = asDate - Date.now();
  if (waitMs <= 0) return undefined;
  return Math.floor(waitMs);
}

export function resolveOpenAiRateLimitWaitMs(params: {
  headers: RetryHeaders;
  tokenEstimate: number;
  fallbackWaitMs: number;
}) {
  const retryAfterMs = resolveRetryAfterMs(params.headers);
  const providerWaitMs =
    typeof retryAfterMs === 'number' ? retryAfterMs : params.fallbackWaitMs;
  const remainingTokens = parsePositiveNumber(
    getHeaderValue(params.headers, 'x-ratelimit-remaining-tokens'),
  );
  const resetTokensMs = parseRateLimitResetMs(
    getHeaderValue(params.headers, 'x-ratelimit-reset-tokens'),
  );
  const remainingRequests = parsePositiveNumber(
    getHeaderValue(params.headers, 'x-ratelimit-remaining-requests'),
  );
  const resetRequestsMs = parseRateLimitResetMs(
    getHeaderValue(params.headers, 'x-ratelimit-reset-requests'),
  );

  const tokenBudgetWaitMs =
    isFiniteNumber(remainingTokens) &&
    isFiniteNumber(resetTokensMs) &&
    remainingTokens < params.tokenEstimate
      ? Math.floor(resetTokensMs + OPENAI_RATE_LIMIT_SAFETY_PAD_MS)
      : 0;

  const requestBudgetWaitMs =
    isFiniteNumber(remainingRequests) &&
    isFiniteNumber(resetRequestsMs) &&
    remainingRequests < 1
      ? Math.floor(resetRequestsMs + OPENAI_RATE_LIMIT_SAFETY_PAD_MS)
      : 0;

  return {
    retryAfterMs,
    providerWaitMs,
    remainingTokens,
    resetTokensMs,
    remainingRequests,
    resetRequestsMs,
    tokenBudgetWaitMs,
    requestBudgetWaitMs,
    chosenWaitMs: Math.max(
      providerWaitMs,
      tokenBudgetWaitMs,
      requestBudgetWaitMs,
    ),
  };
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
  let pendingRetryLogContext:
    | {
        runId?: string;
        path?: string;
        root?: string;
        currentFile?: string;
        provider: 'openai';
        code: string;
        retryable: boolean;
        attempt: number;
        waitMs: number;
        model: string;
        message: string;
        stage: 'retry';
        upstreamStatus?: number;
        retryAfterMs?: number;
        providerWaitMs: number;
        tokenBudgetWaitMs: number;
        requestBudgetWaitMs: number;
        remainingTokens?: number;
        resetTokensMs?: number;
        remainingRequests?: number;
        resetRequestsMs?: number;
        waitState: 'scheduled' | 'finished';
      }
    | undefined;

  try {
    const maxRetries = getOpenAiIngestMaxRetries();
    return await runWithRetry({
      maxAttempts: maxRetries + 1,
      baseDelayMs: OPENAI_RETRY_BASE_DELAY_MS,
      signal: params.signal,
      sleep: async (_delayMs: number, signal?: AbortSignal) => {
        const waitMs = nextDelayMs;
        await (params.sleep ?? delayWithAbort)(waitMs, signal);
        if (pendingRetryLogContext) {
          appendIngestFailureLog('info', {
            ...pendingRetryLogContext,
            waitState: 'finished',
            waitMs,
          });
          pendingRetryLogContext = undefined;
        }
      },
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
        const headers =
          error && typeof error === 'object'
            ? ((error as { headers?: RetryHeaders }).headers ?? undefined)
            : undefined;
        const waitDecision = resolveOpenAiRateLimitWaitMs({
          headers,
          tokenEstimate: params.tokenEstimate,
          fallbackWaitMs: computeExponentialDelayMs(attempt),
        });
        nextDelayMs = waitDecision.chosenWaitMs;

        pendingRetryLogContext = {
          ...params.ingestFailureContext?.(),
          provider: 'openai',
          code: mapped.code,
          retryable: mapped.retryable,
          attempt,
          waitMs: nextDelayMs,
          model: params.model,
          message: mapped.message,
          stage: 'retry',
          waitState: 'scheduled',
          providerWaitMs: waitDecision.providerWaitMs,
          tokenBudgetWaitMs: waitDecision.tokenBudgetWaitMs,
          requestBudgetWaitMs: waitDecision.requestBudgetWaitMs,
          ...(typeof waitDecision.remainingTokens === 'number'
            ? { remainingTokens: waitDecision.remainingTokens }
            : {}),
          ...(typeof waitDecision.resetTokensMs === 'number'
            ? { resetTokensMs: waitDecision.resetTokensMs }
            : {}),
          ...(typeof waitDecision.remainingRequests === 'number'
            ? { remainingRequests: waitDecision.remainingRequests }
            : {}),
          ...(typeof waitDecision.resetRequestsMs === 'number'
            ? { resetRequestsMs: waitDecision.resetRequestsMs }
            : {}),
          ...(typeof mapped.upstreamStatus === 'number'
            ? { upstreamStatus: mapped.upstreamStatus }
            : {}),
          ...(typeof waitDecision.retryAfterMs === 'number'
            ? { retryAfterMs: waitDecision.retryAfterMs }
            : {}),
        };

        appendIngestFailureLog('warn', pendingRetryLogContext);
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
