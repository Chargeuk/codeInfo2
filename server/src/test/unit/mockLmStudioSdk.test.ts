import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getControlledEmbeddingWaiterCount,
  startMock,
  stopMock,
  waitForControlledEmbeddingCalls,
} from '../support/mockLmStudioSdk.js';

test.afterEach(() => {
  stopMock();
});

test('controlled embedding waiters are cleaned up after timeout', async () => {
  startMock({ scenario: 'controlled-embedding' });

  await assert.rejects(
    () => waitForControlledEmbeddingCalls(1, 5),
    /Timed out waiting for 1 controlled embedding call/u,
  );

  assert.equal(getControlledEmbeddingWaiterCount(), 0);
});
