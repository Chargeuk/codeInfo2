import {
  LmStudioEmbeddingError,
  mapLmStudioIngestError,
} from './ingestFailureLogging.js';
import { OpenAiEmbeddingError, mapOpenAiError } from './openaiErrors.js';

export type IngestFailureSeverity = 'warn' | 'error';

export type IngestFailureClassification = {
  code: string;
  message: string;
  retryable: boolean;
  severity: IngestFailureSeverity;
  provider: 'openai' | 'lmstudio' | 'ingest';
  surface: string;
  upstreamStatus?: number;
  retryAfterMs?: number;
};

const RETRYABLE_OPENAI_CODES = new Set([
  'OPENAI_RATE_LIMITED',
  'OPENAI_TIMEOUT',
  'OPENAI_CONNECTION_FAILED',
  'OPENAI_UNAVAILABLE',
]);

const NON_RETRYABLE_CODES = new Set([
  'MODEL_LOCKED',
  'OPENAI_MODEL_UNAVAILABLE',
  'INVALID_REEMBED_STATE',
  'INVALID_LOCK_METADATA',
  'NOT_FOUND',
  'VALIDATION',
  'OPENAI_ALLOWLIST_NO_MATCH',
  'OPENAI_DISABLED',
  'OPENAI_AUTH_FAILED',
  'OPENAI_PERMISSION_DENIED',
  'OPENAI_QUOTA_EXCEEDED',
  'OPENAI_BAD_REQUEST',
  'OPENAI_INPUT_TOO_LARGE',
  'OPENAI_UNPROCESSABLE',
  'LMSTUDIO_MODEL_UNAVAILABLE',
  'LMSTUDIO_BAD_REQUEST',
]);

const RETRYABLE_CODES = new Set(['BUSY', 'LMSTUDIO_UNAVAILABLE']);

function sanitizeMessage(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-***')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'bearer ***')
    .replace(/authorization\s*:\s*[^\s]+/gi, 'authorization:***')
    .slice(0, 300);
}

function classifyByCode(
  code: string,
  message: string,
  surface: string,
): IngestFailureClassification {
  const upper = code.toUpperCase();
  const provider = upper.startsWith('OPENAI_')
    ? 'openai'
    : upper.startsWith('LMSTUDIO_')
      ? 'lmstudio'
      : 'ingest';
  const retryable = RETRYABLE_OPENAI_CODES.has(upper)
    ? true
    : RETRYABLE_CODES.has(upper)
      ? true
      : NON_RETRYABLE_CODES.has(upper)
        ? false
        : false;

  return {
    code: upper,
    message: sanitizeMessage(message),
    retryable,
    severity: retryable ? 'warn' : 'error',
    provider,
    surface,
  };
}

export function classifyIngestFailure(
  error: unknown,
  params: {
    surface: string;
    defaultCode: string;
    providerHint?: 'openai' | 'lmstudio' | 'ingest';
  },
): IngestFailureClassification {
  if (error instanceof OpenAiEmbeddingError) {
    return {
      code: error.code,
      message: sanitizeMessage(error.message),
      retryable: error.retryable,
      severity: error.retryable ? 'warn' : 'error',
      provider: 'openai',
      surface: params.surface,
      ...(typeof error.upstreamStatus === 'number'
        ? { upstreamStatus: error.upstreamStatus }
        : {}),
      ...(typeof error.retryAfterMs === 'number'
        ? { retryAfterMs: error.retryAfterMs }
        : {}),
    };
  }

  if (error instanceof LmStudioEmbeddingError) {
    return {
      code: error.code,
      message: sanitizeMessage(error.message),
      retryable: error.retryable,
      severity: error.retryable ? 'warn' : 'error',
      provider: 'lmstudio',
      surface: params.surface,
    };
  }

  const normalized =
    error && typeof error === 'object'
      ? (error as {
          error?: unknown;
          message?: unknown;
          retryable?: unknown;
          provider?: unknown;
          upstreamStatus?: unknown;
          retryAfterMs?: unknown;
        })
      : null;

  if (
    normalized &&
    typeof normalized.error === 'string' &&
    typeof normalized.message === 'string' &&
    typeof normalized.retryable === 'boolean' &&
    (normalized.provider === 'openai' || normalized.provider === 'lmstudio')
  ) {
    return {
      code: normalized.error,
      message: sanitizeMessage(normalized.message),
      retryable: normalized.retryable,
      severity: normalized.retryable ? 'warn' : 'error',
      provider: normalized.provider,
      surface: params.surface,
      ...(typeof normalized.upstreamStatus === 'number'
        ? { upstreamStatus: normalized.upstreamStatus }
        : {}),
      ...(typeof normalized.retryAfterMs === 'number'
        ? { retryAfterMs: normalized.retryAfterMs }
        : {}),
    };
  }

  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? params.defaultCode)
      : params.defaultCode;
  const rawMessage =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? code)
        : code;

  if (
    code.toUpperCase().startsWith('OPENAI_') ||
    params.providerHint === 'openai'
  ) {
    const mapped = mapOpenAiError(error);
    return {
      code: mapped.code,
      message: sanitizeMessage(mapped.message),
      retryable: mapped.retryable,
      severity: mapped.retryable ? 'warn' : 'error',
      provider: 'openai',
      surface: params.surface,
      ...(typeof mapped.upstreamStatus === 'number'
        ? { upstreamStatus: mapped.upstreamStatus }
        : {}),
    };
  }

  if (
    code.toUpperCase().startsWith('LMSTUDIO_') ||
    params.providerHint === 'lmstudio'
  ) {
    const mapped = mapLmStudioIngestError(error);
    return {
      code: mapped.error,
      message: mapped.message,
      retryable: mapped.retryable,
      severity: mapped.retryable ? 'warn' : 'error',
      provider: 'lmstudio',
      surface: params.surface,
    };
  }

  return classifyByCode(code, rawMessage, params.surface);
}
