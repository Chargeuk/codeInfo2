import {
  OPENAI_MAX_INPUTS_PER_REQUEST,
  OPENAI_MAX_TOTAL_TOKENS_PER_REQUEST,
  resolveOpenAiModelTokenLimit,
} from './openaiConstants.js';
import { OpenAiEmbeddingError } from './openaiErrors.js';
import { countOpenAiTokens } from './openaiTokenizer.js';

export type TokenEstimator = (input: string) => number;
export type OpenAiBlankInputGuardContext = {
  blankInputCount: number;
  batchSize: number;
};

export function validateOpenAiEmbeddingGuardrails(params: {
  model: string;
  inputs: string[];
  estimateTokens?: TokenEstimator;
  onBlankInput?: (context: OpenAiBlankInputGuardContext) => void;
}): { tokenEstimate: number; perInputEstimates: number[] } {
  const estimateTokens =
    params.estimateTokens ??
    ((input: string) =>
      countOpenAiTokens({
        model: params.model,
        input,
        surface: 'guardrail',
      }));
  const modelLimit = resolveOpenAiModelTokenLimit(params.model);

  if (params.inputs.length === 0) {
    throw new OpenAiEmbeddingError(
      'OPENAI_BAD_REQUEST',
      'OpenAI embeddings request requires at least one input',
      false,
      400,
    );
  }

  if (params.inputs.length > OPENAI_MAX_INPUTS_PER_REQUEST) {
    throw new OpenAiEmbeddingError(
      'OPENAI_INPUT_TOO_LARGE',
      `OpenAI embeddings request exceeds max input count (${OPENAI_MAX_INPUTS_PER_REQUEST})`,
      false,
      400,
    );
  }

  const blankInputCount = params.inputs.reduce(
    (count, input) => (input.trim().length === 0 ? count + 1 : count),
    0,
  );
  if (blankInputCount > 0) {
    params.onBlankInput?.({
      blankInputCount,
      batchSize: params.inputs.length,
    });
    throw new OpenAiEmbeddingError(
      'OPENAI_BAD_REQUEST',
      'OpenAI embeddings input cannot be blank',
      false,
      400,
    );
  }

  const perInputEstimates = params.inputs.map((input) => estimateTokens(input));
  const oversizedInput = perInputEstimates.find(
    (tokens) => tokens > modelLimit,
  );
  if (typeof oversizedInput === 'number') {
    throw new OpenAiEmbeddingError(
      'OPENAI_INPUT_TOO_LARGE',
      `OpenAI embeddings input exceeds per-input token limit (${modelLimit})`,
      false,
      400,
    );
  }

  const totalTokens = perInputEstimates.reduce((sum, value) => sum + value, 0);
  if (totalTokens > OPENAI_MAX_TOTAL_TOKENS_PER_REQUEST) {
    throw new OpenAiEmbeddingError(
      'OPENAI_INPUT_TOO_LARGE',
      `OpenAI embeddings request exceeds max total token limit (${OPENAI_MAX_TOTAL_TOKENS_PER_REQUEST})`,
      false,
      400,
    );
  }

  return { tokenEstimate: totalTokens, perInputEstimates };
}
