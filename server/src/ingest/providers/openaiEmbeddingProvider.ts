import type { EmbeddingFunction } from 'chromadb';
import { OpenAI } from 'openai';
import { append } from '../../logStore.js';
import type {
  DiscoveredEmbeddingModel,
  EmbeddingProvider,
  ProviderEmbeddingModel,
} from './types.js';
import {
  OPENAI_PROVIDER_ID,
  OPENAI_REQUEST_TIMEOUT_MS,
  resolveOpenAiModelTokenLimit,
} from './openaiConstants.js';
import { mapOpenAiError, OpenAiEmbeddingError } from './openaiErrors.js';
import {
  estimateOpenAiTokens,
  validateOpenAiEmbeddingGuardrails,
} from './openaiGuardrails.js';
import { runOpenAiWithRetry } from './openaiRetry.js';

type OpenAiClientLike = {
  embeddings: {
    create: (
      body: { model: string; input: string[] },
      options?: { timeout?: number; maxRetries?: number },
    ) => Promise<{
      data: Array<{ index: number; embedding: unknown }>;
    }>;
  };
  models: {
    list: () => Promise<{ data: Array<{ id: string }> }>;
  };
};

function validateEmbeddingResponse(
  vectors: unknown,
  expectedLength: number,
): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expectedLength) {
    throw new OpenAiEmbeddingError(
      'OPENAI_UNAVAILABLE',
      'OpenAI embeddings response shape is invalid',
      true,
      502,
    );
  }

  const normalized = vectors.map((vector) => {
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new OpenAiEmbeddingError(
        'OPENAI_UNAVAILABLE',
        'OpenAI embeddings response contained an empty vector',
        true,
        502,
      );
    }

    const isNumeric = vector.every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    );
    if (!isNumeric) {
      throw new OpenAiEmbeddingError(
        'OPENAI_UNAVAILABLE',
        'OpenAI embeddings response contained non-numeric values',
        true,
        502,
      );
    }

    return vector as number[];
  });

  return normalized;
}

class OpenAiEmbeddingModel implements ProviderEmbeddingModel {
  constructor(
    private readonly embedMany: (inputs: string[]) => Promise<number[][]>,
    private readonly model: string,
  ) {}

  async embedText(text: string): Promise<number[]> {
    const vectors = await this.embedMany([text]);
    return vectors[0] ?? [];
  }

  async countTokens(text: string): Promise<number> {
    return estimateOpenAiTokens(text);
  }

  async getContextLength(): Promise<number> {
    return resolveOpenAiModelTokenLimit(this.model);
  }
}

class OpenAiEmbeddingFunction implements EmbeddingFunction {
  constructor(
    private readonly embedMany: (inputs: string[]) => Promise<number[][]>,
  ) {}

  async generate(texts: string[]): Promise<number[][]> {
    return this.embedMany(texts);
  }
}

export function createOpenAiEmbeddingProvider(params: {
  apiKey: string | undefined;
  clientFactory?: (apiKey: string) => OpenAiClientLike;
  retrySleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  ingestFailureContext?: () => {
    runId?: string;
    path?: string;
    root?: string;
    currentFile?: string;
  };
}): EmbeddingProvider {
  const apiKey = params.apiKey?.trim();
  if (!apiKey) {
    throw new OpenAiEmbeddingError(
      'OPENAI_AUTH_FAILED',
      'OpenAI embedding models require OPENAI_EMBEDDING_KEY',
      false,
      401,
    );
  }

  const client =
    params.clientFactory?.(apiKey) ??
    (new OpenAI({
      apiKey,
      timeout: OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    }) as unknown as OpenAiClientLike);

  const embedMany = async (
    model: string,
    inputs: string[],
  ): Promise<number[][]> => {
    const { tokenEstimate } = validateOpenAiEmbeddingGuardrails({
      model,
      inputs,
    });

    return runOpenAiWithRetry({
      model,
      inputCount: inputs.length,
      tokenEstimate,
      sleep: params.retrySleep,
      ingestFailureContext: params.ingestFailureContext,
      runStep: async (attempt) => {
        append({
          level: 'info',
          message: 'DEV-0000036:T6:openai_embedding_attempt',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            attempt,
            model,
            inputCount: inputs.length,
            tokenEstimate,
          },
        });
        const response = await client.embeddings.create(
          {
            model,
            input: inputs,
          },
          {
            maxRetries: 0,
            timeout: OPENAI_REQUEST_TIMEOUT_MS,
          },
        );

        const sorted = [...response.data].sort((a, b) => a.index - b.index);
        const vectors = sorted.map((row) => row.embedding);
        const normalized = validateEmbeddingResponse(vectors, inputs.length);

        append({
          level: 'info',
          message: 'DEV-0000036:T6:openai_embedding_result_mapped',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            status: 'success',
            code: 'OPENAI_OK',
            retryable: false,
            model,
            inputCount: inputs.length,
            tokenEstimate,
          },
        });

        return normalized;
      },
    });
  };

  const getModel = async (
    modelKey: string,
  ): Promise<ProviderEmbeddingModel> => {
    const model = modelKey.trim();
    return new OpenAiEmbeddingModel(
      (inputs) => embedMany(model, inputs),
      model,
    );
  };

  const createEmbeddingFunction = async (
    modelKey: string,
  ): Promise<EmbeddingFunction> => {
    const model = modelKey.trim();
    return new OpenAiEmbeddingFunction((inputs) => embedMany(model, inputs));
  };

  const listModels = async (): Promise<DiscoveredEmbeddingModel[]> => {
    try {
      const listed = await client.models.list();
      const models = Array.isArray(listed.data)
        ? listed.data
            .map((entry) => ({ id: entry.id }))
            .filter((entry) => typeof entry.id === 'string' && entry.id)
        : [];
      return models;
    } catch (error) {
      throw mapOpenAiError(error);
    }
  };

  return {
    providerId: OPENAI_PROVIDER_ID,
    getModel,
    createEmbeddingFunction,
    listModels,
  };
}
