import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  __setQueueRuntimeOpsForTest,
  recoverIngestQueueOnStartup,
  waitForTerminalIngestStatus,
} from '../../ingest/ingestJob.js';
import { getIngestQueueAvailability } from '../../ingest/requestQueue.js';
import * as requestQueue from '../../ingest/requestQueue.js';
import { query } from '../../logStore.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import {
  INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT,
  INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE,
  recoverIngestQueueForStartup,
} from '../../startup/ingestQueueStartup.js';
import {
  createQueueRequest,
  createTempRepo,
  installQueueRuntimeTestHooks,
  setupIngestChromaMocks,
} from './ingest-queue-runtime.helpers.js';

installQueueRuntimeTestHooks();

test('startup recovery rejects error root drift before queued reembed delta work resumes', async () => {
  const { root, cleanup } = await createTempRepo({
    'src/recovery-error.ts': 'export const recoveryError = true;\n',
  });
  setupIngestChromaMocks({
    rootIds: ['root-recovery-error'],
    rootMetadatas: [
      {
        root,
        state: 'error',
        lastIngestAt: '2026-01-04T00:00:00.000Z',
      },
    ],
  });
  const deletedRequestIds: string[] = [];
  const listRootCalls = mock.fn(() => ({
    select: () => ({
      lean: () => ({
        exec: async () => [],
      }),
    }),
  }));
  const recoveryQueueRequest = createQueueRequest({
    requestId: '23',
    root,
    queueState: 'running',
    runId: 'run-recovered-invalid-state',
  });

  try {
    mock.method(IngestFileModel, 'find', listRootCalls);

    __setQueueRuntimeOpsForTest({
      deleteQueueRequestById: async (requestId: string) => {
        deletedRequestIds.push(requestId);
        return null;
      },
      findOldestCleanupBlockedQueueRequest: async () => null,
      findOldestRunningQueueRequest: async () => recoveryQueueRequest,
      markQueueRequestNonReplayable: async () => null,
      markQueueRequestTerminalPublished: async () => null,
      promoteOldestWaitingQueueRequest: async () => null,
    });

    const result = await recoverIngestQueueOnStartup();
    assert.equal(result.recovered, true);

    const terminal = await waitForTerminalIngestStatus(
      recoveryQueueRequest.runId!,
      {
        timeoutMs: 1_000,
        pollMs: 10,
      },
    );

    assert.equal(terminal.reason, 'terminal');
    assert.equal(terminal.status?.state, 'error');
    assert.equal(terminal.status?.lastError, 'INVALID_REEMBED_STATE');
    assert.equal(listRootCalls.mock.calls.length, 0);
    assert.deepEqual(deletedRequestIds, [
      requestQueue.getQueueRequestId(recoveryQueueRequest),
    ]);
  } finally {
    await cleanup();
  }
});

test('startup recovery preserves INVALID_REEMBED_STATE when persisted error root drift is detected before reembed resumes', async () => {
  const { root, cleanup } = await createTempRepo({
    'src/recovery-error-code.ts': 'export const recoveryErrorCode = true;\n',
  });
  setupIngestChromaMocks({
    rootIds: ['root-recovery-error-code'],
    rootMetadatas: [
      {
        root,
        state: 'error',
        lastIngestAt: '2026-01-05T00:00:00.000Z',
      },
    ],
  });
  const recoveryQueueRequest = createQueueRequest({
    requestId: '24',
    root,
    queueState: 'running',
    runId: 'run-recovered-invalid-state-code',
  });

  try {
    __setQueueRuntimeOpsForTest({
      deleteQueueRequestById: async () => null,
      findOldestCleanupBlockedQueueRequest: async () => null,
      findOldestRunningQueueRequest: async () => recoveryQueueRequest,
      markQueueRequestTerminalPublished: async () => null,
      promoteOldestWaitingQueueRequest: async () => null,
    });

    const result = await recoverIngestQueueOnStartup();
    assert.equal(result.recovered, true);

    const terminal = await waitForTerminalIngestStatus(
      recoveryQueueRequest.runId!,
      {
        timeoutMs: 1_000,
        pollMs: 10,
      },
    );

    assert.equal(terminal.reason, 'terminal');
    assert.equal(terminal.status?.state, 'error');
    assert.equal(terminal.status?.error?.error, 'INVALID_REEMBED_STATE');
    assert.equal(terminal.status?.error?.provider, 'ingest');
    assert.equal(terminal.status?.error?.retryable, false);
  } finally {
    await cleanup();
  }
});

