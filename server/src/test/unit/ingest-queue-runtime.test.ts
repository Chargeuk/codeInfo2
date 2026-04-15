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
  __persistQueueTerminalBarrierForTest,
  __resetIngestJobsForTest,
  __setQueueRequestTerminalStatusNowForTest,
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
import {
  __resetIngestQueueAvailabilityForTest,
  getIngestQueueAvailability,
} from '../../ingest/requestQueue.js';
import * as requestQueue from '../../ingest/requestQueue.js';
import { query, resetStore } from '../../logStore.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import {
  INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_EVENT,
  INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE,
  recoverIngestQueueForStartup,
} from '../../startup/ingestQueueStartup.js';

const ORIGINAL_CODEINFO_CODEX_WORKDIR = process.env.CODEINFO_CODEX_WORKDIR;

function waitForNextTurn() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function createQueueRequest(params: {
  requestId: string;
  root: string;
  operation?: 'start' | 'reembed';
  queueState: 'waiting' | 'running' | 'cleanup-blocked';
  runId?: string | null;
  nonReplayableAt?: Date | null;
  terminalPublishedAt?: Date | null;
}) {
  const operation = params.operation ?? 'reembed';
  return {
    _id: new mongoose.Types.ObjectId(params.requestId.padStart(24, '0')),
    canonicalTargetPath: params.root,
    operation,
    queueState: params.queueState,
    requestPayload: {
      path: params.root,
      name: params.root.split('/').filter(Boolean).at(-1) ?? 'repo',
      model: 'embed-1',
      operation,
    } as Record<string, unknown>,
    sourceSurface: 'test',
    runId: params.runId ?? null,
    nonReplayableAt: params.nonReplayableAt ?? null,
    terminalPublishedAt: params.terminalPublishedAt ?? null,
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

function setupIngestChromaMocks(options?: {
  rootIds?: string[];
  rootMetadatas?: Record<string, unknown>[];
}) {
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
    get: async (opts?: { include?: string[] }) => {
      const include = opts?.include ?? [];
      const result: {
        embeddings?: number[][];
        ids?: string[];
        metadatas?: Record<string, unknown>[];
      } = {};
      if (include.includes('embeddings')) {
        result.embeddings = [[0.1, 0.2, 0.3]];
      }
      if (include.includes('metadatas')) {
        result.ids = options?.rootIds ?? [];
        result.metadatas = options?.rootMetadatas ?? [];
      }
      return result;
    },
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
    markQueueRequestNonReplayable: async () => null,
    markQueueRequestTerminalPublished: async () => null,
    promoteOldestWaitingQueueRequest: async () => null,
  });
}

