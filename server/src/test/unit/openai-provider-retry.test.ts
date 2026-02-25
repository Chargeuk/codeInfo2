import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  OPENAI_RETRY_DEFAULT_MAX_RETRIES,
  OPENAI_RETRY_BASE_DELAY_MS,
  OPENAI_RETRY_JITTER_MAX,
  OPENAI_RETRY_JITTER_MIN,
  OPENAI_RETRY_MAX_DELAY_MS,
  OPENAI_RETRY_MAX_RETRIES,
  computeExponentialDelayMs,
  resolveRetryAfterMs,
  runOpenAiWithRetry,
} from '../../ingest/providers/index.js';

test.afterEach(() => {
  mock.restoreAll();
});

test('OpenAI retry defaults match story policy', () => {
  assert.equal(OPENAI_RETRY_DEFAULT_MAX_RETRIES, 3);
  assert.equal(OPENAI_RETRY_MAX_RETRIES, OPENAI_RETRY_DEFAULT_MAX_RETRIES);
  assert.equal(OPENAI_RETRY_BASE_DELAY_MS, 500);
  assert.equal(OPENAI_RETRY_MAX_DELAY_MS, 8000);
  assert.equal(OPENAI_RETRY_JITTER_MIN, 0.75);
  assert.equal(OPENAI_RETRY_JITTER_MAX, 1.0);

  mock.method(Math, 'random', () => 0);
  const low = computeExponentialDelayMs(1);
  assert.equal(low, 375);

  mock.restoreAll();
  mock.method(Math, 'random', () => 1);
  const high = computeExponentialDelayMs(10);
  assert.equal(high, 8000);
});

test('runtime OPENAI_INGEST_MAX_RETRIES override is honored for retry budget', async () => {
  const previous = process.env.OPENAI_INGEST_MAX_RETRIES;
  process.env.OPENAI_INGEST_MAX_RETRIES = '2';
  try {
    let callCount = 0;
    await assert.rejects(
      () =>
        runOpenAiWithRetry({
          model: 'text-embedding-3-small',
          inputCount: 1,
          tokenEstimate: 42,
          sleep: async () => {},
          runStep: async () => {
            callCount += 1;
            throw { status: 503, message: 'temporary outage' };
          },
        }),
      () => true,
    );
    // 2 retries after initial attempt => 3 total attempts.
    assert.equal(callCount, 3);
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAI_INGEST_MAX_RETRIES;
    } else {
      process.env.OPENAI_INGEST_MAX_RETRIES = previous;
    }
  }
});

test('runtime OPENAI_INGEST_MAX_RETRIES falls back to default when invalid', async () => {
  const previous = process.env.OPENAI_INGEST_MAX_RETRIES;
  process.env.OPENAI_INGEST_MAX_RETRIES = '0';
  try {
    let callCount = 0;
    await assert.rejects(
      () =>
        runOpenAiWithRetry({
          model: 'text-embedding-3-small',
          inputCount: 1,
          tokenEstimate: 42,
          sleep: async () => {},
          runStep: async () => {
            callCount += 1;
            throw { status: 503, message: 'temporary outage' };
          },
        }),
      () => true,
    );
    // Default is 3 retries after initial attempt => 4 total attempts.
    assert.equal(callCount, OPENAI_RETRY_DEFAULT_MAX_RETRIES + 1);
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAI_INGEST_MAX_RETRIES;
    } else {
      process.env.OPENAI_INGEST_MAX_RETRIES = previous;
    }
  }
});

test('retry-after-ms takes precedence over retry-after', () => {
  const headers = {
    'retry-after-ms': '1600',
    'retry-after': '25',
  };
  assert.equal(resolveRetryAfterMs(headers), 1600);
});

test('invalid wait hints fall back without throwing', async () => {
  const sleeps: number[] = [];
  mock.method(Math, 'random', () => 0);

  let callCount = 0;
  const result = await runOpenAiWithRetry({
    model: 'text-embedding-3-small',
    inputCount: 1,
    tokenEstimate: 100,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    runStep: async () => {
      callCount += 1;
      if (callCount === 1) {
        throw {
          status: 429,
          message: 'rate limited',
          headers: {
            'retry-after-ms': '-9',
            'retry-after': 'not-a-date',
          },
        };
      }
      return 'ok';
    },
  });

  assert.equal(result, 'ok');
  assert.equal(callCount, 2);
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 375);
});

test('retry exhaustion returns normalized terminal metadata without SDK object leak', async () => {
  const raw = {
    status: 503,
    headers: { 'retry-after-ms': '1200' },
    message: 'temporary outage sk-test-key',
    stack: 'stack-trace',
  };

  await assert.rejects(
    () =>
      runOpenAiWithRetry({
        model: 'text-embedding-3-small',
        inputCount: 1,
        tokenEstimate: 12,
        sleep: async () => {},
        runStep: async () => {
          throw raw;
        },
      }),
    (error: unknown) => {
      const mapped = error as {
        code?: string;
        retryable?: boolean;
        upstreamStatus?: number;
        retryAfterMs?: number;
        message?: string;
      };
      assert.equal(mapped.code, 'OPENAI_UNAVAILABLE');
      assert.equal(mapped.retryable, true);
      assert.equal(mapped.upstreamStatus, 503);
      assert.equal(mapped.retryAfterMs, 1200);
      assert.equal(String(mapped.message ?? '').includes('sk-test-key'), false);
      return true;
    },
  );
});
