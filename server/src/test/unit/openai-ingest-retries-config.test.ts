import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOpenAiIngestMaxRetries } from '../../config/openaiIngestRetries.js';

test('OpenAI ingest retry config defaults to 3 when env is unset', () => {
  assert.equal(resolveOpenAiIngestMaxRetries({}), 3);
});

test('OpenAI ingest retry config falls back to 3 for invalid env values', () => {
  assert.equal(
    resolveOpenAiIngestMaxRetries({ OPENAI_INGEST_MAX_RETRIES: '0' }),
    3,
  );
  assert.equal(
    resolveOpenAiIngestMaxRetries({ OPENAI_INGEST_MAX_RETRIES: '-4' }),
    3,
  );
  assert.equal(
    resolveOpenAiIngestMaxRetries({ OPENAI_INGEST_MAX_RETRIES: 'abc' }),
    3,
  );
});

test('OpenAI ingest retry config accepts valid positive integer env values', () => {
  assert.equal(
    resolveOpenAiIngestMaxRetries({ OPENAI_INGEST_MAX_RETRIES: '7' }),
    7,
  );
  assert.equal(
    resolveOpenAiIngestMaxRetries({ OPENAI_INGEST_MAX_RETRIES: ' 7 ' }),
    7,
  );
});

test('OpenAI ingest retry config rejects mixed-format and non-decimal values', () => {
  assert.equal(
    resolveOpenAiIngestMaxRetries({ OPENAI_INGEST_MAX_RETRIES: '7abc' }),
    3,
  );
  assert.equal(
    resolveOpenAiIngestMaxRetries({ OPENAI_INGEST_MAX_RETRIES: '3.5' }),
    3,
  );
  assert.equal(
    resolveOpenAiIngestMaxRetries({ OPENAI_INGEST_MAX_RETRIES: '1e2' }),
    3,
  );
});
