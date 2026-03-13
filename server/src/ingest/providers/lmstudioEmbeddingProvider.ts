import type { EmbeddingFunction } from 'chromadb';
import { runWithRetry } from '../../agents/retry.js';
import { append } from '../../logStore.js';
import { baseLogger } from '../../logger.js';
import {
  appendIngestFailureLog,
  LmStudioEmbeddingError,
  mapLmStudioIngestError,
} from './ingestFailureLogging.js';
import type {
  EmbeddingProvider,
  LmClientResolver,
  LmProviderDeps,
  ProviderEmbeddingModel,
} from './types.js';

type LmStudioModelResponse = {
  embed: (text: string) => Promise<{ embedding: number[] }>;
  countTokens: (text: string) => Promise<number>;
  getContextLength: () => Promise<number>;
};

type LmStudioClientLike = {
  embedding: {
    model: (modelKey: string) => Promise<LmStudioModelResponse>;
    models?: {
      list?: () => Promise<unknown>;
    };
  };
};

const LMSTUDIO_RETRY_MAX_ATTEMPTS = 3;
const LMSTUDIO_RETRY_BASE_DELAY_MS = 350;

type BlankInputClassification = 'empty' | 'whitespace_only';

function toLmStudioEmbeddingError(error: unknown): LmStudioEmbeddingError {
  const mapped = mapLmStudioIngestError(error);
  return new LmStudioEmbeddingError(
    mapped.error,
    mapped.message,
    mapped.retryable,
  );
}

function classifyBlankInput(text: string): BlankInputClassification | null {
  if (text.length === 0) {
    return 'empty';
  }
  if (text.trim().length === 0) {
    return 'whitespace_only';
  }
  return null;
}

function createLmStudioBlankInputError() {
  return new LmStudioEmbeddingError(
    'LMSTUDIO_BAD_REQUEST',
    'LM Studio embeddings input cannot be blank',
    false,
  );
}

function logBlankInputGuardHit(params: {
  model: string;
  rawInputClassification: BlankInputClassification;
}) {
  const payload = {
    provider: 'lmstudio',
    model: params.model,
    rawInputClassification: params.rawInputClassification,
    skippedRetryAndModelCall: true,
  } as const;

  append({
    level: 'warn',
    message: 'DEV-0000046:T4:lmstudio-blank-input-guard-hit',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: payload,
  });
  baseLogger.warn(payload, 'DEV-0000046:T4:lmstudio-blank-input-guard-hit');
}

function logPathSelected(modelKey: string) {
  baseLogger.info(
    { provider: 'lmstudio', path: 'adapter', modelKey },
    'DEV-0000036:T1:embedding_adapter_path_selected',
  );
}

function logParityVerified(params: {
  source: 'ingest' | 'query';
  vectorCount: number;
  dimension: number;
}) {
  baseLogger.info(
    {
      source: params.source,
      vectorCount: params.vectorCount,
      dimension: params.dimension,
      parity: true,
    },
    'DEV-0000036:T1:embedding_adapter_parity_verified',
  );
}

const parityLoggedKeys = new Set<string>();

function logParityVerifiedOnce(
  params: Parameters<typeof logParityVerified>[0],
) {
  const key = `${params.source}:${params.vectorCount}:${params.dimension}`;
  if (parityLoggedKeys.has(key)) return;
  parityLoggedKeys.add(key);
  logParityVerified(params);
}

class LmStudioEmbeddingModel implements ProviderEmbeddingModel {
  constructor(
    private readonly modelProvider: () => Promise<LmStudioModelResponse>,
    public readonly modelKey: string,
    private readonly ingestFailureContext?: () => {
      runId?: string;
      path?: string;
      root?: string;
      currentFile?: string;
    },
  ) {}

  async getContextLength(): Promise<number> {
    try {
      const model = await this.modelProvider();
      return model.getContextLength();
    } catch (error) {
      throw toLmStudioEmbeddingError(error);
    }
  }

  async countTokens(text: string): Promise<number> {
    try {
      const model = await this.modelProvider();
      return model.countTokens(text);
    } catch (error) {
      throw toLmStudioEmbeddingError(error);
    }
  }

