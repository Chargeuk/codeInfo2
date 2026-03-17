import { APIConnectionError, APIConnectionTimeoutError } from 'openai';
import { OPENAI_PROVIDER_ID } from './openaiConstants.js';

export type OpenAiErrorCode =
  | 'OPENAI_AUTH_FAILED'
  | 'OPENAI_PERMISSION_DENIED'
  | 'OPENAI_MODEL_UNAVAILABLE'
  | 'OPENAI_BAD_REQUEST'
  | 'OPENAI_INPUT_TOO_LARGE'
  | 'OPENAI_TOKENIZER_FAILED'
  | 'OPENAI_UNPROCESSABLE'
  | 'OPENAI_RATE_LIMITED'
  | 'OPENAI_QUOTA_EXCEEDED'
  | 'OPENAI_TIMEOUT'
  | 'OPENAI_CONNECTION_FAILED'
  | 'OPENAI_UNAVAILABLE';

export type OpenAiMappedErrorShape = {
  provider: 'openai';
  code: OpenAiErrorCode;
  message: string;
  retryable: boolean;
  upstreamStatus?: number;
  retryAfterMs?: number;
};

export class OpenAiEmbeddingError extends Error {
  readonly provider = OPENAI_PROVIDER_ID;

  constructor(
    public readonly code: OpenAiErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly upstreamStatus?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'OpenAiEmbeddingError';
  }

  toShape(): OpenAiMappedErrorShape {
    return {
      provider: this.provider,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(typeof this.upstreamStatus === 'number'
        ? { upstreamStatus: this.upstreamStatus }
        : {}),
      ...(typeof this.retryAfterMs === 'number'
        ? { retryAfterMs: this.retryAfterMs }
        : {}),
    };
  }
}

export function isRetryableOpenAiCode(code: OpenAiErrorCode): boolean {
  return (
    code === 'OPENAI_RATE_LIMITED' ||
    code === 'OPENAI_TIMEOUT' ||
    code === 'OPENAI_CONNECTION_FAILED' ||
    code === 'OPENAI_UNAVAILABLE'
  );
}

export function sanitizeOpenAiErrorMessage(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-***')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'bearer ***')
    .replace(/authorization\s*:\s*[^\s]+/gi, 'authorization:***');
}

function normalizeMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message ?? '')
        : typeof err === 'string'
          ? err
          : 'OpenAI request failed';
  return sanitizeOpenAiErrorMessage(raw).slice(0, 300);
}

function isInputTooLarge(apiCode: unknown, message: string): boolean {
  const normalizedCode =
    typeof apiCode === 'string' ? apiCode.toLowerCase() : '';
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedCode.includes('context_length_exceeded') ||
    normalizedCode.includes('max_tokens') ||
    normalizedCode.includes('input_too_large') ||
    normalizedMessage.includes('context length') ||
    normalizedMessage.includes('too many tokens') ||
    normalizedMessage.includes('maximum context length') ||
    normalizedMessage.includes('input is too long')
  );
}

function isQuotaFailure(apiCode: unknown, message: string): boolean {
  const normalizedCode =
    typeof apiCode === 'string' ? apiCode.toLowerCase() : '';
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedCode.includes('insufficient_quota') ||
    normalizedCode.includes('quota') ||
    normalizedMessage.includes('quota') ||
    normalizedMessage.includes('billing') ||
    normalizedMessage.includes('credits')
  );
}

function extractStatus(err: unknown): number | undefined {
  if (err instanceof OpenAiEmbeddingError) return err.upstreamStatus;
  if (
    err &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status?: unknown }).status === 'number'
  ) {
    return (err as { status: number }).status;
  }
  return undefined;
}

function extractApiCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const raw = (err as { code?: unknown }).code;
    if (typeof raw === 'string') return raw;
  }
  if (err && typeof err === 'object' && 'error' in err) {
    const nested = (err as { error?: { code?: unknown } }).error;
    if (nested && typeof nested.code === 'string') return nested.code;
  }
  return undefined;
}

function extractName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

export function mapOpenAiError(err: unknown): OpenAiEmbeddingError {
  if (err instanceof OpenAiEmbeddingError) {
    return err;
  }

  const message = normalizeMessage(err);
  const status = extractStatus(err);
  const apiCode = extractApiCode(err);
  const errorName = extractName(err);

  if (
    err instanceof APIConnectionTimeoutError ||
    status === 408 ||
    errorName === 'APIConnectionTimeoutError'
  ) {
    return new OpenAiEmbeddingError('OPENAI_TIMEOUT', message, true, status);
  }

  if (err instanceof APIConnectionError || errorName === 'APIConnectionError') {
    return new OpenAiEmbeddingError(
      'OPENAI_CONNECTION_FAILED',
      message,
      true,
      status,
    );
  }

  if (status === 401) {
    return new OpenAiEmbeddingError(
      'OPENAI_AUTH_FAILED',
      message,
      false,
      status,
    );
  }

  if (status === 403) {
    return new OpenAiEmbeddingError(
      'OPENAI_PERMISSION_DENIED',
      message,
      false,
      status,
    );
  }

  if (status === 404) {
    return new OpenAiEmbeddingError(
      'OPENAI_MODEL_UNAVAILABLE',
      message,
      false,
      status,
    );
  }

  if (status === 422) {
    return new OpenAiEmbeddingError(
      'OPENAI_UNPROCESSABLE',
      message,
      false,
      status,
    );
  }

  if (status === 429) {
    if (isQuotaFailure(apiCode, message)) {
      return new OpenAiEmbeddingError(
        'OPENAI_QUOTA_EXCEEDED',
        message,
        false,
        status,
      );
    }
    return new OpenAiEmbeddingError(
      'OPENAI_RATE_LIMITED',
      message,
      true,
      status,
    );
  }

  if (status === 400) {
    if (isInputTooLarge(apiCode, message)) {
      return new OpenAiEmbeddingError(
        'OPENAI_INPUT_TOO_LARGE',
        message,
        false,
        status,
      );
    }
    return new OpenAiEmbeddingError(
      'OPENAI_BAD_REQUEST',
      message,
      false,
      status,
    );
  }

  if (typeof status === 'number' && status >= 500) {
    return new OpenAiEmbeddingError(
      'OPENAI_UNAVAILABLE',
      message,
      true,
      status,
    );
  }

  return new OpenAiEmbeddingError('OPENAI_UNAVAILABLE', message, true, status);
}
