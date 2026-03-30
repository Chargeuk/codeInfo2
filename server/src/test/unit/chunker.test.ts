import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  exampleOne,
  longProseParagraph,
  longRun,
  prosePlanningDoc,
} from '../../ingest/__fixtures__/sample.js';
import { chunkText } from '../../ingest/chunker.js';
import {
  disposeOpenAiTokenizer,
  OpenAiEmbeddingError,
  setOpenAiTokenizerFactoryForTests,
} from '../../ingest/providers/index.js';
import type { ProviderEmbeddingModel } from '../../ingest/providers/types.js';
import type { IngestConfig } from '../../ingest/types.js';

const mockModel = (
  ctx: number,
  tokenPerChar = 0.2,
): ProviderEmbeddingModel => ({
  effectiveBatchSize: 1,
  supportsAbort: false,
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
  async embedBatch(texts: string[]) {
    return Promise.all(texts.map(async () => []));
  },
});

const createConfig = (overrides: Partial<IngestConfig> = {}): IngestConfig => ({
  includes: [],
  excludes: [],
  tokenSafetyMargin: 0.85,
  fallbackTokenLimit: 30,
  flushEvery: 20,
  largeTextThresholdBytes: 65536,
  openAiMaxBatchSize: 20,
  openAiMaxInFlight: 10,
  lmStudioMaxBatchSize: 1,
  lmStudioMaxInFlight: 4,
  maxQueueSize: -1,
  ...overrides,
});

test.afterEach(() => {
  disposeOpenAiTokenizer();
  setOpenAiTokenizerFactoryForTests();
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
  const config = createConfig();
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
  const config = createConfig({
    tokenSafetyMargin: 1,
    fallbackTokenLimit: 10,
  });

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

test('chunk sizing uses the shared tokenizer-backed helper for OpenAI models', async () => {
  let encodeCalls = 0;
  setOpenAiTokenizerFactoryForTests(() => ({
    encode(value: string) {
      encodeCalls += 1;
      return new Uint32Array(value.length);
    },
    free() {},
  }));

  const model: ProviderEmbeddingModel = {
    effectiveBatchSize: 1,
    supportsAbort: true,
    modelKey: 'text-embedding-3-small',
    async getContextLength() {
      return 12;
    },
    async countTokens() {
      throw new Error(
        'provider countTokens should not run for OpenAI chunking',
      );
    },
    async embedText() {
      return [];
    },
    async embedBatch(texts: string[]) {
      return Promise.all(texts.map(async () => []));
    },
  };

  const chunks = await chunkText('abcdefghijklmno', model, {
    ...createConfig(),
    tokenSafetyMargin: 1,
    fallbackTokenLimit: 12,
  });

  assert.ok(encodeCalls > 0);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.tokenCount <= 12));
});

test('tokenizer count failure during chunking raises a clear error without whitespace fallback', async () => {
  setOpenAiTokenizerFactoryForTests(() => ({
    encode() {
      throw new Error('encode exploded');
    },
    free() {},
  }));

  const model: ProviderEmbeddingModel = {
    effectiveBatchSize: 1,
    supportsAbort: true,
    modelKey: 'text-embedding-3-small',
    async getContextLength() {
      return 20;
    },
    async countTokens() {
      return 1;
    },
    async embedText() {
      return [];
    },
    async embedBatch(texts: string[]) {
      return Promise.all(texts.map(async () => []));
    },
  };

  await assert.rejects(
    () => chunkText('abcdefghij', model),
    (error: unknown) => {
      assert.ok(error instanceof OpenAiEmbeddingError);
      assert.equal(error.code, 'OPENAI_TOKENIZER_FAILED');
      assert.match(error.message, /count failed/i);
      assert.doesNotMatch(error.message, /whitespace/i);
      return true;
    },
  );
});

test('large prose markdown files take the prose route and prefer headings, lists, and fenced blocks', async () => {
  const chunks = await chunkText(
    prosePlanningDoc,
    mockModel(45, 0.35),
    createConfig({
      tokenSafetyMargin: 1,
      largeTextThresholdBytes: 10,
    }),
    {
      logContext: {
        runId: 'run-1',
        relPath: 'planning/story.md',
      },
      fileInfo: {
        relPath: 'planning/story.md',
        ext: 'md',
        sizeBytes: Buffer.byteLength(prosePlanningDoc, 'utf8'),
      },
    },
  );

  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].text.startsWith('# Story Heading'));
  assert.ok(chunks.some((chunk) => chunk.text.includes('## Goals')));
  assert.ok(
    chunks.some((chunk) => chunk.text.includes("return 'fenced block';")),
  );
});

test('small markdown files stay on the generic path', async () => {
  const smallMarkdown = '# Small heading\n\nJust a small note.';
  const chunks = await chunkText(
    smallMarkdown,
    mockModel(200),
    createConfig(),
    {
      fileInfo: {
        relPath: 'notes/small.md',
        ext: 'md',
        sizeBytes: Buffer.byteLength(smallMarkdown, 'utf8'),
      },
    },
  );

  assert.deepEqual(
    chunks.map((chunk) => chunk.text),
    [smallMarkdown],
  );
});

test('large non-prose extensions stay on the generic path', async () => {
  const chunks = await chunkText(
    exampleOne,
    mockModel(200),
    createConfig({ largeTextThresholdBytes: 1 }),
    {
      fileInfo: {
        relPath: 'src/example.ts',
        ext: 'ts',
        sizeBytes: Buffer.byteLength(exampleOne, 'utf8'),
      },
    },
  );

  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].text.includes('function alpha'));
  assert.ok(chunks[1].text.includes('class Beta'));
});

test('large prose route still enforces token limits and removes blank chunks', async () => {
  const model = mockModel(35, 1);
  const config = createConfig({
    tokenSafetyMargin: 1,
    fallbackTokenLimit: 20,
    largeTextThresholdBytes: 10,
  });
  const maxTokens = 35;
  const text = `# Heading

${longProseParagraph}


${' '.repeat(32)}

- bullet one
- bullet two`;

  const chunks = await chunkText(text, model, config, {
    fileInfo: {
      relPath: 'planning/large.txt',
      ext: 'txt',
      sizeBytes: Buffer.byteLength(text, 'utf8'),
    },
  });

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.tokenCount <= maxTokens));
  assert.ok(chunks.every((chunk) => chunk.text.trim().length > 0));
});
