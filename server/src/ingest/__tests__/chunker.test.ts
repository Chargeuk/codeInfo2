import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EmbeddingModel } from '@lmstudio/sdk';
import { exampleOne, longRun } from '../__fixtures__/sample.js';
import { chunkText } from '../chunker.js';

const mockModel = (
  ctx: number,
  tokenPerChar = 0.2,
): Pick<EmbeddingModel, 'getContextLength' | 'countTokens'> => ({
  async getContextLength() {
    return ctx;
  },
  async countTokens(text: string) {
    return Math.ceil(text.length * tokenPerChar);
  },
});

test('splits on boundary markers first', async () => {
  const model = mockModel(200);
  const chunks = await chunkText(
    exampleOne,
    model as unknown as EmbeddingModel,
  );
  assert.ok(chunks.length >= 2, 'expected multiple chunks');
  assert.ok(chunks[0].text.includes('function alpha'));
  assert.ok(chunks[1].text.includes('class Beta'));
});

test('falls back to slicing when chunk exceeds limit', async () => {
  const model = mockModel(50, 1); // low context limit to trigger slicing
  const config = {
    includes: [],
    excludes: [],
    tokenSafetyMargin: 0.85,
    fallbackTokenLimit: 30,
    flushEvery: 20,
  };
  const maxTokens = Math.floor(50 * config.tokenSafetyMargin);
  const chunks = await chunkText(
    longRun,
    model as unknown as EmbeddingModel,
    config,
  );
  assert.ok(chunks.length > 1, 'expected slices');
  assert.ok(chunks.every((c) => c.tokenCount <= maxTokens));
});
