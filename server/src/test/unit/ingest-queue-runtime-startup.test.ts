import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  __setQueueRuntimeOpsForTest,
  recoverIngestQueueOnStartup,
} from '../../ingest/ingestJob.js';
import { getIngestQueueAvailability } from '../../ingest/requestQueue.js';
import * as requestQueue from '../../ingest/requestQueue.js';
import { query } from '../../logStore.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import {
  INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_EVENT,
  INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE,
  INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT,
  INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE,
  recordIngestQueueStartupMongoUnavailable,
  recoverIngestQueueForStartup,
} from '../../startup/ingestQueueStartup.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
import {
  createQueueRequest,
  createTempRepo,
  installQueueRuntimeTestHooks,
  setupIngestChromaMocks,
  waitForQueueManagedTerminalStatus,
} from './ingest-queue-runtime.helpers.js';

installQueueRuntimeTestHooks();

async function waitForDeletedRequestIds(
  deletedRequestIds: string[],
  expectedIds: readonly string[],
) {
  const deadline = Date.now() + resolveConfiguredTestTimeoutMs(1_000);
  while (Date.now() < deadline) {
    if (
      expectedIds.every((expectedId) => deletedRequestIds.includes(expectedId))
    ) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(
    `Timed out waiting for deleted request ids ${expectedIds.join(', ')}; observed ${deletedRequestIds.join(', ')}`,
  );
}

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

    const terminal = await waitForQueueManagedTerminalStatus(
      requestQueue.getQueueRequestId(recoveryQueueRequest),
      1_000,
    );

    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'INVALID_REEMBED_STATE');
    assert.equal(listRootCalls.mock.calls.length, 0);
    const expectedDeletedRequestIds = [
      requestQueue.getQueueRequestId(recoveryQueueRequest),
    ];
    await waitForDeletedRequestIds(
      deletedRequestIds,
      expectedDeletedRequestIds,
    );
    assert.deepEqual(deletedRequestIds, expectedDeletedRequestIds);
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

    const terminal = await waitForQueueManagedTerminalStatus(
      requestQueue.getQueueRequestId(recoveryQueueRequest),
      1_000,
    );

    assert.equal(terminal.state, 'error');
    assert.equal(terminal.error?.error, 'INVALID_REEMBED_STATE');
    assert.equal(terminal.error?.provider, 'ingest');
    assert.equal(terminal.error?.retryable, false);
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

    const terminal = await waitForQueueManagedTerminalStatus(
      requestQueue.getQueueRequestId(recoveryQueueRequest),
      1_000,
    );

    assert.equal(terminal.state, 'error');
    assert.equal(terminal.lastError, 'INVALID_REEMBED_STATE');
    assert.equal(terminal.error?.error, 'INVALID_REEMBED_STATE');
    assert.equal(terminal.error?.provider, 'ingest');
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

test('initial Mongo outage records queue unavailable state without pretending persistence is usable', () => {
  const result = recordIngestQueueStartupMongoUnavailable({
    error: new Error('initial Mongo refused connection'),
    now: () => '2026-04-21T10:00:00.000Z',
  });

  assert.equal(result.reachable, true);
  assert.equal(result.degraded, true);
  assert.equal(result.recovery, null);
  assert.equal(
    result.diagnosticEvent,
    INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_EVENT,
  );
  assert.equal(result.causeMessage, 'initial Mongo refused connection');
  assert.deepEqual(getIngestQueueAvailability(), {
    available: false,
    message: INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE,
  });

  const entries = query(
    { text: INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_EVENT },
    10,
  );
  const degradedEntry = entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.message === INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_EVENT &&
      entry.context?.queueUnavailableMessage ===
        INGEST_QUEUE_STARTUP_MONGO_UNAVAILABLE_MESSAGE,
  );
  assert.ok(degradedEntry, 'expected initial Mongo outage diagnostic log');
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
