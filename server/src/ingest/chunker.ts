import path from 'node:path';
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

type ChunkTextFileInfo = {
  relPath: string;
  ext?: string;
  sizeBytes?: number;
};

const LARGE_TEXT_EXTENSIONS = new Set(['md', 'mdx', 'txt']);

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

function resolveFileExtension(fileInfo: ChunkTextFileInfo | undefined): string {
  if (fileInfo?.ext) return fileInfo.ext.toLowerCase();
  if (fileInfo?.relPath) {
    return path.extname(fileInfo.relPath).replace('.', '').toLowerCase();
  }
  return '';
}

function shouldUseProseChunking(
  cfg: IngestConfig,
  fileInfo: ChunkTextFileInfo | undefined,
): fileInfo is ChunkTextFileInfo & { relPath: string; sizeBytes: number } {
  const ext = resolveFileExtension(fileInfo);
  return (
    LARGE_TEXT_EXTENSIONS.has(ext) &&
    typeof fileInfo?.sizeBytes === 'number' &&
    fileInfo.sizeBytes >= cfg.largeTextThresholdBytes
  );
}

function splitOnSentenceBoundaries(text: string): string[] {
  const matches = text.match(/[^.!?\n]+[.!?]+(?:\s+|$)|[^\n]+/g);
  return matches?.map((part) => part.trim()).filter(Boolean) ?? [];
}

function splitIntoProseBlocks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  const flushCurrent = () => {
    const block = current.join('\n').trim();
    if (block.length > 0) blocks.push(block);
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const isFenceBoundary = /^(?:```|~~~)/.test(trimmed);
    const isHeading = /^#{1,6}\s+/.test(trimmed);
    const isListBoundary = /^(?:[-*+]\s+|\d+\.\s+)/.test(trimmed);

    if (isFenceBoundary) {
      if (!inFence && current.length > 0) flushCurrent();
      current.push(line);
      inFence = !inFence;
      if (!inFence) flushCurrent();
      continue;
    }

    if (inFence) {
      current.push(line);
      continue;
    }

    if (trimmed.length === 0) {
      if (current.length > 0) flushCurrent();
      continue;
    }

    if (isHeading) {
      if (current.length > 0) flushCurrent();
      current.push(line);
      continue;
    }

    if (
      isListBoundary &&
      current.length > 0 &&
      !/^(?:[-*+]\s+|\d+\.\s+)/.test(current[current.length - 1].trim())
    ) {
      flushCurrent();
    }

    current.push(line);
  }

  if (current.length > 0) flushCurrent();
  return blocks;
}

function findLocalBoundaryCut(text: string, preferredLength: number): string {
  if (text.length <= preferredLength) return text;

  const searchWindow = Math.min(
    text.length,
    Math.max(preferredLength + 128, Math.floor(preferredLength * 1.15)),
  );
  const prefix = text.slice(0, searchWindow);
  const floor = Math.max(32, Math.floor(preferredLength * 0.5));
  const boundaryPatterns = [
    /\n#{1,6}\s/g,
    /\n(?:```|~~~)/g,
    /\n\s*\n/g,
    /\n(?:[-*+]\s+|\d+\.\s+)/g,
    /(?<=[.!?])\s+/g,
    /\n/g,
    /\s+/g,
  ];

  let bestCut: number | null = null;
  for (const pattern of boundaryPatterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(prefix);
    while (match) {
      const candidate = match.index + match[0].length;
      if (candidate >= floor && candidate <= preferredLength) {
        bestCut = candidate;
      }
      match = pattern.exec(prefix);
    }
    if (bestCut !== null) break;
  }

  const cut = bestCut ?? preferredLength;
  return prefix.slice(0, cut).trimEnd();
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

