import type { EmbeddingFunction } from 'chromadb';

export type DiscoveredEmbeddingModel = {
  id: string;
};

export type ProviderEmbedRequestOptions = {
  signal?: AbortSignal;
};

export interface ProviderEmbeddingModel {
  modelKey?: string;
  readonly effectiveBatchSize: number;
  readonly supportsAbort: boolean;
  embedText: (
    text: string,
    options?: ProviderEmbedRequestOptions,
  ) => Promise<number[]>;
  embedBatch: (
    texts: string[],
    options?: ProviderEmbedRequestOptions,
  ) => Promise<number[][]>;
  countTokens: (text: string) => Promise<number>;
  getContextLength: () => Promise<number>;
}

export interface EmbeddingProvider {
  readonly providerId: string;
  getModel(modelKey: string): Promise<ProviderEmbeddingModel>;
  createEmbeddingFunction(modelKey: string): Promise<EmbeddingFunction>;
  listModels(): Promise<DiscoveredEmbeddingModel[]>;
}

export interface LmClientResolver {
  (baseUrl: string): unknown;
}

export interface LmProviderDeps {
  lmClientResolver: LmClientResolver;
  baseUrl: string;
  ingestFailureContext?: () => {
    runId?: string;
    path?: string;
    root?: string;
    currentFile?: string;
  };
}
