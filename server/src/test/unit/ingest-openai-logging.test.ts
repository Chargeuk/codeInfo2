import assert from 'node:assert/strict';
import test from 'node:test';
import { query, resetStore } from '../../logStore.js';
import { runOpenAiWithRetry } from '../../ingest/providers/openaiRetry.js';

test.beforeEach(() => {
  resetStore();
});

test('OpenAI retry failures append warn logs with ingest context', async () => {
  let attempts = 0;
  const result = await runOpenAiWithRetry({
    model: 'text-embedding-3-small',
    inputCount: 1,
    tokenEstimate: 10,
    ingestFailureContext: () => ({
      runId: 'run-openai-retry',
      path: '/tmp/repo',
      root: '/tmp/repo',
      currentFile: 'src/a.ts',
    }),
    sleep: async () => {},
    runStep: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw {
          status: 429,
          message: 'rate limited',
          headers: { 'retry-after-ms': '1200' },
        };
      }
      return 'ok';
    },
  });

  assert.equal(result, 'ok');
  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const retryWarn = entries.find(
    (entry) =>
      entry.level === 'warn' &&
      entry.context?.stage === 'retry' &&
      entry.context?.provider === 'openai',
  );
  assert.ok(retryWarn, 'expected retry warn ingest failure log');
  assert.equal(retryWarn?.context?.runId, 'run-openai-retry');
  assert.equal(retryWarn?.context?.code, 'OPENAI_RATE_LIMITED');
  assert.equal(retryWarn?.context?.retryable, true);
  assert.equal(retryWarn?.context?.waitMs, 1200);
  assert.equal(retryWarn?.context?.currentFile, 'src/a.ts');
});

test('OpenAI retry exhaustion appends terminal error log with ingest context', async () => {
  await assert.rejects(() =>
    runOpenAiWithRetry({
      model: 'text-embedding-3-small',
      inputCount: 1,
      tokenEstimate: 12,
      ingestFailureContext: () => ({
        runId: 'run-openai-terminal',
        path: '/tmp/repo',
        root: '/tmp/repo',
        currentFile: 'src/b.ts',
      }),
      sleep: async () => {},
      runStep: async () => {
        throw { status: 503, message: 'upstream unavailable' };
      },
    }),
  );

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const terminalError = entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.context?.stage === 'terminal' &&
      entry.context?.provider === 'openai',
  );
  assert.ok(terminalError, 'expected terminal error ingest failure log');
  assert.equal(terminalError?.context?.runId, 'run-openai-terminal');
  assert.equal(terminalError?.context?.code, 'OPENAI_UNAVAILABLE');
  assert.equal(terminalError?.context?.retryable, true);
  assert.equal(terminalError?.context?.currentFile, 'src/b.ts');
});
