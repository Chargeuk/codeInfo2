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

function setupChromaMocks() {
  const vectors = {
    addCalls: [] as Array<{ ids: string[] }>,
    metadata: { lockedModelId: null as string | null },
    add: async (payload: { ids: string[] }) => {
      vectors.addCalls.push(payload);
    },
    get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    delete: async () => {},
    modify: async ({ metadata }: { metadata?: Record<string, unknown> }) => {
      vectors.metadata = {
        ...(vectors.metadata ?? {}),
        ...(metadata ?? {}),
      } as { lockedModelId: string | null };
    },
    count: async () => 0,
  };
  const roots = {
    addCalls: [] as Array<{
      ids: string[];
      metadatas: Record<string, unknown>[];
    }>,
    get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    add: async (payload: {
      ids: string[];
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
