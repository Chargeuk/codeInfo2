import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENAI_MAX_INPUTS_PER_REQUEST,
  OPENAI_MAX_TOTAL_TOKENS_PER_REQUEST,
  OpenAiEmbeddingError,
  disposeOpenAiTokenizer,
  resolveOpenAiModelTokenLimit,
  setOpenAiTokenizerFactoryForTests,
  validateOpenAiEmbeddingGuardrails,
} from '../../ingest/providers/index.js';

function buildInputs(count: number, text: string): string[] {
  return Array.from({ length: count }, () => text);
}

function installLengthTokenizer() {
  setOpenAiTokenizerFactoryForTests(() => ({
    encode(value: string) {
      return new Uint32Array(value.length);
    },
    free() {},
  }));
}

test.afterEach(() => {
  disposeOpenAiTokenizer();
  setOpenAiTokenizerFactoryForTests();
});

test('tokenizer-backed guardrail blocks oversized input before request send', () => {
  installLengthTokenizer();

  assert.throws(
    () =>
      validateOpenAiEmbeddingGuardrails({
        model: 'text-embedding-3-small',
        inputs: ['x'.repeat(9000)],
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAiEmbeddingError);
      assert.equal(error.code, 'OPENAI_INPUT_TOO_LARGE');
      assert.match(error.message, /per-input token limit/i);
      return true;
    },
  );
});

test('blank-input handling still rejects whitespace-only content', () => {
  installLengthTokenizer();
  let blankContext:
    | {
        blankInputCount: number;
        batchSize: number;
      }
    | undefined;

  assert.throws(
    () =>
      validateOpenAiEmbeddingGuardrails({
        model: 'text-embedding-3-small',
        inputs: ['ok', '   \n\t '],
        onBlankInput: (context) => {
          blankContext = context;
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAiEmbeddingError);
      assert.equal(error.code, 'OPENAI_BAD_REQUEST');
      assert.match(error.message, /cannot be blank/i);
      return true;
    },
  );

  assert.deepEqual(blankContext, {
    blankInputCount: 1,
    batchSize: 2,
  });
});

test('max-input-count handling still enforces 2048 pass and 2049 reject', () => {
  installLengthTokenizer();

  const ok = validateOpenAiEmbeddingGuardrails({
    model: 'text-embedding-3-small',
    inputs: buildInputs(OPENAI_MAX_INPUTS_PER_REQUEST, 'x'),
  });
  assert.equal(ok.tokenEstimate, OPENAI_MAX_INPUTS_PER_REQUEST);

  assert.throws(
    () =>
      validateOpenAiEmbeddingGuardrails({
        model: 'text-embedding-3-small',
        inputs: buildInputs(OPENAI_MAX_INPUTS_PER_REQUEST + 1, 'x'),
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAiEmbeddingError);
      assert.equal(error.code, 'OPENAI_INPUT_TOO_LARGE');
      assert.match(error.message, /max input count/i);
      return true;
    },
  );
});

test('total token boundary enforces 300000 pass and 300001 reject', () => {
  installLengthTokenizer();

  const pass = validateOpenAiEmbeddingGuardrails({
    model: 'text-embedding-3-small',
    inputs: buildInputs(100, 'x'.repeat(3000)),
  });
  assert.equal(pass.tokenEstimate, OPENAI_MAX_TOTAL_TOKENS_PER_REQUEST);

  assert.throws(
    () =>
      validateOpenAiEmbeddingGuardrails({
        model: 'text-embedding-3-small',
        inputs: buildInputs(100, 'x'.repeat(3001)),
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAiEmbeddingError);
      assert.equal(error.code, 'OPENAI_INPUT_TOO_LARGE');
      assert.match(error.message, /total token limit/i);
      return true;
    },
  );
});

test('an input at exactly 8192 tokens is accepted', () => {
  installLengthTokenizer();
  const max = resolveOpenAiModelTokenLimit('text-embedding-3-small');

  const exact = validateOpenAiEmbeddingGuardrails({
    model: 'text-embedding-3-small',
    inputs: ['x'.repeat(max)],
  });

  assert.equal(max, 8192);
  assert.equal(exact.tokenEstimate, max);
  assert.deepEqual(exact.perInputEstimates, [max]);
});

test('an input at 8193 tokens is rejected with oversized-input classification', () => {
  installLengthTokenizer();
  const max = resolveOpenAiModelTokenLimit('text-embedding-3-small');

  assert.throws(
    () =>
      validateOpenAiEmbeddingGuardrails({
        model: 'text-embedding-3-small',
        inputs: ['x'.repeat(max + 1)],
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAiEmbeddingError);
      assert.equal(error.code, 'OPENAI_INPUT_TOO_LARGE');
      assert.match(error.message, /per-input token limit/i);
      return true;
    },
  );
});
