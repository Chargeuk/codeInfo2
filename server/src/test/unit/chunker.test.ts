import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProviderEmbeddingModel } from '../../ingest/providers/types.js';
import { exampleOne, longRun } from '../../ingest/__fixtures__/sample.js';
import { chunkText } from '../../ingest/chunker.js';

const mockModel = (
  ctx: number,
  tokenPerChar = 0.2,
): ProviderEmbeddingModel => ({
  async getContextLength() {
    return ctx;
  },
  async countTokens(text: string) {
    return Math.ceil(text.length * tokenPerChar);
  },
  async embedText(text: string) {
    void text;
    return [];
  },
});

test('splits on boundary markers first', async () => {
  const model = mockModel(200);
  const chunks = await chunkText(exampleOne, model);
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
  const chunks = await chunkText(longRun, model, config);
  assert.ok(chunks.length > 1, 'expected slices');
  assert.ok(chunks.every((c) => c.tokenCount <= maxTokens));
});

test('returns no chunks for an empty string', async () => {
  const chunks = await chunkText('', mockModel(200));
  assert.deepEqual(chunks, []);
});

test('returns no chunks for whitespace-only content', async () => {
  const chunks = await chunkText(' \n\t  ', mockModel(200));
  assert.deepEqual(chunks, []);
});

test('drops leading blank boundary output before the first real chunk', async () => {
  const chunks = await chunkText(
    '\n\nfunction alpha() {\n  return 1;\n}\n',
    mockModel(200),
  );
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].text.startsWith('function alpha()'));
});

test('filters whitespace-only slices from the fallback slice path', async () => {
  const model = mockModel(10, 1);
  const config = {
    includes: [],
    excludes: [],
    tokenSafetyMargin: 1,
    fallbackTokenLimit: 10,
    flushEvery: 20,
  };

  const chunks = await chunkText(`abcdefgh${' '.repeat(12)}`, model, config);

  assert.deepEqual(
    chunks.map((chunk) => chunk.text),
    ['abcdefgh'],
  );
});

test('renumbers chunk indexes after blank chunks are removed', async () => {
  const chunks = await chunkText(
    '\nfunction alpha() {}\nclass Beta {}\n',
    mockModel(200),
  );

  assert.deepEqual(
    chunks.map((chunk) => chunk.chunkIndex),
    [0, 1],
  );
});

test('preserves normal non-blank chunk ordering after blank filtering', async () => {
  const chunks = await chunkText(
    '\nfunction alpha() {\n  return 1;\n}\nclass Beta {}\n',
    mockModel(200),
  );

  assert.deepEqual(
    chunks.map((chunk) => chunk.text),
    ['function alpha() {\n  return 1;\n}', 'class Beta {}\n'],
  );
});
