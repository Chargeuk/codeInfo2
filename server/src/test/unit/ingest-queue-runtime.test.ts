import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { mock } from 'node:test';
import { ChromaClient } from 'chromadb';
import mongoose from 'mongoose';
import {
  getLockedEmbeddingModel,
  resetCollectionsForTests,
} from '../../ingest/chromaClient.js';
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
  waitForTerminalIngestStatus,
} from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import * as requestQueue from '../../ingest/requestQueue.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';

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

async function createTempRepo(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-queue-'));
  await fs.mkdir(path.join(root, '.git'));
  await Promise.all(
    Object.entries(files).map(async ([relPath, contents]) => {
      const fullPath = path.join(root, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, contents, 'utf8');
    }),
  );
  process.env.CODEINFO_INGEST_TEST_GIT_PATHS = Object.keys(files).join(',');
  return {
    root,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

function setupIngestChromaMocks() {
  const vectors = {
    metadata: {
      lockedModelId: 'embed-1' as string | null,
      embeddingProvider: null as string | null,
      embeddingModel: null as string | null,
      embeddingDimensions: null as number | null,
    },
    add: mock.fn(async () => {}),
    get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    delete: mock.fn(async () => {}),
    modify: async ({ metadata }: { metadata?: Record<string, unknown> }) => {
      vectors.metadata = {
        ...(vectors.metadata ?? {}),
        ...(metadata ?? {}),
      } as {
        lockedModelId: string | null;
        embeddingProvider: string | null;
        embeddingModel: string | null;
        embeddingDimensions: number | null;
      };
    },
    count: async () => 0,
  };
  const roots = {
    get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    add: mock.fn(async () => {}),
    delete: mock.fn(async () => {}),
  };

  mock.method(
    ChromaClient.prototype,
    'getOrCreateCollection',
    async (opts: { name?: string }) => {
      if (opts.name === 'ingest_roots') return roots as never;
      return vectors as never;
    },
  );
  mock.method(ChromaClient.prototype, 'deleteCollection', async () => {});
  mock.method(IngestFileModel, 'find', () => ({
    select: () => ({
      lean: () => ({
        exec: async () => [],
      }),
    }),
  }));
  mock.method(
    IngestFileModel,
    'bulkWrite',
    mock.fn(async () => ({})),
  );
  mock.method(
    IngestFileModel,
    'deleteMany',
    mock.fn(() => ({ exec: async () => ({}) })),
  );
  (mongoose.connection as unknown as { readyState: number }).readyState = 0;
  process.env.NODE_ENV = 'test';
  return { vectors };
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
  mock.restoreAll();
  mock.reset();
  resetCollectionsForTests();
  process.env.NODE_ENV = 'test';
  __resetIngestJobsForTest();
  release();
  delete process.env.CODEINFO_INGEST_TEST_GIT_PATHS;
  __setRunSchedulerForTest((task) => {
    task();
  });
  setIngestDeps({
    lmClientFactory: () => ({}) as never,
    baseUrl: 'ws://host.docker.internal:1234',
  });
});

afterEach(() => {
  mock.restoreAll();
  mock.reset();
  resetCollectionsForTests();
  setNoopQueueRuntimeOps();
  __setRunSchedulerForTest(null);
  __setRunProcessorForTest(null);
  __resetIngestJobsForTest();
  release();
  delete process.env.CODEINFO_INGEST_TEST_GIT_PATHS;
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

test('queue promotion rejects queued zero-work reembed drift at execution time and releases queue ownership cleanly', async () => {
  const { vectors } = setupIngestChromaMocks();
  const { root, cleanup } = await createTempRepo({
    'src/blank.ts': '   \n\t\n',
  });
  const requestId = '5';
  const deletedRequestIds: string[] = [];

  try {
    const blankFileHash = 'blank-file-hash';
    mock.method(IngestFileModel, 'find', (query: { root?: string }) => ({
      select: () => ({
        lean: () => ({
          exec: async () =>
            query.root === root
              ? [{ relPath: 'src/blank.ts', fileHash: blankFileHash }]
              : [],
        }),
      }),
    }));
    await getLockedEmbeddingModel();
    vectors.metadata = {
      lockedModelId: 'embed-locked',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'embed-locked',
      embeddingDimensions: 768,
    };

    const promoted = createQueueRequest({
      requestId,
      root,
      queueState: 'running',
    });
    let promotedOnce = false;
    __setQueueRuntimeOpsForTest({
      deleteQueueRequestById: async (deletedRequestId: string) => {
        deletedRequestIds.push(deletedRequestId);
        return null;
      },
      findOldestCleanupBlockedQueueRequest: async () => null,
      promoteOldestWaitingQueueRequest: async (runId: string) => {
        if (promotedOnce) {
          return null;
        }
        promotedOnce = true;
        return {
          ...promoted,
          runId,
          requestPayload: {
            ...promoted.requestPayload,
            path: root,
            canonicalTargetPath: `${root}-queued`,
            model: 'embed-1',
            embeddingProvider: 'lmstudio',
            embeddingModel: 'embed-1',
            operation: 'reembed',
          },
        };
      },
    });

    const result = await pumpIngestQueue();
    assert.equal(result.started, true);
    assert.ok(result.runId);

    const terminal = await waitForTerminalIngestStatus(result.runId as string, {
      timeoutMs: 1_000,
      pollMs: 10,
    });

    assert.equal(terminal.reason, 'terminal');
    assert.equal(terminal.status?.state, 'error');
    assert.equal(terminal.status?.lastError, 'MODEL_LOCKED');
    assert.ok(
      deletedRequestIds.length >= 1,
      'promotion-time rejection should still finalize and release the queued request',
    );

    const afterTerminal = await pumpIngestQueue();
    assert.equal(afterTerminal.started, false);
    assert.equal(afterTerminal.blockedByCleanup, false);
    assert.equal(afterTerminal.runId, null);
  } finally {
    await cleanup();
  }
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

test('startup recovery replays queued reembed work using canonicalTargetPath for bookkeeping', async () => {
  const events: string[] = [];
  const canonicalRoot = '/data/canonical-running-root';
  const mountedPath = '/tmp/mounted-running-root';
  const recoveryQueueRequest = createQueueRequest({
    requestId: '12',
    root: canonicalRoot,
    queueState: 'running',
    runId: 'run-recovered-split',
  });
  recoveryQueueRequest.requestPayload.path = mountedPath;

  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () => null,
    findOldestRunningQueueRequest: async () => {
      events.push('running-selected');
      return recoveryQueueRequest;
    },
    promoteOldestWaitingQueueRequest: async () => {
      events.push('waiting-promoted');
      return null;
    },
  });
  __setRunProcessorForTest(async (runId, input) => {
    events.push(`started:${runId}:${input.path}`);
    events.push(`canonical:${input.canonicalTargetPath}`);
    release(runId);
  });

  const result = await recoverIngestQueueOnStartup();
  await waitForNextTurn();

  assert.equal(result.recovered, true);
  assert.deepEqual(events, [
    'running-selected',
    `started:run-recovered-split:${mountedPath}`,
    `canonical:${canonicalRoot}`,
  ]);
});

test('startup recovery fallback uses canonicalTargetPath when persisted requestPayload.path is missing', async () => {
  const events: string[] = [];
  const canonicalRoot = '/data/canonical-degraded-root';
  const recoveryQueueRequest = createQueueRequest({
    requestId: '13',
    root: canonicalRoot,
    queueState: 'running',
    runId: 'run-recovered-degraded',
  });
  delete (recoveryQueueRequest.requestPayload as { path?: string }).path;

  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () => null,
    findOldestRunningQueueRequest: async () => {
      events.push('running-selected');
      return recoveryQueueRequest;
    },
    promoteOldestWaitingQueueRequest: async () => {
      events.push('waiting-promoted');
      return null;
    },
  });
  __setRunProcessorForTest(async (runId, input) => {
    events.push(`started:${runId}:${input.path}`);
    events.push(`canonical:${input.canonicalTargetPath}`);
    release(runId);
  });

  const result = await recoverIngestQueueOnStartup();
  await waitForNextTurn();

  assert.equal(result.recovered, true);
  assert.deepEqual(events, [
    'running-selected',
    `started:run-recovered-degraded:${canonicalRoot}`,
    `canonical:${canonicalRoot}`,
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
