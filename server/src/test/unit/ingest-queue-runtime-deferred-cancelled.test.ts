import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __setQueueRuntimeOpsForTest,
  pumpIngestQueue,
  waitForTerminalIngestStatus,
} from '../../ingest/ingestJob.js';
import {
  createQueueRequest,
  createTempRepo,
  installQueueRuntimeTestHooks,
  setupIngestChromaMocks,
} from './ingest-queue-runtime.helpers.js';

installQueueRuntimeTestHooks();

test('queue-managed deferred reembed preserves INVALID_REEMBED_STATE when cancelled root drift is detected at execution time', async () => {
  const { root, cleanup } = await createTempRepo({
    'src/deferred-cancelled-code.ts':
      'export const deferredCancelledCode = true;\n',
  });
  setupIngestChromaMocks({
    rootIds: ['root-deferred-cancelled-code'],
    rootMetadatas: [
      {
        root,
        state: 'cancelled',
        lastIngestAt: '2026-01-03T00:00:00.000Z',
      },
    ],
  });

  try {
    let promotedOnce = false;
    __setQueueRuntimeOpsForTest({
      deleteQueueRequestById: async () => null,
      findOldestCleanupBlockedQueueRequest: async () => null,
      markQueueRequestNonReplayable: async () => null,
      markQueueRequestTerminalPublished: async () => null,
      promoteOldestWaitingQueueRequest: async (runId: string) => {
        if (promotedOnce) {
          return null;
        }
        promotedOnce = true;
        return {
          ...createQueueRequest({
            requestId: '22',
            root,
            queueState: 'running',
            runId,
          }),
          runId,
        };
      },
    });

    const started = await pumpIngestQueue();
    assert.equal(started.started, true);
    assert.ok(started.runId);

    const terminal = await waitForTerminalIngestStatus(started.runId!, {
      timeoutMs: 1_000,
      pollMs: 10,
    });

    assert.equal(terminal.reason, 'terminal');
    assert.equal(terminal.status?.state, 'error');
    assert.equal(terminal.status?.error?.error, 'INVALID_REEMBED_STATE');
    assert.equal(terminal.status?.error?.provider, 'ingest');
    assert.equal(terminal.status?.error?.retryable, false);
  } finally {
    await cleanup();
  }
});

test('queue-managed deferred reembed fails closed when the live root-state read degrades before replay validation can prove the root is allowed', async () => {
  const { root, cleanup } = await createTempRepo({
    'src/deferred-read-failure.ts':
      'export const deferredReadFailure = true;\n',
  });
  setupIngestChromaMocks({
    rootMetadataReadError: new Error('roots metadata unavailable'),
  });

  try {
    let promotedOnce = false;
    __setQueueRuntimeOpsForTest({
      deleteQueueRequestById: async () => null,
      findOldestCleanupBlockedQueueRequest: async () => null,
      markQueueRequestNonReplayable: async () => null,
      markQueueRequestTerminalPublished: async () => null,
      promoteOldestWaitingQueueRequest: async (runId: string) => {
        if (promotedOnce) {
          return null;
        }
        promotedOnce = true;
        return {
          ...createQueueRequest({
            requestId: '23',
            root,
            queueState: 'running',
            runId,
          }),
          runId,
        };
      },
    });

    const started = await pumpIngestQueue();
    assert.equal(started.started, true);
    assert.ok(started.runId);

    const terminal = await waitForTerminalIngestStatus(started.runId!, {
      timeoutMs: 1_000,
      pollMs: 10,
    });

    assert.equal(terminal.reason, 'terminal');
    assert.equal(terminal.status?.state, 'error');
    assert.equal(terminal.status?.lastError, 'INVALID_REEMBED_STATE');
    assert.equal(terminal.status?.error?.error, 'INVALID_REEMBED_STATE');
    assert.equal(terminal.status?.error?.provider, 'ingest');
  } finally {
    await cleanup();
  }
});
