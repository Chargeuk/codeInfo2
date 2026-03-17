import { get_encoding, type Tiktoken } from 'tiktoken';
import { append } from '../../logStore.js';
import { OPENAI_PROVIDER_ID } from './openaiConstants.js';
import { OpenAiEmbeddingError } from './openaiErrors.js';

const OPENAI_TOKENIZER_ENCODING = 'cl100k_base';
const OPENAI_TOKENIZER_MARKER = 'DEV_0000048_T9_OPENAI_TOKENIZER_COUNT';

type OpenAiTokenizer = Pick<Tiktoken, 'encode' | 'free'>;
type OpenAiTokenizerFactory = () => OpenAiTokenizer;
export type OpenAiTokenizerCountSurface = 'guardrail' | 'provider' | 'chunker';

let tokenizerFactory: OpenAiTokenizerFactory = () =>
  get_encoding(OPENAI_TOKENIZER_ENCODING);
let cachedTokenizer: OpenAiTokenizer | null = null;

function toTokenizerFailure(
  reason: string,
  cause: unknown,
): OpenAiEmbeddingError {
  const detail =
    cause instanceof Error
      ? cause.message
      : String(cause ?? 'unknown tokenizer failure');
  return new OpenAiEmbeddingError(
    'OPENAI_TOKENIZER_FAILED',
    `OpenAI tokenizer ${reason}: ${detail}`.slice(0, 300),
    false,
    500,
  );
}

function getTokenizer(): OpenAiTokenizer {
  if (cachedTokenizer) {
    return cachedTokenizer;
  }

  try {
    cachedTokenizer = tokenizerFactory();
    return cachedTokenizer;
  } catch (error) {
    throw toTokenizerFailure('initialization failed', error);
  }
}

export function countOpenAiTokens(params: {
  model: string;
  input: string | string[];
  surface: OpenAiTokenizerCountSurface;
}): number {
  const inputs = Array.isArray(params.input) ? params.input : [params.input];
  const tokenizer = getTokenizer();

  try {
    const countedTokenTotal = inputs.reduce((sum, value) => {
      return sum + tokenizer.encode(value).length;
    }, 0);

    append({
      level: 'info',
      source: 'server',
      message: OPENAI_TOKENIZER_MARKER,
      timestamp: new Date().toISOString(),
      context: {
        provider: OPENAI_PROVIDER_ID,
        model: params.model,
        countedTokenTotal,
        countingPath: params.surface,
      },
    });

    return countedTokenTotal;
  } catch (error) {
    throw toTokenizerFailure('count failed', error);
  }
}

export function disposeOpenAiTokenizer(): void {
  cachedTokenizer?.free();
  cachedTokenizer = null;
}

export function setOpenAiTokenizerFactoryForTests(
  factory?: OpenAiTokenizerFactory,
): void {
  disposeOpenAiTokenizer();
  tokenizerFactory = factory ?? (() => get_encoding(OPENAI_TOKENIZER_ENCODING));
}
