import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveOpenAiModelTokenLimit,
  validateOpenAiEmbeddingGuardrails,
} from '../../ingest/providers/index.js';

function buildInputs(count: number, text: string): string[] {
  return Array.from({ length: count }, () => text);
}

test('input array boundary enforces 2048 pass and 2049 reject', () => {
  const ok = validateOpenAiEmbeddingGuardrails({
    model: 'text-embedding-3-small',
    inputs: buildInputs(2048, 'x'),
    estimateTokens: () => 1,
  });
  assert.equal(ok.tokenEstimate, 2048);

  assert.throws(
    () =>
      validateOpenAiEmbeddingGuardrails({
        model: 'text-embedding-3-small',
        inputs: buildInputs(2049, 'x'),
        estimateTokens: () => 1,
      }),
    /OPENAI_INPUT_TOO_LARGE|exceeds max input count/i,
  );
});

test('total token boundary enforces 300000 pass and 300001 reject', () => {
  const passInputs = buildInputs(100, 'ok');
  const pass = validateOpenAiEmbeddingGuardrails({
    model: 'text-embedding-3-small',
    inputs: passInputs,
    estimateTokens: () => 3000,
  });
  assert.equal(pass.tokenEstimate, 300000);

  const failInputs = buildInputs(100, 'too-big');
  assert.throws(
    () =>
      validateOpenAiEmbeddingGuardrails({
        model: 'text-embedding-3-small',
        inputs: failInputs,
        estimateTokens: () => 3001,
      }),
    /OPENAI_INPUT_TOO_LARGE|total token limit/i,
  );
});

test('per-input token max boundaries enforce max-1, max, and max+1', () => {
  const max = resolveOpenAiModelTokenLimit('text-embedding-3-small');

  const almost = validateOpenAiEmbeddingGuardrails({
    model: 'text-embedding-3-small',
    inputs: ['a'],
    estimateTokens: () => max - 1,
  });
  assert.equal(almost.tokenEstimate, max - 1);

  const exact = validateOpenAiEmbeddingGuardrails({
    model: 'text-embedding-3-small',
    inputs: ['b'],
    estimateTokens: () => max,
  });
  assert.equal(exact.tokenEstimate, max);

  assert.throws(
    () =>
      validateOpenAiEmbeddingGuardrails({
        model: 'text-embedding-3-small',
        inputs: ['c'],
        estimateTokens: () => max + 1,
      }),
    /OPENAI_INPUT_TOO_LARGE|per-input token limit/i,
  );
});
