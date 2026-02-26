import type { EmbeddingFunction } from 'chromadb';

export type DiscoveredEmbeddingModel = {
  id: string;
};

export interface ProviderEmbeddingModel {
  modelKey?: string;
  embedText: (text: string) => Promise<number[]>;
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