beforeEach(() => {
  mock.restoreAll();
  mock.reset();
  resetCollectionsForTests();
  resetStore();
  process.env.NODE_ENV = 'test';
  __resetIngestJobsForTest();
  __resetIngestQueueAvailabilityForTest();
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
  resetStore();
  setNoopQueueRuntimeOps();
  __setRunSchedulerForTest(null);
  __setRunProcessorForTest(null);
  __resetIngestJobsForTest();
  __resetIngestQueueAvailabilityForTest();
  release();
  delete process.env.CODEINFO_INGEST_TEST_GIT_PATHS;
  if (ORIGINAL_CODEINFO_CODEX_WORKDIR === undefined) {
    delete process.env.CODEINFO_CODEX_WORKDIR;
  } else {
    process.env.CODEINFO_CODEX_WORKDIR = ORIGINAL_CODEINFO_CODEX_WORKDIR;
  }
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
      markQueueRequestNonReplayable: async () => null,
      markQueueRequestTerminalPublished: async () => null,
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
    await waitForNextTurn();
    await waitForNextTurn();

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

test('queue promotion rejects bogus canonical provider even when a legacy model is also present and releases queue ownership cleanly', async () => {
  setupIngestChromaMocks();
  const { root, cleanup } = await createTempRepo({
    'src/index.ts': 'export const value = 1;\n',
  });
  const requestId = '6';
  const deletedRequestIds: string[] = [];

  try {
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
      markQueueRequestNonReplayable: async () => null,
      markQueueRequestTerminalPublished: async () => null,
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
            canonicalTargetPath: root,
            operation: 'reembed',
            model: 'embed-1',
            embeddingProvider: 'bogus',
            embeddingModel: 'embed-1',
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
    await waitForNextTurn();
    await waitForNextTurn();

    assert.equal(terminal.reason, 'terminal');
    assert.equal(terminal.status?.state, 'error');
    assert.equal(
      terminal.status?.lastError,
      'embeddingProvider and embeddingModel are required when canonical fields are present',
    );
    assert.equal(terminal.status?.error?.error, 'VALIDATION');
    assert.ok(
      deletedRequestIds.length >= 1,
      'invalid canonical provider payloads should still finalize and release the queued request',
    );
    await waitForNextTurn();
    await waitForNextTurn();

    const afterTerminal = await pumpIngestQueue();
    assert.equal(afterTerminal.started, false);
    assert.equal(afterTerminal.blockedByCleanup, false);
    assert.equal(afterTerminal.runId, null);
  } finally {
    await cleanup();
  }
});

test('queue-managed deferred reembed rejects cancelled root drift before delta work begins', async () => {
  const { root, cleanup } = await createTempRepo({
    'src/deferred-cancelled.ts': 'export const deferredCancelled = true;\n',
  });
  setupIngestChromaMocks({
    rootIds: ['root-deferred-cancelled'],
    rootMetadatas: [
      {
        root,
        state: 'cancelled',
        lastIngestAt: '2026-01-02T00:00:00.000Z',
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

  try {
    mock.method(IngestFileModel, 'find', listRootCalls);

    __setQueueRuntimeOpsForTest({
      deleteQueueRequestById: async (requestId: string) => {
        deletedRequestIds.push(requestId);
        return null;
      },
      findOldestCleanupBlockedQueueRequest: async () => null,
      markQueueRequestNonReplayable: async () => null,
      markQueueRequestTerminalPublished: async () => null,
      promoteOldestWaitingQueueRequest: async (runId: string) => ({
        ...createQueueRequest({
          requestId: '21',
          root,
          queueState: 'running',
          runId,
        }),
        runId,
      }),
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
    assert.equal(listRootCalls.mock.calls.length, 0);
    assert.ok(deletedRequestIds.length >= 1);
    assert.equal(
      deletedRequestIds.every((requestId) => requestId === '000000000000000000000021'),
      true,
    );
  } finally {
    await cleanup();
  }
});

test('queue-managed deferred reembed uses canonicalTargetPath as the executable root before discovery begins', async () => {
  const events: string[] = [];
  const canonicalRoot = '/allowed/workdir/reembed-canonical';

  process.env.CODEINFO_CODEX_WORKDIR = '/allowed/workdir';
  __setQueueRuntimeOpsForTest({
    findOldestCleanupBlockedQueueRequest: async () => null,
    markQueueRequestNonReplayable: async () => null,
    markQueueRequestTerminalPublished: async () => null,
    promoteOldestWaitingQueueRequest: async (runId: string) => ({
      ...createQueueRequest({
        requestId: '23',
        root: canonicalRoot,
        queueState: 'running',
        runId,
      }),
      runId,
    }),
  });
  __setRunProcessorForTest(async (runId, input) => {
    events.push(`started:${runId}:${input.path}`);
    events.push(`canonical:${input.canonicalTargetPath}`);
    release(runId);
  });

  const started = await pumpIngestQueue();
  await waitForNextTurn();

  assert.equal(started.started, true);
  assert.ok(started.runId);
  assert.deepEqual(events, [
    `started:${started.runId}:${canonicalRoot}`,
    `canonical:${canonicalRoot}`,
  ]);
});

test('queue-managed deferred reembed rejects mismatched persisted requestPayload.path before discovery begins', async () => {
  process.env.CODEINFO_CODEX_WORKDIR = '/allowed/workdir';
  const canonicalRoot = '/allowed/workdir/reembed-canonical';
  const mismatchedPersistedPath = '/allowed/workdir/reembed-other';
  const deletedRequestIds: string[] = [];

  __setQueueRuntimeOpsForTest({
    deleteQueueRequestById: async (requestId: string) => {
      deletedRequestIds.push(requestId);
      return null;
    },
    findOldestCleanupBlockedQueueRequest: async () => null,
    markQueueRequestNonReplayable: async () => null,
    markQueueRequestTerminalPublished: async () => null,
    promoteOldestWaitingQueueRequest: async (runId: string) => ({
      ...createQueueRequest({
        requestId: '24',
        root: canonicalRoot,
        queueState: 'running',
        runId,
      }),
      runId,
      requestPayload: {
        path: mismatchedPersistedPath,
        name: 'repo',
        model: 'embed-1',
        operation: 'reembed',
      },
    }),
  });

  const started = await pumpIngestQueue();
  assert.equal(started.started, true);
  assert.ok(started.runId);

  const terminal = await waitForTerminalIngestStatus(started.runId!, {
    timeoutMs: 1_000,
    pollMs: 10,
  });
  await waitForNextTurn();
  await waitForNextTurn();

  assert.equal(terminal.reason, 'terminal');
  assert.equal(terminal.status?.state, 'error');
  assert.equal(
    terminal.status?.lastError,
    'queued reembed requestPayload.path must match canonicalTargetPath',
  );
  assert.ok(deletedRequestIds.length >= 1);
  assert.equal(
    deletedRequestIds.every(
      (requestId) => requestId === '000000000000000000000024',
    ),
    true,
  );
});

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
    __setQueueRuntimeOpsForTest({
      deleteQueueRequestById: async () => null,
      findOldestCleanupBlockedQueueRequest: async () => null,
      markQueueRequestNonReplayable: async () => null,
      markQueueRequestTerminalPublished: async () => null,
      promoteOldestWaitingQueueRequest: async (runId: string) => ({
        ...createQueueRequest({
          requestId: '22',
          root,
          queueState: 'running',
          runId,
        }),
        runId,
      }),
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

test('startup recovery skips replay for running rows whose durable replay barrier was already recorded before cleanup', async () => {
  const events: string[] = [];
  const deletedRequestIds: string[] = [];

  __setQueueRuntimeOpsForTest({
    deleteQueueRequestById: async (requestId: string) => {
      deletedRequestIds.push(requestId);
      events.push(`deleted:${requestId}`);
      return createQueueRequest({
        requestId: '11',
        root: '/data/repo-running',
        queueState: 'running',
        runId: 'run-recovered',
        nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
      });
    },
    findOldestCleanupBlockedQueueRequest: async () => null,
    findOldestRunningQueueRequest: async () =>
      createQueueRequest({
        requestId: '11',
        root: '/data/repo-running',
        queueState: 'running',
        runId: 'run-recovered',
        nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
      }),
    markQueueRequestNonReplayable: async () => null,
    markQueueRequestTerminalPublished: async () => null,
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
  await waitForNextTurn();

  assert.equal(result.recovered, true);
  assert.deepEqual(events, [
    'deleted:000000000000000000000011',
    'waiting-promoted',
  ]);
  assert.deepEqual(deletedRequestIds, ['000000000000000000000011']);
});

test('cleanup continuation still runs after the durable replay barrier is recorded', async () => {
  const events: string[] = [];
  __setStatusForTest('run-cleanup-after-barrier', {
    runId: 'run-cleanup-after-barrier',
    state: 'completed',
    counts: { files: 1, chunks: 1, embedded: 1 },
    message: 'Completed',
    lastError: null,
  });
  __setQueueRequestIdForRunForTest(
    'run-cleanup-after-barrier',
    'queue-cleanup-after-barrier',
  );

  __setQueueRuntimeOpsForTest({
    deleteQueueRequestById: async () => {
      events.push('cleanup-delete-attempted');
      throw new Error('delete failed');
    },
    findOldestCleanupBlockedQueueRequest: async () =>
      createQueueRequest({
        requestId: '31',
        root: '/data/repo-cleanup-after-barrier',
        queueState: 'cleanup-blocked',
        runId: 'run-cleanup-after-barrier',
        nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
      }),
    markQueueRequestCleanupBlocked: async () => {
      events.push('cleanup-blocked-persisted');
      return createQueueRequest({
        requestId: '31',
        root: '/data/repo-cleanup-after-barrier',
        queueState: 'cleanup-blocked',
        runId: 'run-cleanup-after-barrier',
        nonReplayableAt: new Date('2026-01-01T00:00:05.000Z'),
      });
    },
  });

  const cleaned = await __finalizeQueueRequestForRunForTest(
    'run-cleanup-after-barrier',
  );

  assert.equal(cleaned, false);
  assert.deepEqual(events, [
    'cleanup-delete-attempted',
    'cleanup-blocked-persisted',
  ]);
  assert.equal(getStatus('run-cleanup-after-barrier')?.state, 'cleanup-blocked');
});

test('startup recovery still retries genuinely unfinished running work before newer waiting work', async () => {
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

test('startup recovery replays queued reembed work using canonicalTargetPath as the executable root before discovery resumes', async () => {
  const events: string[] = [];
  const canonicalRoot = '/data/canonical-running-root';
  const recoveryQueueRequest = createQueueRequest({
    requestId: '12',
    root: canonicalRoot,
    queueState: 'running',
    runId: 'run-recovered-split',
  });

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
    `started:run-recovered-split:${canonicalRoot}`,
    `canonical:${canonicalRoot}`,
  ]);
});

test('startup recovery rejects mismatched persisted reembed paths before discovery resumes', async () => {
  process.env.CODEINFO_CODEX_WORKDIR = '/allowed/workdir';
  const canonicalRoot = '/allowed/workdir/recover-canonical-root';
  const mismatchedPersistedPath = '/allowed/workdir/recover-other-root';
  const deletedRequestIds: string[] = [];
  const recoveryQueueRequest = createQueueRequest({
    requestId: '13',
    root: canonicalRoot,
    queueState: 'running',
    runId: 'run-recovered-mismatched-path',
  });
  recoveryQueueRequest.requestPayload.path = mismatchedPersistedPath;

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
      'run-recovered-mismatched-path',
      {
        timeoutMs: 1_000,
        pollMs: 10,
      },
    );
    await waitForNextTurn();
    await waitForNextTurn();

    assert.equal(terminal.reason, 'terminal');
  assert.equal(terminal.status?.state, 'error');
  assert.equal(
    terminal.status?.lastError,
    'queued reembed requestPayload.path must match canonicalTargetPath',
  );
  assert.ok(deletedRequestIds.length >= 1);
  assert.equal(
    deletedRequestIds.every(
      (requestId) => requestId === '000000000000000000000013',
    ),
    true,
  );
});

test('startup recovery uses canonicalTargetPath as the executable root when persisted requestPayload.path is missing', async () => {
  const events: string[] = [];
  const canonicalRoot = '/data/canonical-degraded-root';
  const recoveryQueueRequest = createQueueRequest({
    requestId: '14',
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

test('startup recovery refuses out-of-scope persisted ingest-start paths before discovery begins', async () => {
  process.env.CODEINFO_CODEX_WORKDIR = '/allowed/workdir';
  const deletedRequestIds: string[] = [];
  let getOrCreateCollectionCalls = 0;
  const recoveryQueueRequest = createQueueRequest({
    requestId: '24',
    root: '/outside/repo',
    operation: 'start',
    queueState: 'running',
    runId: 'run-recovered-invalid-root',
  });

  mock.method(
    ChromaClient.prototype,
    'getOrCreateCollection',
    async () => {
      getOrCreateCollectionCalls += 1;
      return {
        get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
      } as never;
    },
  );

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
  await waitForNextTurn();
  await waitForNextTurn();

  assert.equal(terminal.reason, 'terminal');
  assert.equal(terminal.status?.state, 'error');
  assert.equal(
    terminal.status?.lastError,
    'path must stay within /allowed/workdir',
  );
  assert.equal(terminal.status?.error?.error, 'VALIDATION');
  assert.equal(getOrCreateCollectionCalls, 0);
  assert.deepEqual(deletedRequestIds, [
    requestQueue.getQueueRequestId(recoveryQueueRequest),
  ]);
});

test('startup recovery rejects blank canonical model even when a legacy model is also present and does not leave partial running state behind', async () => {
  setupIngestChromaMocks();
  const { root, cleanup } = await createTempRepo({
    'src/recover.ts': 'export const recover = true;\n',
  });
  const deletedRequestIds: string[] = [];
  const recoveryQueueRequest = createQueueRequest({
    requestId: '14',
    root,
    queueState: 'running',
    runId: 'run-recovered-invalid-payload',
  });
  recoveryQueueRequest.requestPayload = {
    ...recoveryQueueRequest.requestPayload,
    path: root,
    model: 'embed-1',
    embeddingProvider: 'lmstudio',
    embeddingModel: '',
    operation: 'reembed',
  };

  try {
    __setQueueRuntimeOpsForTest({
      deleteQueueRequestById: async (deletedRequestId: string) => {
        deletedRequestIds.push(deletedRequestId);
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
      'run-recovered-invalid-payload',
      {
        timeoutMs: 1_000,
        pollMs: 10,
      },
    );
    await waitForNextTurn();
    await waitForNextTurn();

    assert.equal(terminal.reason, 'terminal');
    assert.equal(terminal.status?.state, 'error');
    assert.equal(
      terminal.status?.lastError,
      'embeddingProvider and embeddingModel are required when canonical fields are present',
    );
    assert.equal(terminal.status?.error?.error, 'VALIDATION');
    assert.deepEqual(deletedRequestIds, [
      requestQueue.getQueueRequestId(recoveryQueueRequest),
    ]);
    await waitForNextTurn();
    await waitForNextTurn();

    const afterRecovery = await pumpIngestQueue();
    assert.equal(afterRecovery.started, false);
    assert.equal(afterRecovery.blockedByCleanup, false);
    assert.equal(afterRecovery.runId, null);
  } finally {
    await cleanup();
  }
});

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
