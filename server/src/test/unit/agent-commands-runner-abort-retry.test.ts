import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { runWithRetry } from '../../agents/retry.js';
import {
  getErrorMessage,
  isTransientReconnect,
} from '../../agents/transientReconnect.js';

test('retries stop on abort', async () => {
  const controller = new AbortController();
  const runStep = mock.fn(async () => {
    throw new Error('Reconnecting... 1/5');
  });

  const promise = runWithRetry({
    runStep,
    signal: controller.signal,
    sleep: async () => undefined,
    maxAttempts: 3,
    baseDelayMs: 1,
    isRetryableError: (err) =>
      isTransientReconnect(getErrorMessage(err) ?? null),
    onRetry: () => controller.abort(),
  });

  await assert.rejects(promise, (err) => (err as Error).name === 'AbortError');
  assert.equal(runStep.mock.calls.length, 1);
});
