import {
  OPENAI_PROVIDER_ID,
  isOpenAiAllowlistedEmbeddingModel,
} from './openaiConstants.js';

const OPENAI_PREFIX = 'openai/';
const LMSTUDIO_PREFIX = 'lmstudio/';

export type ResolvedEmbeddingModelSelection = {
  providerId: 'openai' | 'lmstudio';
  modelKey: string;
};

export function resolveEmbeddingModelSelection(
  modelId: string,
): ResolvedEmbeddingModelSelection {
  const trimmed = modelId.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith(OPENAI_PREFIX)) {
    return {
      providerId: OPENAI_PROVIDER_ID,
      modelKey: trimmed.slice(OPENAI_PREFIX.length),
    };
  }

  if (lower.startsWith(LMSTUDIO_PREFIX)) {
    return {
      providerId: 'lmstudio',
      modelKey: trimmed.slice(LMSTUDIO_PREFIX.length),
    };
  }

  if (isOpenAiAllowlistedEmbeddingModel(trimmed)) {
    return {
      providerId: OPENAI_PROVIDER_ID,
      modelKey: trimmed,
    };
  }

  return {
    providerId: 'lmstudio',
    modelKey: trimmed,
  };
}
