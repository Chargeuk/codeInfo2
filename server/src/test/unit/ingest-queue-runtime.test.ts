import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import {
  __finalizeQueueRequestForRunForTest,
  __getQueueRequestTerminalStatusCountForTest,
  __resetIngestJobsForTest,
  __setQueueRequestTerminalStatusTtlForTest,
  __setQueueRuntimeOpsForTest,
  __setQueueRequestIdForRunForTest,
  __setRunProcessorForTest,
  __setRunSchedulerForTest,
  __setStatusAndPublishForTest,
  __setStatusForTest,
  getStatus,
  pumpIngestQueue,
  recoverIngestQueueOnStartup,
  setIngestDeps,
  validateExecutableIngestInput,
} from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import * as requestQueue from '../../ingest/requestQueue.js';

function waitForNextTurn() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function createQueueRequest(params: {
  requestId: string;
  root: string;
  queueState: 'waiting' | 'running' | 'cleanup-blocked';
  runId?: string | null;
}) {
  return {
    _id: new mongoose.Types.ObjectId(params.requestId.padStart(24, '0')),
    canonicalTargetPath: params.root,
    operation: 'reembed' as const,
    queueState: params.queueState,
    requestPayload: {
      path: params.root,
      name: params.root.split('/').filter(Boolean).at(-1) ?? 'repo',
      model: 'embed-1',
      operation: 'reembed',
    },
    sourceSurface: 'test',
    runId: params.runId ?? null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
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

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  __resetIngestJobsForTest();
  release();
  __setRunSchedulerForTest((task) => {
    task();
  });
  setIngestDeps({
    lmClientFactory: () => ({}) as never,
    baseUrl: 'ws://host.docker.internal:1234',
  });
});

afterEach(() => {
  setNoopQueueRuntimeOps();
  __setRunSchedulerForTest(null);
  __setRunProcessorForTest(null);
  __resetIngestJobsForTest();
  release();
});

test('queue pump immediately promotes the oldest eligible queue item when the ingest lock is idle', async () => {
  const promoted = createQueueRequest({
    requestId: '1',
    root: '/data/repo-one',
    queueState: 'running',
    runId: 'pump-run-1',
  });
  let capturedRunId = '';
  let capturedPath = '';

  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () => null,
    promoteOldestWaitingQueueRequest: async (runId: string) => {
      capturedRunId = runId;
      return { ...promoted, runId };
    },
  });
  __setRunProcessorForTest(async (runId, input) => {
    capturedRunId = runId;
    capturedPath = input.path;
    release(runId);
  });

  const result = await pumpIngestQueue();
  await waitForNextTurn();

  assert.equal(result.started, true);
  assert.equal(result.blockedByCleanup, false);
  assert.equal(result.requestId, requestQueue.getQueueRequestId(promoted));
  assert.equal(capturedPath, '/data/repo-one');
  assert.equal(getStatus(capturedRunId)?.state, 'queued');
});

test('queue pump preserves FIFO waiting order by not starting the next item while the first run still owns the lock', async () => {
  const queueRequests = [
    createQueueRequest({
      requestId: '2',
      root: '/data/repo-first',
      queueState: 'running',
    }),
    createQueueRequest({
      requestId: '3',
      root: '/data/repo-second',
      queueState: 'running',
    }),
  ];
  const startedRoots: string[] = [];
  let releaseFirstRun: (() => void) | null = null;

  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () => null,
    promoteOldestWaitingQueueRequest: async (runId: string) => {
      const next = queueRequests.shift();
      return next ? { ...next, runId } : null;
    },
  });
  __setRunProcessorForTest(async (runId, input) => {
    startedRoots.push(input.path);
    if (input.path === '/data/repo-first') {
      await new Promise<void>((resolve) => {
        releaseFirstRun = () => {
          release(runId);
          resolve();
        };
      });
      return;
    }
    release(runId);
  });

  const first = await pumpIngestQueue();
  await waitForNextTurn();
  const secondWhileLocked = await pumpIngestQueue();

  assert.equal(first.started, true);
  assert.equal(secondWhileLocked.started, false);
  assert.deepEqual(startedRoots, ['/data/repo-first']);

  if (!releaseFirstRun) {
    throw new Error('expected first run release hook to be captured');
  }
  (releaseFirstRun as () => void)();
  await waitForNextTurn();
  const secondAfterRelease = await pumpIngestQueue();
  await waitForNextTurn();

  assert.equal(secondAfterRelease.started, true);
  assert.deepEqual(startedRoots, ['/data/repo-first', '/data/repo-second']);
});

test('queue pump creates the real runId only when queued work actually starts', async () => {
  const promoted = createQueueRequest({
    requestId: '4',
    root: '/data/repo-runid',
    queueState: 'running',
  });
  let promotedRunId = '';

  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () => null,
    promoteOldestWaitingQueueRequest: async (runId: string) => {
      promotedRunId = runId;
      return { ...promoted, runId };
    },
  });
  __setRunProcessorForTest(async () => {});

  const result = await pumpIngestQueue();

  assert.equal(result.started, true);
  assert.ok(promotedRunId.length > 0);
  assert.equal(getStatus(promotedRunId)?.runId, promotedRunId);
});

test('queue-managed execution revalidates the collection lock before starting a promoted request', async () => {
  await assert.rejects(
    () =>
      validateExecutableIngestInput(
        {
          model: 'embed-1',
          embeddingProvider: 'lmstudio',
          embeddingModel: 'embed-1',
        },
        {
          getLockedEmbeddingModel: async () => ({
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-2',
            embeddingDimensions: 768,
            lockedModelId: 'embed-2',
            source: 'canonical',
          }),
        },
      ),
    (error) => {
      assert.equal((error as { code?: string }).code, 'MODEL_LOCKED');
      return true;
    },
  );
});

test('queue-managed execution rejects non-allowlisted OpenAI models before promotion can run', async () => {
  await assert.rejects(
    () =>
      validateExecutableIngestInput(
        {
          model: 'openai/text-embedding-ada-002',
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-ada-002',
        },
        {
          getLockedEmbeddingModel: async () => null,
        },
      ),
    (error) => {
      assert.equal(
        (error as { code?: string }).code,
        'OPENAI_MODEL_UNAVAILABLE',
      );
      return true;
    },
  );
});

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

test('terminal queue request cache evicts completed entries after the retention window', async () => {
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
  await new Promise((resolve) => globalThis.setTimeout(resolve, 20));
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

test('startup recovery retries leftover running work before newer waiting work', async () => {
  const events: string[] = [];
  const runningQueueRequest = createQueueRequest({
    requestId: '11',
    root: '/data/repo-running',
    queueState: 'running',
    runId: 'run-recovered',
  });

  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () => null,
    findOldestRunningQueueRequest: async () => {
      events.push('running-selected');
      return runningQueueRequest;
    },
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
  assert.deepEqual(events, [
    'running-selected',
    'started:run-recovered:/data/repo-running',
  ]);
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
