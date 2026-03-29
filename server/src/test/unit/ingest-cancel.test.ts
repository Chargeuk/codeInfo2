import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import { ChromaClient } from 'chromadb';
import express from 'express';
import request from 'supertest';
import { resetCollectionsForTests } from '../../ingest/chromaClient.js';
import { createEmbeddingDispatcher } from '../../ingest/embeddingDispatcher.js';
import {
  __resetIngestJobsForTest,
  cancelRun,
  getStatus,
  startIngest,
} from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import { query, resetStore } from '../../logStore.js';
import { createIngestCancelRouter } from '../../routes/ingestCancel.js';

function buildApp(options?: {
  cancelRun?: (
    runId: string,
  ) => Promise<{ cleanupState: 'complete'; found: boolean }>;
  getStatus?: (runId: string) => { runId: string } | null;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestCancelRouter({
      cancelRun: options?.cancelRun as never,
      getStatus: (options?.getStatus ?? (() => ({ runId: 'run-1' }))) as never,
      isBusy: () => false,
    }),
  );
  return app;
}

test.beforeEach(() => {
  resetStore();
  __resetIngestJobsForTest();
  resetCollectionsForTests();
  release();
});

test.afterEach(() => {
  __resetIngestJobsForTest();
  resetCollectionsForTests();
  release();
  delete process.env.CODEINFO_INGEST_FLUSH_EVERY;
  delete process.env.CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT;
  delete process.env.CODEINFO_INGEST_MAX_QUEUE_SIZE;
  delete process.env.CODEINFO_INGEST_TEST_GIT_PATHS;
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function createTempRepo(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-cancel-'));
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

async function waitForTerminal(runId: string) {
  const terminal = new Set(['completed', 'skipped', 'cancelled', 'error']);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = getStatus(runId);
    if (status && terminal.has(status.state)) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for terminal status for ${runId}`);
}

async function waitForStatus(
  runId: string,
  predicate: (status: ReturnType<typeof getStatus>) => boolean,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = getStatus(runId);
    if (predicate(status)) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for matching status for ${runId}`);
}

async function waitForCondition(
  label: string,
  predicate: () => boolean,
  timeoutMs = 2_000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function setupChromaMocks() {
  const storedVectors = new Map<string, Record<string, unknown>>();
  const extractWhereValue = (
    where: Record<string, unknown> | undefined,
    key: string,
  ): unknown => {
    if (!where) return undefined;
    if (key in where) {
      return where[key];
    }
    const andConditions = Array.isArray(where.$and)
      ? (where.$and as Record<string, unknown>[])
      : [];
    for (const condition of andConditions) {
      if (key in condition) {
        return condition[key];
      }
    }
    return undefined;
  };
  const vectors = {
    addCalls: [] as Array<{ ids: string[] }>,
    deleteCalls: [] as Array<{ where?: Record<string, unknown> }>,
    metadata: { lockedModelId: null as string | null },
    add: async (payload: {
      ids: string[];
      metadatas?: Record<string, unknown>[];
    }) => {
      vectors.addCalls.push(payload);
      for (const [index, id] of payload.ids.entries()) {
        storedVectors.set(id, payload.metadatas?.[index] ?? {});
      }
    },
    get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    delete: async (payload?: { where?: Record<string, unknown> }) => {
      vectors.deleteCalls.push(payload ?? {});
      const runId = extractWhereValue(payload?.where, 'runId');
      const root = extractWhereValue(payload?.where, 'root');
      const relPath = extractWhereValue(payload?.where, 'relPath');
      for (const [id, metadata] of storedVectors.entries()) {
        if (
          (runId === undefined || metadata.runId === runId) &&
          (root === undefined || metadata.root === root) &&
          (relPath === undefined || metadata.relPath === relPath)
        ) {
          storedVectors.delete(id);
        }
      }
    },
    modify: async ({ metadata }: { metadata?: Record<string, unknown> }) => {
      vectors.metadata = {
        ...(vectors.metadata ?? {}),
        ...(metadata ?? {}),
      } as { lockedModelId: string | null };
    },
    count: async () => storedVectors.size,
    storedVectors,
  };
  const roots = {
    addCalls: [] as Array<{
      ids: string[];
      embeddings: number[][];
      metadatas: Record<string, unknown>[];
    }>,
    dimension: 3,
    get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    add: async (payload: {
      ids: string[];
      embeddings: number[][];
      metadatas: Record<string, unknown>[];
    }) => {
      roots.addCalls.push(payload);
    },
    delete: async () => {},
  };

  test.mock.method(
    ChromaClient.prototype,
    'getOrCreateCollection',
    async (opts: { name?: string }) => {
      if (opts.name === 'ingest_roots') return roots as never;
      return vectors as never;
    },
  );
  test.mock.method(ChromaClient.prototype, 'deleteCollection', async () => {});

  return { vectors, roots };
}

function buildDeps(options: {
  onEmbedStart?: (text: string) => void;
  embedPromiseFactory: (
    text: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ embedding: number[] }>;
}) {
  let embedCalls = 0;
  return {
    baseUrl: 'http://lmstudio.local',
    lmClientFactory: () =>
      ({
        embedding: {
          model: async () => ({
            embed: async (
              text: string,
              requestOptions?: { signal?: AbortSignal },
            ) => {
              embedCalls += 1;
              options.onEmbedStart?.(text);
              return options.embedPromiseFactory(text, requestOptions);
            },
            getContextLength: async () => 256,
            countTokens: async (text: string) =>
              text.split(/\s+/).filter(Boolean).length,
          }),
        },
      }) as unknown as LMStudioClient,
    getEmbedCalls: () => embedCalls,
  };
}

test('ingest-cancel catch path logs retryable failures as warn', async () => {
  const response = await request(
    buildApp({
      cancelRun: async () => {
        const error = new Error('temporary unavailable');
        (error as { code?: string }).code = 'BUSY';
        throw error;
      },
    }),
  ).post('/ingest/cancel/run-1');

  assert.equal(response.status, 429);
  assert.equal(response.body.code, 'BUSY');

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const warnEntry = entries.find(
    (entry) =>
      entry.level === 'warn' &&
      entry.context?.surface === 'ingest/cancel' &&
      entry.context?.code === 'BUSY',
  );
  assert.ok(warnEntry, 'expected warn-level cancel failure log');
  assert.equal(warnEntry?.context?.retryable, true);
});

test('ingest-cancel catch path logs non-retryable failures as error', async () => {
  const response = await request(
    buildApp({
      cancelRun: async () => {
        const error = new Error('lock metadata invalid');
        (error as { code?: string }).code = 'INVALID_LOCK_METADATA';
        throw error;
      },
    }),
  ).post('/ingest/cancel/run-2');

  assert.equal(response.status, 500);
  assert.equal(response.body.code, 'INVALID_LOCK_METADATA');

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const errorEntry = entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.context?.surface === 'ingest/cancel' &&
      entry.context?.code === 'INVALID_LOCK_METADATA',
  );
  assert.ok(errorEntry, 'expected error-level cancel failure log');
  assert.equal(errorEntry?.context?.retryable, false);
});

test('cancel stops new embedding work immediately once dispatch has started', async () => {
  const { vectors } = setupChromaMocks();
  process.env.CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT = '1';
  process.env.CODEINFO_INGEST_MAX_QUEUE_SIZE = '0';
  const firstEmbedding = createDeferred<{ embedding: number[] }>();
  const embedStarted = createDeferred<void>();
  const deps = buildDeps({
    onEmbedStart: () => {
      embedStarted.resolve();
    },
    embedPromiseFactory: async () => firstEmbedding.promise,
  });
  const { root, cleanup } = await createTempRepo({
    'a.txt': 'alpha beta gamma',
    'b.txt': 'delta epsilon zeta',
    'c.txt': 'eta theta iota',
  });

  try {
    const runId = await startIngest(
      {
        path: root,
        name: 'cancel-stop-dispatch',
        model: 'embed-1',
      },
      deps,
    );

    await embedStarted.promise;
    await cancelRun(runId);
    firstEmbedding.resolve({ embedding: [0.1, 0.2, 0.3] });
    const finalStatus = await waitForTerminal(runId);

    assert.equal(finalStatus?.state, 'cancelled');
    assert.equal(
      deps.getEmbedCalls(),
      1,
      'cancel should stop any new dispatch after the first request',
    );
    assert.equal(
      vectors.addCalls.length,
      0,
      'cancelled run should not persist embeddings after cleanup',
    );
  } finally {
    await cleanup();
  }
});

test('cancel after production completes still reaches cancelled cleanup with queued work', async () => {
  const { vectors } = setupChromaMocks();
  process.env.CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT = '1';
  process.env.CODEINFO_INGEST_MAX_QUEUE_SIZE = '-1';
  const firstEmbedding = createDeferred<{ embedding: number[] }>();
  const embedStarted = createDeferred<void>();
  const deps = buildDeps({
    onEmbedStart: () => {
      embedStarted.resolve();
    },
    embedPromiseFactory: async () => firstEmbedding.promise,
  });
  const { root, cleanup } = await createTempRepo({
    'a.txt': 'alpha beta gamma',
    'b.txt': 'delta epsilon zeta',
  });

  try {
    const runId = await startIngest(
      {
        path: root,
        name: 'cancel-post-production-deadlock',
        model: 'embed-1',
      },
      deps,
    );

    await embedStarted.promise;
    await waitForStatus(
      runId,
      (status) =>
        (status?.counts.chunks ?? 0) >= 2 && status?.state === 'embedding',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    await cancelRun(runId);
    firstEmbedding.resolve({ embedding: [0.1, 0.2, 0.3] });
    const finalStatus = await waitForTerminal(runId);

    assert.equal(finalStatus?.state, 'cancelled');
    assert.equal(
      deps.getEmbedCalls(),
      1,
      'cancel should not dispatch queued work after production completed',
    );
    assert.equal(
      vectors.addCalls.length,
      0,
      'cancelled run should not persist embeddings after queued work is dropped',
    );
  } finally {
    await cleanup();
  }
});

test('cancel after provider result resolution does not leave vectors behind', async () => {
  const { vectors } = setupChromaMocks();
  process.env.CODEINFO_INGEST_FLUSH_EVERY = '1';
  process.env.CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT = '1';
  process.env.CODEINFO_INGEST_MAX_QUEUE_SIZE = '-1';
  const persistStarted = createDeferred<void>();
  const releasePersist = createDeferred<void>();
  const originalAdd = vectors.add;
  vectors.add = async (payload) => {
    persistStarted.resolve();
    await releasePersist.promise;
    await originalAdd(payload);
  };

  const deps = buildDeps({
    embedPromiseFactory: async () => ({ embedding: [0.1, 0.2, 0.3] }),
  });
  const { root, cleanup } = await createTempRepo({
    'a.txt': 'alpha beta gamma',
  });

  try {
    const runId = await startIngest(
      {
        path: root,
        name: 'cancel-after-result-before-persist',
        model: 'embed-1',
      },
      deps,
    );

    await persistStarted.promise;
    const cancelPromise = cancelRun(runId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      vectors.storedVectors.size,
      0,
      'persist should still be blocked when cancel cleanup starts',
    );

    releasePersist.resolve();
    await cancelPromise;
    const finalStatus = await waitForTerminal(runId);
    await waitForCondition('cancelled vector cleanup', () => {
      return vectors.storedVectors.size === 0;
    });

    assert.equal(finalStatus?.state, 'cancelled');
    assert.equal(
      vectors.storedVectors.size,
      0,
      'cancelled run should not retain vectors written during the fenced persist window',
    );
    assert.ok(
      vectors.deleteCalls.some((call) => {
        const where = call.where ?? {};
        return (
          where.runId === runId ||
          (
            (where.$and as Array<Record<string, unknown>> | undefined) ?? []
          ).some((condition) => condition.runId === runId)
        );
      }),
      'expected cancel cleanup to delete vectors for the cancelled run',
    );
  } finally {
    await cleanup();
  }
});

test('cancel reuses the roots collection dimension when rows were removed first', async () => {
  const { roots } = setupChromaMocks();
  process.env.CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT = '1';
  process.env.CODEINFO_INGEST_MAX_QUEUE_SIZE = '0';
  const firstEmbedding = createDeferred<{ embedding: number[] }>();
  const embedStarted = createDeferred<void>();
  let rootsCleared = false;
  roots.dimension = 2560;
  roots.get = async () => ({
    embeddings: rootsCleared ? [] : [[0.1, 0.2, 0.3]],
  });
  roots.delete = async () => {
    rootsCleared = true;
  };

  const deps = buildDeps({
    onEmbedStart: () => {
      embedStarted.resolve();
    },
    embedPromiseFactory: async () => firstEmbedding.promise,
  });
  const { root, cleanup } = await createTempRepo({
    'large.md': '# heading\n\n' + 'alpha beta gamma '.repeat(5000),
  });

  try {
    const runId = await startIngest(
      {
        path: root,
        name: 'cancel-roots-dimension',
        model: 'embed-1',
      },
      deps,
    );

    await embedStarted.promise;
    await cancelRun(runId);
    firstEmbedding.resolve({ embedding: [0.1, 0.2, 0.3] });
    const finalStatus = await waitForTerminal(runId);

    assert.equal(finalStatus?.state, 'cancelled');
    assert.equal(roots.addCalls.length, 1);
    assert.equal(roots.addCalls[0]?.embeddings[0]?.length, 2560);
    assert.equal(roots.addCalls[0]?.metadatas[0]?.embeddingDimensions, 2560);
  } finally {
    await cleanup();
  }
});

test('late provider results are ignored after cancel instead of being written', async () => {
  const resultDeferred = createDeferred<number[][]>();
  let cancelled = false;
  const persisted: string[] = [];
  let lateResultIgnored = false;
  const dispatcher = createEmbeddingDispatcher({
    model: {
      modelKey: 'cancel-proof',
      effectiveBatchSize: 1,
      supportsAbort: false,
      async embedText() {
        return [0.1];
      },
      async embedBatch() {
        return resultDeferred.promise;
      },
      async countTokens(text: string) {
        return text.split(/\s+/).filter(Boolean).length;
      },
      async getContextLength() {
        return 64;
      },
    },
    effectiveBatchSize: 1,
    maxInFlight: 1,
    maxQueueSize: 1,
    isCancelled: () => cancelled,
    onDispatch: () => {},
    onCompleted: async (results) => {
      persisted.push(...results.map((result) => result.text));
    },
    onLateResultIgnored: () => {
      lateResultIgnored = true;
    },
  });

  await dispatcher.enqueue({
    sequence: 0,
    text: 'alpha beta gamma',
    meta: null,
  });
  dispatcher.completeProduction();
  await new Promise((resolve) => setTimeout(resolve, 0));

  cancelled = true;
  dispatcher.cancel();
  resultDeferred.resolve([[0.4, 0.5, 0.6]]);
  await dispatcher.waitForIdle();

  assert.deepEqual(
    persisted,
    [],
    'late result should be ignored instead of written after cancel',
  );
  assert.equal(lateResultIgnored, true);
});
