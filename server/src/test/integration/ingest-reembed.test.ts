import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __finalizeQueueRequestForRunForTest,
  __resetIngestJobsForTest,
  __setQueueRequestIdForRunForTest,
  __setQueueRuntimeOpsForTest,
  __setRunProcessorForTest,
  __setStatusForTest,
  getActiveStatus,
  pumpIngestQueue,
  recoverIngestQueueOnStartup,
  setIngestDeps,
} from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';

function waitForNextTurn() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function setNoopQueueRuntimeOps() {
  __setQueueRuntimeOpsForTest({
    deleteQueueRequestById: async () => null,
    ensureQueueRequestRunId: async () => null,
    findOldestCleanupBlockedQueueRequest: async () => null,
    findOldestRunningQueueRequest: async () => null,
    getQueueRequestId: () => 'noop',
    markQueueRequestCleanupBlocked: async () => null,
    promoteOldestWaitingQueueRequest: async () => null,
  });
}

test.beforeEach(() => {
  process.env.NODE_ENV = 'test';
  __resetIngestJobsForTest();
  release();
  setIngestDeps({
    lmClientFactory: () => ({}) as never,
    baseUrl: 'ws://host.docker.internal:1234',
  });
});

test.afterEach(() => {
  setNoopQueueRuntimeOps();
  __setRunProcessorForTest(null);
  __resetIngestJobsForTest();
  release();
});

test('startup recovery does not replay committed-before-cleanup running work', async () => {
  const events: string[] = [];

  __setQueueRuntimeOpsForTest({
    deleteQueueRequestById: async () =>
      ({
        _id: { toString: () => 'queue-running' },
        canonicalTargetPath: '/data/repo-running',
        operation: 'reembed',
        queueState: 'running',
        requestPayload: {
          path: '/data/repo-running',
          name: 'repo-running',
          model: 'embed-1',
        },
        runId: 'run-recovered',
        terminalPublishedAt: new Date('2026-01-01T00:00:05.000Z'),
      }) as never,
    findOldestCleanupBlockedQueueRequest: async () => null,
    findOldestRunningQueueRequest: async () =>
      ({
        _id: { toString: () => 'queue-running' },
        canonicalTargetPath: '/data/repo-running',
        operation: 'reembed',
        queueState: 'running',
        requestPayload: {
          path: '/data/repo-running',
          name: 'repo-running',
          model: 'embed-1',
        },
        runId: 'run-recovered',
        terminalPublishedAt: new Date('2026-01-01T00:00:05.000Z'),
      }) as never,
    promoteOldestWaitingQueueRequest: async () => {
      events.push('waiting-promoted');
      return null;
    },
  });
  __setRunProcessorForTest(async (runId, input) => {
    events.push(`started:${runId}:${input.path}`);
    release(runId);
  });

  const result = await recoverIngestQueueOnStartup();
  await waitForNextTurn();

  assert.equal(result.recovered, true);
  assert.deepEqual(events, []);
});

test('startup recovery still retries leftover running work before newer waiting work', async () => {
  const events: string[] = [];
  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () => null,
    findOldestRunningQueueRequest: async () =>
      ({
        _id: { toString: () => 'queue-running' },
        canonicalTargetPath: '/data/repo-running',
        operation: 'reembed',
        queueState: 'running',
        requestPayload: {
          path: '/data/repo-running',
          name: 'repo-running',
          model: 'embed-1',
        },
        runId: 'run-recovered',
      }) as never,
    promoteOldestWaitingQueueRequest: async () => {
      events.push('waiting-promoted');
      return null;
    },
  });
  __setRunProcessorForTest(async (runId, input) => {
    events.push(`started:${runId}:${input.path}`);
    release(runId);
  });

  const result = await recoverIngestQueueOnStartup();
  await waitForNextTurn();

  assert.equal(result.recovered, true);
  assert.deepEqual(events, ['started:run-recovered:/data/repo-running']);
});

test('cleanup boundary exposes a deterministic next-item-not-started state before queue advancement', async () => {
  const deleteGate = (() => {
    let resolve!: () => void;
    const promise = new Promise<void>((nextResolve) => {
      resolve = nextResolve;
    });
    return { promise, resolve };
  })();
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
      events.push('delete-start');
      await deleteGate.promise;
      events.push('delete-complete');
      return {
        _id: { toString: () => 'queue-finished' },
        canonicalTargetPath: '/data/repo-finished',
        operation: 'reembed',
        queueState: 'running',
        requestPayload: { path: '/data/repo-finished', model: 'embed-1' },
        runId: 'run-finished',
      } as never;
    },
    findOldestCleanupBlockedQueueRequest: async () => null,
    promoteOldestWaitingQueueRequest: async (runId: string) =>
      ({
        _id: { toString: () => 'queue-next' },
        canonicalTargetPath: '/data/repo-next',
        operation: 'reembed',
        queueState: 'running',
        requestPayload: {
          path: '/data/repo-next',
          name: 'repo-next',
          model: 'embed-1',
        },
        runId,
      }) as never,
  });
  __setRunProcessorForTest(async (runId, input) => {
    events.push(`start:${input.path}`);
    release(runId);
  });

  const finalizePromise = __finalizeQueueRequestForRunForTest('run-finished');
  await waitForNextTurn();

  assert.deepEqual(events, ['delete-start']);
  assert.equal(getActiveStatus(), null);

  const stalledWhileCleanupPending = await pumpIngestQueue();
  assert.equal(stalledWhileCleanupPending.started, false);
  assert.equal(stalledWhileCleanupPending.blockedByCleanup, true);

  deleteGate.resolve();
  await finalizePromise;
  for (let attempt = 0; attempt < 10 && events.length < 3; attempt += 1) {
    await waitForNextTurn();
  }

  assert.deepEqual(events, [
    'delete-start',
    'delete-complete',
    'start:/data/repo-next',
  ]);
});