async function sliceToFitLocally(
  model: ProviderEmbeddingModel,
  text: string,
  maxTokens: number,
): Promise<string[]> {
  const slices: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    let preferredLength = Math.min(
      remaining.length,
      Math.max(128, maxTokens * 8),
    );
    let candidate = findLocalBoundaryCut(remaining, preferredLength);
    if (!hasEmbeddableText(candidate)) {
      candidate = remaining.slice(0, preferredLength).trim();
    }
    let tokens = await count(model, candidate);

    while (tokens > maxTokens && candidate.length > 1) {
      preferredLength = Math.max(1, Math.floor(candidate.length * 0.85));
      candidate = findLocalBoundaryCut(remaining, preferredLength);
      if (!hasEmbeddableText(candidate)) {
        candidate = remaining.slice(0, preferredLength).trim();
      }
      tokens = await count(model, candidate);
    }

    slices.push(candidate);
    remaining = remaining.slice(candidate.length).trimStart();
  }

  return slices.filter(Boolean);
}

async function buildProseChunks(
  text: string,
  model: ProviderEmbeddingModel,
  maxTokens: number,
): Promise<Array<Omit<Chunk, 'chunkIndex'>>> {
  const blocks = splitIntoProseBlocks(text);
  const chunks: Array<Omit<Chunk, 'chunkIndex'>> = [];
  let currentText = '';
  let currentTokenCount = 0;

  const flushCurrent = () => {
    if (!hasEmbeddableText(currentText)) return;
    chunks.push({
      text: currentText.trim(),
      tokenCount: currentTokenCount,
    });
    currentText = '';
    currentTokenCount = 0;
  };

  for (const block of blocks) {
    const blockTokens = await count(model, block);

    if (blockTokens > maxTokens) {
      flushCurrent();
      const smallerBlocks = splitOnSentenceBoundaries(block);
      const units = smallerBlocks.length > 1 ? smallerBlocks : [block];
      for (const unit of units) {
        const unitTokens = await count(model, unit);
        if (unitTokens <= maxTokens) {
          chunks.push({ text: unit, tokenCount: unitTokens });
        } else {
          const slices = await sliceToFitLocally(
            model,
            unit,
            Math.floor(maxTokens * 0.9),
          );
          for (const slice of slices) {
            const tokenCount = await count(model, slice);
            chunks.push({ text: slice, tokenCount });
          }
        }
      }
      continue;
    }

    if (!currentText) {
      currentText = block;
      currentTokenCount = blockTokens;
      continue;
    }

    const joined = `${currentText}\n\n${block}`;
    const joinedTokens = await count(model, joined);
    if (joinedTokens <= maxTokens) {
      currentText = joined;
      currentTokenCount = joinedTokens;
      continue;
    }

    flushCurrent();
    currentText = block;
    currentTokenCount = blockTokens;
  }

  flushCurrent();
  return chunks;
}

export async function chunkText(
  text: string,
  model: ProviderEmbeddingModel,
  cfg?: IngestConfig,
  options?: {
    logContext?: ChunkTextLogContext;
    fileInfo?: ChunkTextFileInfo;
  },
): Promise<Chunk[]> {
  const config = cfg ?? resolveConfig();
  const maxTokens = await getSafeLimit(model, config);
  const candidateChunks: Array<Omit<Chunk, 'chunkIndex'>> = [];

  if (shouldUseProseChunking(config, options?.fileInfo)) {
    const ext = resolveFileExtension(options.fileInfo);
    const context = {
      runId: options?.logContext?.runId ?? 'unknown',
      relPath: options.fileInfo.relPath,
      ext,
      sizeBytes: options.fileInfo.sizeBytes,
      thresholdBytes: config.largeTextThresholdBytes,
      strategy: 'prose',
    };
    append({
      level: 'info',
      source: 'server',
      message: 'DEV-0000054:large_text_path_selected',
      timestamp: new Date().toISOString(),
      context,
    });
    baseLogger.info(context, 'DEV-0000054:large_text_path_selected');
    candidateChunks.push(...(await buildProseChunks(text, model, maxTokens)));
  } else {
    const boundary =
      /^(class\s+\w+|function\s+\w+|const\s+\w+\s*=\s*\(|export\s+(function|class))/m;
    const pieces = splitOnBoundaries(text, boundary);

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

  return filteredChunks.map((chunk, chunkIndex) => ({
    ...chunk,
    chunkIndex,
  }));
}
