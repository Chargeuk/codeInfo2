import {
  isOpenAiAllowlistedEmbeddingModel,
  resolveEmbeddingModelSelection,
  type ResolvedEmbeddingModelSelection,
} from './providers/index.js';

export type CanonicalEmbeddingRequestFields = {
  embeddingProvider?: unknown;
  embeddingModel?: unknown;
  model?: unknown;
};

export type ResolvedRequestEmbeddingSelection = {
  selection: ResolvedEmbeddingModelSelection;
  requestedModelId: string;
  canonicalProvided: boolean;
};

export type RequestContractValidationError = {
  status: number;
  code: string;
  message: string;
};

function normalizeProvider(
  provider: unknown,
): 'lmstudio' | 'openai' | undefined | null {
  if (provider === undefined) return undefined;
  if (typeof provider !== 'string') return null;
  const trimmed = provider.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === 'lmstudio' || trimmed === 'openai') return trimmed;
  return null;
}

export function resolveRequestEmbeddingSelection(
  body: CanonicalEmbeddingRequestFields,
): ResolvedRequestEmbeddingSelection | RequestContractValidationError {
  const provider = normalizeProvider(body.embeddingProvider);
  const embeddingModel =
    typeof body.embeddingModel === 'string' ? body.embeddingModel.trim() : '';
  const legacyModel = typeof body.model === 'string' ? body.model.trim() : '';
  const hasCanonicalInput =
    body.embeddingProvider !== undefined || body.embeddingModel !== undefined;

  if (hasCanonicalInput) {
    if (!provider || !embeddingModel) {
      return {
        status: 400,
        code: 'VALIDATION',
        message:
          'embeddingProvider and embeddingModel are required when canonical fields are present',
      };
    }
    if (
      provider === 'openai' &&
      !isOpenAiAllowlistedEmbeddingModel(embeddingModel)
    ) {
      return {
        status: 409,
        code: 'OPENAI_MODEL_UNAVAILABLE',
        message:
          'Requested OpenAI embedding model is unavailable for this deployment',
      };
    }
    return {
      selection: {
        providerId: provider,
        modelKey: embeddingModel,
      },
      requestedModelId:
        provider === 'openai' ? `openai/${embeddingModel}` : embeddingModel,
      canonicalProvided: true,
    };
  }

  if (!legacyModel) {
    return {
      status: 400,
      code: 'VALIDATION',
      message: 'model is required',
    };
  }

  const selection = resolveEmbeddingModelSelection(legacyModel);
  if (
    selection.providerId === 'openai' &&
    !isOpenAiAllowlistedEmbeddingModel(selection.modelKey)
  ) {
    return {
      status: 409,
      code: 'OPENAI_MODEL_UNAVAILABLE',
      message:
        'Requested OpenAI embedding model is unavailable for this deployment',
    };
  }
  return {
    selection,
    requestedModelId:
      selection.providerId === 'openai'
        ? `openai/${selection.modelKey}`
        : selection.modelKey,
    canonicalProvided: false,
  };
}
