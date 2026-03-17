import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { resolveConfig } from './config.js';
import { isOpenAiAllowlistedEmbeddingModel } from './providers/openaiConstants.js';
import { countOpenAiTokens } from './providers/openaiTokenizer.js';
import type { ProviderEmbeddingModel } from './providers/types.js';
import { IngestConfig, Chunk } from './types.js';

type ChunkTextLogContext = {
  runId: string;
  relPath: string;
};

function resolveModelKey(model: ProviderEmbeddingModel): string {
  return model.modelKey ?? 'unknown';
}

async function getSafeLimit(
  model: ProviderEmbeddingModel,
  cfg: IngestConfig,
): Promise<number> {
  try {
    const ctx = await model.getContextLength();
    return Math.floor(ctx * cfg.tokenSafetyMargin);
  } catch (error) {
    append({
      level: 'warn',
      source: 'server',
      message: 'DEV-0000036:T19:chunker_context_limit_fallback',
      timestamp: new Date().toISOString(),
      context: {
        model: resolveModelKey(model),
        fallbackTokenLimit: cfg.fallbackTokenLimit,
        reason:
          error instanceof Error
            ? error.message.slice(0, 300)
            : String(error ?? 'unknown').slice(0, 300),
      },
    });
    baseLogger.warn(
      {
        model: resolveModelKey(model),
        fallbackTokenLimit: cfg.fallbackTokenLimit,
        err: error,
      },
      'chunker context-length fallback',
    );
    return cfg.fallbackTokenLimit;
  }
}

async function count(
  model: ProviderEmbeddingModel,
  text: string,
): Promise<number> {
  const modelKey = resolveModelKey(model);
  if (isOpenAiAllowlistedEmbeddingModel(modelKey)) {
    return countOpenAiTokens({
      model: modelKey,
      input: text,
      surface: 'chunker',
    });
  }

  try {
    return await model.countTokens(text);
  } catch (error) {
    append({
      level: 'warn',
      source: 'server',
      message: 'DEV-0000036:T19:chunker_token_count_fallback',
      timestamp: new Date().toISOString(),
      context: {
        model: modelKey,
        fallback: 'whitespace_estimate',
        charLength: text.length,
        reason:
          error instanceof Error
            ? error.message.slice(0, 300)
            : String(error ?? 'unknown').slice(0, 300),
      },
    });
    baseLogger.warn(
      { model: modelKey, charLength: text.length, err: error },
      'chunker token-count fallback',
    );
    return text.split(/\s+/).filter(Boolean).length;
  }
}

function splitOnBoundaries(text: string, boundary: RegExp): string[] {
  const lines = text.split(/\r?\n/);
  const parts: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (boundary.test(line) && current.length) {
      parts.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length) parts.push(current.join('\n'));
  return parts;
}

function hasEmbeddableText(text: string): boolean {
  return text.trim().length > 0;
}

async function sliceToFit(
  model: ProviderEmbeddingModel,
  text: string,
  maxTokens: number,
): Promise<string[]> {
  const slices: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let candidate = remaining;
    let tokens = await count(model, candidate);
    while (tokens > maxTokens && candidate.length > 1) {
      const ratio = Math.max(0.3, maxTokens / Math.max(tokens, 1));
      const cut = Math.max(1, Math.floor(candidate.length * ratio));
      candidate = candidate.slice(0, cut);
      tokens = await count(model, candidate);
    }
    slices.push(candidate);
    remaining = remaining.slice(candidate.length);
  }
  return slices.filter(Boolean);
}

export async function chunkText(
  text: string,
  model: ProviderEmbeddingModel,
  cfg?: IngestConfig,
  options?: {
    logContext?: ChunkTextLogContext;
  },
): Promise<Chunk[]> {
  const config = cfg ?? resolveConfig();
  const maxTokens = await getSafeLimit(model, config);
  const boundary =
    /^(class\s+\w+|function\s+\w+|const\s+\w+\s*=\s*\(|export\s+(function|class))/m;
  const pieces = splitOnBoundaries(text, boundary);
  const candidateChunks: Array<Omit<Chunk, 'chunkIndex'>> = [];

  for (const piece of pieces) {
    const initialTokens = await count(model, piece);
    if (initialTokens <= maxTokens) {
      candidateChunks.push({ text: piece, tokenCount: initialTokens });
    } else {
      const slices = await sliceToFit(
        model,
        piece,
        Math.floor(maxTokens * 0.85),
      );
      for (const slice of slices) {
        const tokenCount = await count(model, slice);
        candidateChunks.push({ text: slice, tokenCount });
      }
    }
  }

  const filteredChunks = candidateChunks.filter((chunk) =>
    hasEmbeddableText(chunk.text),
  );
  const removedBlankChunkCount = candidateChunks.length - filteredChunks.length;

  if (removedBlankChunkCount > 0 && options?.logContext) {
    const context = {
      runId: options.logContext.runId,
      relPath: options.logContext.relPath,
      removedBlankChunkCount,
      survivingChunkCount: filteredChunks.length,
    };
    append({
      level: 'info',
      source: 'server',
      message: 'DEV-0000046:T1:blank-chunks-filtered',
      timestamp: new Date().toISOString(),
      context,
    });
    baseLogger.info(context, 'DEV-0000046:T1:blank-chunks-filtered');
  }

  const chunks = filteredChunks.map((chunk, chunkIndex) => ({
    ...chunk,
    chunkIndex,
  }));

  return chunks;
}