  async embedText(text: string): Promise<number[]> {
    const blankInputClassification = classifyBlankInput(text);
    if (blankInputClassification) {
      logBlankInputGuardHit({
        model: this.modelKey,
        rawInputClassification: blankInputClassification,
      });
      throw createLmStudioBlankInputError();
    }

    let attemptCounter = 0;
    let terminalLogged = false;

    try {
      const result = await runWithRetry({
        maxAttempts: LMSTUDIO_RETRY_MAX_ATTEMPTS,
        baseDelayMs: LMSTUDIO_RETRY_BASE_DELAY_MS,
        runStep: async () => {
          attemptCounter += 1;
          const model = await this.modelProvider();
          return model.embed(text);
        },
        isRetryableError: (error) => mapLmStudioIngestError(error).retryable,
        onRetry: ({ attempt, delayMs, error }) => {
          const mapped = mapLmStudioIngestError(error);
          appendIngestFailureLog('warn', {
            ...this.ingestFailureContext?.(),
            provider: 'lmstudio',
            code: mapped.error,
            retryable: mapped.retryable,
            attempt,
            waitMs: delayMs,
            model: this.modelKey,
            message: mapped.message,
            stage: 'retry',
            surface: 'ingest/embed',
            operation: 'embed',
          });
        },
        onExhausted: ({ attempt, error }) => {
          terminalLogged = true;
          const mapped = mapLmStudioIngestError(error);
          appendIngestFailureLog('error', {
            ...this.ingestFailureContext?.(),
            provider: 'lmstudio',
            code: mapped.error,
            retryable: mapped.retryable,
            attempt,
            model: this.modelKey,
            message: mapped.message,
            stage: 'terminal',
            surface: 'ingest/embed',
            operation: 'embed',
          });
        },
      });

      logParityVerifiedOnce({
        source: 'ingest',
        vectorCount: 1,
        dimension: result.embedding.length,
      });
      return result.embedding;
    } catch (error) {
      const mapped = mapLmStudioIngestError(error);
      if (!terminalLogged) {
        appendIngestFailureLog('error', {
          ...this.ingestFailureContext?.(),
          provider: 'lmstudio',
          code: mapped.error,
          retryable: mapped.retryable,
          attempt: Math.max(attemptCounter, 1),
          model: this.modelKey,
          message: mapped.message,
          stage: 'terminal',
          surface: 'ingest/embed',
          operation: 'embed',
        });
      }
      throw toLmStudioEmbeddingError(error);
    }
  }
}

class LmStudioEmbeddingFunction implements EmbeddingFunction {
  constructor(
    private readonly lmClientResolver: LmClientResolver,
    private readonly baseUrl: string,
    private readonly modelKey: string,
  ) {}

  async generate(texts: string[]): Promise<number[][]> {
    try {
      const model = await (
        this.lmClientResolver(this.baseUrl) as LmStudioClientLike
      ).embedding.model(this.modelKey);

      const results: number[][] = [];
      for (const text of texts) {
        const response = await model.embed(text);
        results.push(response.embedding);
      }

      logParityVerifiedOnce({
        source: 'query',
        vectorCount: results.length,
        dimension: results[0]?.length ?? 0,
      });

      return results;
    } catch (error) {
      throw toLmStudioEmbeddingError(error);
    }
  }
}

export function createLmStudioEmbeddingProvider(
  deps: LmProviderDeps,
): EmbeddingProvider {
  const resolveClient = (): LmStudioClientLike =>
    deps.lmClientResolver(deps.baseUrl) as LmStudioClientLike;

  const createResolvedModel = async (
    modelKey: string,
  ): Promise<LmStudioModelResponse> => {
    const client = resolveClient();
    const model = await client.embedding.model(modelKey);
    return model;
  };

  const getModel = async (
    modelKey: string,
  ): Promise<ProviderEmbeddingModel> => {
    logPathSelected(modelKey);
    const model = await createResolvedModel(modelKey);
    return new LmStudioEmbeddingModel(
      async () => model,
      modelKey,
      deps.ingestFailureContext,
    );
  };

  const createEmbeddingFunction = async (modelKey: string) => {
    logPathSelected(modelKey);
    return new LmStudioEmbeddingFunction(
      deps.lmClientResolver,
      deps.baseUrl,
      modelKey,
    );
  };

  const listModels = async () => {
    const client = resolveClient();
    const list = await client.embedding.models?.list?.();
    const fromObject =
      list && typeof list === 'object' && 'data' in list
        ? (list as { data?: unknown }).data
        : list;

    const values = Array.isArray(fromObject) ? fromObject : [];
    return values
      .map((item) => {
        if (typeof item === 'string') return { id: item };
        if (item && typeof item === 'object' && 'id' in item) {
          return {
            id:
              typeof (item as { id?: unknown }).id === 'string'
                ? (item as { id: string }).id
                : '',
          };
        }
        return { id: '' };
      })
      .filter((entry) => entry.id);
  };

  return {
    providerId: 'lmstudio',
    getModel,
    createEmbeddingFunction,
    listModels,
  };
}

export function logEmbeddingParityVerified(
  params: Parameters<typeof logParityVerified>[0],
) {
  logParityVerified(params);
}