test('startup recovery fails closed when the live root-state read degrades before replay validation can prove the root is allowed', async () => {
  const { root, cleanup } = await createTempRepo({
    'src/recovery-read-failure.ts':
      'export const recoveryReadFailure = true;\n',
  });
  setupIngestChromaMocks({
    rootMetadataReadError: new Error('roots metadata unavailable'),
  });
  const recoveryQueueRequest = createQueueRequest({
    requestId: '25',
    root,
    queueState: 'running',
    runId: 'run-recovered-read-failure',
  });

  try {
    __setQueueRuntimeOpsForTest({
      deleteQueueRequestById: async () => null,
      findOldestCleanupBlockedQueueRequest: async () => null,
      findOldestRunningQueueRequest: async () => recoveryQueueRequest,
      markQueueRequestTerminalPublished: async () => null,
      promoteOldestWaitingQueueRequest: async () => null,
    });

    const result = await recoverIngestQueueOnStartup();
    assert.equal(result.recovered, true);

    const terminal = await waitForTerminalIngestStatus(
      recoveryQueueRequest.runId!,
      {
        timeoutMs: 1_000,
        pollMs: 10,
      },
    );

    assert.equal(terminal.reason, 'terminal');
    assert.equal(terminal.status?.state, 'error');
    assert.equal(terminal.status?.lastError, 'INVALID_REEMBED_STATE');
    assert.equal(terminal.status?.error?.error, 'INVALID_REEMBED_STATE');
    assert.equal(terminal.status?.error?.provider, 'ingest');
  } finally {
    await cleanup();
  }
});

test('recovery selectors use one oldest-item lookup per queue state instead of loading the full queue', async () => {
  const counts = {
    cleanupBlockedLookups: 0,
    runningLookups: 0,
    waitingPromotions: 0,
  };
  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () => {
      counts.cleanupBlockedLookups += 1;
      return null;
    },
    findOldestRunningQueueRequest: async () => {
      counts.runningLookups += 1;
      return null;
    },
    promoteOldestWaitingQueueRequest: async () => {
      counts.waitingPromotions += 1;
      return null;
    },
  });

  const result = await recoverIngestQueueOnStartup();

  assert.equal(result.recovered, false);
  assert.deepEqual(counts, {
    cleanupBlockedLookups: 2,
    runningLookups: 1,
    waitingPromotions: 1,
  });
});

test('post-connect startup recovery degradation keeps the standard startup path reachable', async () => {
  const events: string[] = [];

  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () => {
      events.push('cleanup-lookup');
      throw new Error('startup queue lookup failed');
    },
    findOldestRunningQueueRequest: async () => {
      events.push('running-lookup');
      return null;
    },
    promoteOldestWaitingQueueRequest: async () => {
      events.push('waiting-promote');
      return null;
    },
  });

  const result = await recoverIngestQueueForStartup();

  assert.equal(result.reachable, true);
  assert.equal(result.degraded, true);
  assert.deepEqual(events, ['cleanup-lookup']);
  assert.deepEqual(result.queueAvailability, {
    available: false,
    message: INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE,
  });
});

test('post-connect startup recovery degradation emits an explicit diagnostic result and log', async () => {
  const result = await recoverIngestQueueForStartup({
    recoverQueueOnStartup: async () => {
      throw new Error('startup queue write failed');
    },
    now: () => '2026-04-13T23:00:00.000Z',
  });

  assert.equal(result.reachable, true);
  assert.equal(result.degraded, true);
  assert.equal(
    result.diagnosticEvent,
    INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT,
  );
  assert.equal(result.causeMessage, 'startup queue write failed');
  assert.deepEqual(getIngestQueueAvailability(), {
    available: false,
    message: INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE,
  });

  const entries = query(
    { text: INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT },
    10,
  );
  const degradedEntry = entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.message === INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT &&
      entry.context?.queueUnavailableMessage ===
        INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE,
  );
  assert.ok(degradedEntry, 'expected degraded startup diagnostic log');
});
