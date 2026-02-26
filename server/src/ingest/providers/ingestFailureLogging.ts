import { append } from '../../logStore.js';
import { baseLogger } from '../../logger.js';

export type IngestFailureSeverity = 'warn' | 'error';
export type IngestFailureStage = 'retry' | 'terminal';

export type IngestFailureLogContext = {
  runId?: string;
  provider: 'openai' | 'lmstudio' | 'ingest';
  code: string;
  retryable: boolean;
  attempt?: number;
  waitMs?: number;
  model?: string;
  path?: string;
  root?: string;
  currentFile?: string;
  message: string;
  stage: IngestFailureStage;
  surface?: string;
  operation?: string;
  upstreamStatus?: number;
  retryAfterMs?: number;
};

export type IngestLmStudioNormalizedError = {
  error:
    | 'LMSTUDIO_UNAVAILABLE'
    | 'LMSTUDIO_MODEL_UNAVAILABLE'
    | 'LMSTUDIO_BAD_REQUEST';
  message: string;
  retryable: boolean;
  provider: 'lmstudio';
};

export class LmStudioEmbeddingError extends Error {
  readonly provider = 'lmstudio' as const;

  constructor(
    public readonly code:
      | 'LMSTUDIO_UNAVAILABLE'
      | 'LMSTUDIO_MODEL_UNAVAILABLE'
      | 'LMSTUDIO_BAD_REQUEST',
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LmStudioEmbeddingError';
  }
}

function sanitizeMessage(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-***')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'bearer ***')
    .replace(/authorization\s*:\s*[^\s]+/gi, 'authorization:***')
    .slice(0, 300);
}

export function mapLmStudioIngestError(
  error: unknown,
): IngestLmStudioNormalizedError {
  const message = sanitizeMessage(
    error instanceof Error
      ? error.message
      : String(error ?? 'LM Studio request failed'),
  );
  const lower = message.toLowerCase();
  const code = (error as { code?: unknown })?.code;

  if (code === 'LMSTUDIO_MODEL_UNAVAILABLE') {
    return {
      error: 'LMSTUDIO_MODEL_UNAVAILABLE',
      message,
      retryable: false,
      provider: 'lmstudio',
    };
  }

  if (code === 'LMSTUDIO_BAD_REQUEST') {
    return {
      error: 'LMSTUDIO_BAD_REQUEST',
      message,
      retryable: false,
      provider: 'lmstudio',
    };
  }

  if (code === 'LMSTUDIO_UNAVAILABLE') {
    return {
      error: 'LMSTUDIO_UNAVAILABLE',
      message,
      retryable: true,
      provider: 'lmstudio',
    };
  }

  if (
    code === 'EMBED_MODEL_MISSING' ||
    (lower.includes('model') && lower.includes('not found'))
  ) {
    return {
      error: 'LMSTUDIO_MODEL_UNAVAILABLE',
      message,
      retryable: false,
      provider: 'lmstudio',
    };
  }

  if (
    lower.includes('invalid') ||
    lower.includes('context length') ||
    lower.includes('too many tokens')
  ) {
    return {
      error: 'LMSTUDIO_BAD_REQUEST',
      message,
      retryable: false,
      provider: 'lmstudio',
    };
  }

  return {
    error: 'LMSTUDIO_UNAVAILABLE',
    message,
    retryable: true,
    provider: 'lmstudio',
  };
}

export function appendIngestFailureLog(
  severity: IngestFailureSeverity,
  context: IngestFailureLogContext,
) {
  const payload = {
    runId: context.runId,
    provider: context.provider,
    code: context.code,
    retryable: context.retryable,
    attempt: context.attempt,
    waitMs: context.waitMs,
    model: context.model,
    path: context.path,
    root: context.root,
    currentFile: context.currentFile,
    message: sanitizeMessage(context.message),
    stage: context.stage,
    surface: context.surface,
    operation: context.operation,
    upstreamStatus: context.upstreamStatus,
    retryAfterMs: context.retryAfterMs,
  };

  append({
    level: severity,
    source: 'server',
    message: 'DEV-0000036:T17:ingest_provider_failure',
    timestamp: new Date().toISOString(),
    context: Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    ),
  });

  const logger = severity === 'error' ? baseLogger.error : baseLogger.warn;
  logger.call(baseLogger, payload, 'DEV-0000036:T17:ingest_provider_failure');
}
