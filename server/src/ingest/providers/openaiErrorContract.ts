import { append } from '../../logStore.js';
import { OpenAiEmbeddingError } from './openaiErrors.js';

export type NormalizedOpenAiErrorPayload = {
  error: string;
  message: string;
  retryable: boolean;
  provider: 'openai';
  upstreamStatus?: number;
  retryAfterMs?: number;
};

function sanitizeOpenAiContractMessage(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-***')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'bearer ***')
    .replace(/authorization\s*:\s*[^\s]+/gi, 'authorization:***')
    .slice(0, 300);
}

export function toNormalizedOpenAiErrorPayload(
  err: OpenAiEmbeddingError,
): NormalizedOpenAiErrorPayload {
  return {
    error: err.code,
    message: sanitizeOpenAiContractMessage(err.message),
    retryable: err.retryable,
    provider: err.provider,
    ...(typeof err.upstreamStatus === 'number'
      ? { upstreamStatus: err.upstreamStatus }
      : {}),
    ...(typeof err.retryAfterMs === 'number'
      ? { retryAfterMs: err.retryAfterMs }
      : {}),
  };
}

export function resolveOpenAiRestStatus(err: OpenAiEmbeddingError): number {
  if (typeof err.upstreamStatus === 'number') return err.upstreamStatus;
  return err.retryable ? 503 : 400;
}

export function logOpenAiContractMapping(params: {
  requestId?: string;
  surface: 'rest' | 'mcp' | 'ingest';
  payload: NormalizedOpenAiErrorPayload;
  statusCode: number;
}) {
  append({
    level: 'info',
    message: 'DEV-0000036:T9:openai_error_contract_mapped',
    timestamp: new Date().toISOString(),
    source: 'server',
    requestId: params.requestId,
    context: {
      surface: params.surface,
      statusCode: params.statusCode,
      error: params.payload.error,
      retryable: params.payload.retryable,
      provider: params.payload.provider,
    },
  });
}
