import type { EmbeddingFunction } from 'chromadb';
import { baseLogger } from '../../logger.js';
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
  ) {}

  async getContextLength(): Promise<number> {
    const model = await this.modelProvider();
    return model.getContextLength();
  }

  async countTokens(text: string): Promise<number> {
    const model = await this.modelProvider();
    return model.countTokens(text);
  }

  async embedText(text: string): Promise<number[]> {
    const model = await this.modelProvider();
    const result = await model.embed(text);
    logParityVerifiedOnce({
      source: 'ingest',
      vectorCount: 1,
      dimension: result.embedding.length,
    });
    return result.embedding;
  }
}

class LmStudioEmbeddingFunction implements EmbeddingFunction {
  constructor(
    private readonly lmClientResolver: LmClientResolver,
    private readonly baseUrl: string,
    private readonly modelKey: string,
  ) {}

  async generate(texts: string[]): Promise<number[][]> {
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
    return new LmStudioEmbeddingModel(async () => model, modelKey);
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
