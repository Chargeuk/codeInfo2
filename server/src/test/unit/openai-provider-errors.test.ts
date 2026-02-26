import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapOpenAiError,
  sanitizeOpenAiErrorMessage,
} from '../../ingest/providers/openaiErrors.js';

function shape(err: unknown) {
  return mapOpenAiError(err).toShape();
}

test('maps auth/permission/model/bad-request/unprocessable taxonomy', () => {
  assert.equal(
    shape({ status: 401, message: 'bad key' }).code,
    'OPENAI_AUTH_FAILED',
  );
  assert.equal(
    shape({ status: 403, message: 'forbidden' }).code,
    'OPENAI_PERMISSION_DENIED',
  );
  assert.equal(
    shape({ status: 404, message: 'missing model' }).code,
    'OPENAI_MODEL_UNAVAILABLE',
  );
  assert.equal(
    shape({ status: 400, message: 'invalid field' }).code,
    'OPENAI_BAD_REQUEST',
  );
  assert.equal(
    shape({ status: 422, message: 'unprocessable' }).code,
    'OPENAI_UNPROCESSABLE',
  );
});

test('maps input-too-large failures including context_length_exceeded', () => {
  const byCode = shape({
    status: 400,
    code: 'context_length_exceeded',
    message: 'too many tokens',
  });
  assert.equal(byCode.code, 'OPENAI_INPUT_TOO_LARGE');
  assert.equal(byCode.retryable, false);

  const byMessage = shape({
    status: 400,
    message: 'This request exceeds maximum context length',
  });
  assert.equal(byMessage.code, 'OPENAI_INPUT_TOO_LARGE');
});

test('maps rate/quota/timeout/connection/unavailable taxonomy', () => {
  assert.equal(
    shape({ status: 429, message: 'rate limited' }).code,
    'OPENAI_RATE_LIMITED',
  );
  assert.equal(
    shape({
      status: 429,
      code: 'insufficient_quota',
      message: 'quota exceeded',
    }).code,
    'OPENAI_QUOTA_EXCEEDED',
  );
  assert.equal(
    shape({ status: 408, message: 'timeout' }).code,
    'OPENAI_TIMEOUT',
  );
  assert.equal(
    shape({ name: 'APIConnectionError', message: 'socket hangup' }).code,
    'OPENAI_CONNECTION_FAILED',
  );
  assert.equal(
    shape({ status: 503, message: 'upstream down' }).code,
    'OPENAI_UNAVAILABLE',
  );
});

test('taxonomy matrix exposes expected retryability and metadata shape', () => {
  const cases: Array<{
    input: Record<string, unknown>;
    code: string;
    retryable: boolean;
  }> = [
    {
      input: { status: 401, message: 'x' },
      code: 'OPENAI_AUTH_FAILED',
      retryable: false,
    },
    {
      input: { status: 403, message: 'x' },
      code: 'OPENAI_PERMISSION_DENIED',
      retryable: false,
    },
    {
      input: { status: 404, message: 'x' },
      code: 'OPENAI_MODEL_UNAVAILABLE',
      retryable: false,
    },
    {
      input: { status: 400, message: 'x' },
      code: 'OPENAI_BAD_REQUEST',
      retryable: false,
    },
    {
      input: { status: 400, code: 'context_length_exceeded', message: 'x' },
      code: 'OPENAI_INPUT_TOO_LARGE',
      retryable: false,
    },
    {
      input: { status: 422, message: 'x' },
      code: 'OPENAI_UNPROCESSABLE',
      retryable: false,
    },
    {
      input: { status: 429, message: 'x' },
      code: 'OPENAI_RATE_LIMITED',
      retryable: true,
    },
    {
      input: { status: 429, code: 'insufficient_quota', message: 'x' },
      code: 'OPENAI_QUOTA_EXCEEDED',
      retryable: false,
    },
    {
      input: { status: 408, message: 'x' },
      code: 'OPENAI_TIMEOUT',
      retryable: true,
    },
    {
      input: { name: 'APIConnectionError', message: 'x' },
      code: 'OPENAI_CONNECTION_FAILED',
      retryable: true,
    },
    {
      input: { status: 500, message: 'x' },
      code: 'OPENAI_UNAVAILABLE',
      retryable: true,
    },
  ];

  for (const entry of cases) {
    const mapped = shape(entry.input);
    assert.equal(mapped.provider, 'openai');
    assert.equal(mapped.code, entry.code);
    assert.equal(mapped.retryable, entry.retryable);
    assert.equal(typeof mapped.message, 'string');
    if ('status' in entry.input && typeof entry.input.status === 'number') {
      assert.equal(mapped.upstreamStatus, entry.input.status);
    }
  }
});

test('redacts key/token material from mapped errors and sanitizer output', () => {
  const dirty = 'authorization: Bearer sk-test-secret-token';
  const sanitized = sanitizeOpenAiErrorMessage(dirty);
  assert.equal(sanitized.includes('sk-test-secret-token'), false);

  const mapped = shape({ status: 401, message: dirty });
  assert.equal(mapped.message.includes('sk-test-secret-token'), false);
  assert.equal(
    mapped.message.toLowerCase().includes('authorization:***'),
    true,
  );
});
