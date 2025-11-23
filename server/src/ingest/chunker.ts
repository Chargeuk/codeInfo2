import type { EmbeddingModel } from '@lmstudio/sdk';
import { resolveConfig } from './config.js';
import { IngestConfig, Chunk } from './types.js';

async function getSafeLimit(
  model: EmbeddingModel,
  cfg: IngestConfig,
): Promise<number> {
  try {
    const ctx = await model.getContextLength();
    return Math.floor(ctx * cfg.tokenSafetyMargin);
  } catch {
    return cfg.fallbackTokenLimit;
  }
}

async function count(model: EmbeddingModel, text: string): Promise<number> {
  try {
    return await model.countTokens(text);
  } catch {
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

async function sliceToFit(
  model: EmbeddingModel,
  text: string,
  maxTokens: number,
): Promise<string[]> {
  const slices: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let candidate = remaining;
    const tokens = await count(model, candidate);
    if (tokens <= maxTokens) {
      slices.push(candidate);
      break;
    }
    const ratio = Math.max(0.5, (maxTokens * 0.75) / tokens);
    const cut = Math.max(1, Math.floor(candidate.length * ratio));
    candidate = candidate.slice(0, cut);
    slices.push(candidate);
    remaining = remaining.slice(cut);
  }
  return slices.filter(Boolean);
}

export async function chunkText(
  text: string,
  model: EmbeddingModel,
  cfg?: IngestConfig,
): Promise<Chunk[]> {
  const config = cfg ?? resolveConfig();
  const maxTokens = await getSafeLimit(model, config);
  const boundary =
    /^(class\s+\w+|function\s+\w+|const\s+\w+\s*=\s*\(|export\s+(function|class))/m;
  const pieces = splitOnBoundaries(text, boundary);
  const chunks: Chunk[] = [];

  for (const piece of pieces) {
    const initialTokens = await count(model, piece);
    if (initialTokens <= maxTokens) {
      chunks.push({
        chunkIndex: chunks.length,
        text: piece,
        tokenCount: initialTokens,
      });
    } else {
      const slices = await sliceToFit(
        model,
        piece,
        Math.floor(maxTokens * 0.85),
      );
      for (const slice of slices) {
        const tokenCount = await count(model, slice);
        chunks.push({ chunkIndex: chunks.length, text: slice, tokenCount });
      }
    }
  }

  return chunks;
}
