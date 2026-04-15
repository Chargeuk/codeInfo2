import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __finalizeQueueRequestForRunForTest,
  __getQueueRequestTerminalStatusCountForTest,
  __persistQueueTerminalBarrierForTest,
  __setQueueRequestIdForRunForTest,
  __setQueueRequestTerminalStatusNowForTest,
  __setQueueRequestTerminalStatusTtlForTest,
  __setQueueRuntimeOpsForTest,
  __setStatusAndPublishForTest,
  __setStatusForTest,
  getStatus,
  pumpIngestQueue,
  recoverIngestQueueOnStartup,
} from '../../ingest/ingestJob.js';
import {
  createQueueRequest,
  installQueueRuntimeTestHooks,
  waitForNextTurn,
} from './ingest-queue-runtime.helpers.js';

installQueueRuntimeTestHooks();

test('terminal queue cleanup deletes the current queue record before the next waiting item starts', async () => {
  const events: string[] = [];

  __setStatusForTest('run-finished', {
    runId: 'run-finished',
    state: 'completed',
    counts: { files: 1, chunks: 1, embedded: 1 },
    message: 'Completed',
    lastError: null,
  });
  __setQueueRequestIdForRunForTest('run-finished', 'queue-finished');

  __setQueueRuntimeOpsForTest({
    deleteQueueRequestById: async () => {
      events.push('delete-current');
      return createQueueRequest({
        requestId: '5',
        root: '/data/repo-finished',
        queueState: 'running',
        runId: 'run-finished',
      });
    },
    findOldestCleanupBlockedQueueRequest: async () => null,
    promoteOldestWaitingQueueRequest: async () => {
      events.push('promote-next');
      return null;
    },
  });

  const cleaned = await __finalizeQueueRequestForRunForTest('run-finished');
  await waitForNextTurn();
  await waitForNextTurn();

  assert.equal(cleaned, true);
  assert.deepEqual(events, ['delete-current', 'promote-next']);
});

test('terminal queue request cache retains completed entries until expiry and evicts them deterministically after the boundary', async () => {
  let terminalStatusNowMs = 1_000;
  const advanceTerminalStatusTime = (ms: number) => {
    terminalStatusNowMs += ms;
    __setQueueRequestTerminalStatusNowForTest(terminalStatusNowMs);
  };

  __setQueueRequestTerminalStatusNowForTest(terminalStatusNowMs);
  __setQueueRequestIdForRunForTest('run-evicted', 'queue-evicted');
  __setQueueRequestTerminalStatusTtlForTest(5);

  __setStatusAndPublishForTest('run-evicted', {
    runId: 'run-evicted',
    state: 'completed',
    counts: { files: 1, chunks: 1, embedded: 1 },
    message: 'Completed',
    lastError: null,
  });

  assert.equal(__getQueueRequestTerminalStatusCountForTest(), 1);
  advanceTerminalStatusTime(4);
  assert.equal(__getQueueRequestTerminalStatusCountForTest(), 1);
  advanceTerminalStatusTime(1);
  assert.equal(__getQueueRequestTerminalStatusCountForTest(), 0);
});

test('cleanup-blocked queue records stay visible and stall newer waiting work', async () => {
  __setStatusForTest('run-blocked', {
    runId: 'run-blocked',
    state: 'completed',
    counts: { files: 1, chunks: 1, embedded: 1 },
    message: 'Completed',
    lastError: null,
  });
  __setQueueRequestIdForRunForTest('run-blocked', 'queue-blocked');

  __setQueueRuntimeOpsForTest({
    deleteQueueRequestById: async () => {
      throw new Error('delete failed');
    },
    markQueueRequestCleanupBlocked: async () =>
      createQueueRequest({
        requestId: '7',
        root: '/data/repo-blocked',
        queueState: 'cleanup-blocked',
        runId: 'run-blocked',
      }),
    findOldestCleanupBlockedQueueRequest: async () =>
      createQueueRequest({
        requestId: '7',
        root: '/data/repo-blocked',
        queueState: 'cleanup-blocked',
        runId: 'run-blocked',
      }),
  });

  const cleaned = await __finalizeQueueRequestForRunForTest('run-blocked');
  const stalled = await pumpIngestQueue();

  assert.equal(cleaned, false);
  assert.equal(getStatus('run-blocked')?.state, 'cleanup-blocked');
  assert.equal(stalled.started, false);
  assert.equal(stalled.blockedByCleanup, true);
});

test('startup recovery resolves cleanup-blocked before retrying running work or waiting work', async () => {
  const events: string[] = [];
  __setQueueRequestIdForRunForTest('run-cleanup', 'queue-cleanup');

  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () =>
      createQueueRequest({
        requestId: '8',
        root: '/data/repo-cleanup',
        queueState: 'cleanup-blocked',
        runId: 'run-cleanup',
      }),
    deleteQueueRequestById: async () => {
      events.push('cleanup-first');
      return createQueueRequest({
        requestId: '8',
        root: '/data/repo-cleanup',
        queueState: 'cleanup-blocked',
        runId: 'run-cleanup',
      });
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

  const result = await recoverIngestQueueOnStartup();
  await waitForNextTurn();
  await waitForNextTurn();

  assert.equal(result.recovered, true);
  assert.deepEqual(events, ['cleanup-first']);
});

test('startup recovery does not advance past cleanup-blocked rows with missing runId', async () => {
  const events: string[] = [];

  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () =>
      createQueueRequest({
        requestId: '10',
        root: '/data/repo-cleanup-missing-run',
        queueState: 'cleanup-blocked',
        runId: null,
      }),
    findOldestRunningQueueRequest: async () => {
      events.push('running-lookup');
      return null;
    },
    promoteOldestWaitingQueueRequest: async () => {
      events.push('waiting-promote');
      return null;
    },
  });

  const result = await recoverIngestQueueOnStartup();

  assert.equal(result.recovered, false);
  assert.deepEqual(events, []);
});

test('queue-managed completion records a durable replay barrier even when terminal marker persistence fails after commit', async () => {
  const events: string[] = [];
  __setStatusForTest('run-barrier-written', {
    runId: 'run-barrier-written',
    state: 'completed',
    counts: { files: 1, chunks: 1, embedded: 1 },
    message: 'Completed',
    lastError: null,
  });
  __setQueueRequestIdForRunForTest(
    'run-barrier-written',
    'queue-barrier-written',
  );

  __setQueueRuntimeOpsForTest({
    deleteQueueRequestById: async (requestId: string) => {
      events.push(`deleted:${requestId}`);
      return null;
    },
    findOldestCleanupBlockedQueueRequest: async () => null,
    markQueueRequestNonReplayable: async ({ requestId, runId }) => {
      events.push(`barrier:${runId}:${requestId}`);
      return createQueueRequest({
        requestId: '30',
        root: '/data/repo-barrier',
        queueState: 'running',
        runId: runId ?? 'missing-run-id',
        nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
      });
    },
    markQueueRequestTerminalPublished: async () => {
      events.push('terminal-marker-failed');
      throw new Error('terminal marker write failed');
    },
    promoteOldestWaitingQueueRequest: async () => null,
  });

  await __persistQueueTerminalBarrierForTest('run-barrier-written');
  const cleaned = await __finalizeQueueRequestForRunForTest(
    'run-barrier-written',
  );

  assert.equal(cleaned, true);
  assert.deepEqual(events, [
    'barrier:run-barrier-written:queue-barrier-written',
    'terminal-marker-failed',
    'deleted:queue-barrier-written',
  ]);
});
