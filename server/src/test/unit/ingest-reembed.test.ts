import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach, mock } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import { ChromaClient } from 'chromadb';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import {
  __resetAstParserLogStateForTest,
  __setParseAstSourceForTest,
} from '../../ast/parser.js';
import {
  getLockedEmbeddingModel,
  resetCollectionsForTests,
} from '../../ingest/chromaClient.js';
import { hashFile } from '../../ingest/hashing.js';
import {
  __resetIngestJobsForTest,
  startIngest,
  waitForTerminalIngestStatus,
} from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import { normalizeCanonicalQueueTargetPath } from '../../ingest/requestContracts.js';
import {
  __resetIngestQueueAvailabilityForTest,
  enqueueOrReuseIngestRequest,
  markIngestQueueUnavailable,
} from '../../ingest/requestQueue.js';
import type {
  EnqueueIngestRequestInput,
  EnqueueIngestRequestResult,
} from '../../ingest/requestQueue.js';
import type { ListReposResult, RepoEntry } from '../../lmstudio/toolService.js';
import { query, resetStore } from '../../logStore.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
import { INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE } from '../../startup/ingestQueueStartup.js';

type PumpIngestQueueResult = Awaited<
  ReturnType<typeof import('../../ingest/ingestJob.js').pumpIngestQueue>
>;

function buildRepoEntry(): RepoEntry {
  return {
    id: 'repo',
    name: 'repo',
    description: null,
    containerPath: '/tmp/repo',
    hostPath: '/host/tmp/repo',
    lastIngestAt: '2025-01-01T00:00:00.000Z',
    embeddingProvider: 'lmstudio',
    embeddingModel: 'embed-model',
    embeddingDimensions: 768,
    model: 'embed-model',
    modelId: 'embed-model',
    lock: {
      embeddingProvider: 'lmstudio',
      embeddingModel: 'embed-model',
      embeddingDimensions: 768,
      lockedModelId: 'embed-model',
      modelId: 'embed-model',
    },
    counts: { files: 1, chunks: 1, embedded: 1 },
    lastError: null,
  };
}

function buildListReposResult(): ListReposResult {
  return {
    repos: [buildRepoEntry()],
    lockedModelId: 'embed-model',
  };
}

function buildQueueResult(
  overrides: Partial<EnqueueIngestRequestResult> = {},
): EnqueueIngestRequestResult {
  return {
    requestId: 'queue-request-123',
    canonicalTargetPath: '/tmp/repo',
    queueState: 'waiting',
    queuePosition: 1,
    runId: null,
    reusedExisting: false,
    updatedExisting: false,
    queueRequest: {} as EnqueueIngestRequestResult['queueRequest'],
    ...overrides,
  };
}

function buildApp(options?: {
  listIngestedRepositories?: () => Promise<ListReposResult>;
  enqueueOrReuseIngestRequest?: (
    input: EnqueueIngestRequestInput,
  ) => Promise<EnqueueIngestRequestResult>;
  useRealQueueRequest?: boolean;
  pumpIngestQueue?: () => Promise<PumpIngestQueueResult>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestReembedRouter({
      clientFactory: () => ({}) as never,
      listIngestedRepositories: async () =>
        options?.listIngestedRepositories
          ? options.listIngestedRepositories()
          : buildListReposResult(),
      enqueueOrReuseIngestRequest: async (input) =>
        options?.useRealQueueRequest
          ? enqueueOrReuseIngestRequest(input)
          : options?.enqueueOrReuseIngestRequest
          ? options.enqueueOrReuseIngestRequest(input)
          : buildQueueResult({
              canonicalTargetPath: input.canonicalTargetPath,
            }),
      pumpIngestQueue: async () =>
        options?.pumpIngestQueue
          ? options.pumpIngestQueue()
          : ({
              started: true,
              blockedByCleanup: false,
              requestId: 'queue-request-123',
              runId: '00000000-0000-0000-0000-000000000001',
            } satisfies PumpIngestQueueResult),
    }),
  );
  return app;
}

test.beforeEach(() => {
  resetStore();
});

beforeEach(() => {
  mock.restoreAll();
  mock.reset();
  __resetIngestJobsForTest();
  __resetIngestQueueAvailabilityForTest();
  __resetAstParserLogStateForTest();
  __setParseAstSourceForTest();
  resetCollectionsForTests();
  release();
  delete process.env.CODEINFO_INGEST_TEST_GIT_PATHS;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  mock.restoreAll();
  mock.reset();
  __resetIngestJobsForTest();
  __resetIngestQueueAvailabilityForTest();
  __resetAstParserLogStateForTest();
  __setParseAstSourceForTest();
  resetCollectionsForTests();
  release();
  delete process.env.CODEINFO_INGEST_TEST_GIT_PATHS;
  delete process.env.NODE_ENV;
});

const createTempRepo = async (files: Record<string, string>) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-reembed-'));
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
};

const waitForTerminal = async (runId: string) => {
  const result = await waitForTerminalIngestStatus(runId, {
    timeoutMs: 20_000,
    pollMs: 10,
  });
  if (result.reason === 'terminal' && result.status) {
    return result.status;
  }
  throw new Error(
    `Timed out waiting for ingest ${runId} (reason=${result.reason}, lastKnown=${result.lastKnown?.state ?? 'missing'})`,
  );
};

const setupIngestChromaMocks = (options?: {
  failGetOrCreateCollection?: Error;
}) => {
  let collectionFailure = options?.failGetOrCreateCollection ?? null;
  const vectors = {
    metadata: {
      lockedModelId: 'embed-model' as string | null,
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

  const getOrCreateCollection = mock.fn(async (opts: { name?: string }) => {
    if (collectionFailure) {
      throw collectionFailure;
    }
    if (opts.name === 'ingest_roots') return roots as never;
    return vectors as never;
  });
  mock.method(
    ChromaClient.prototype,
    'getOrCreateCollection',
    getOrCreateCollection,
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
  __setParseAstSourceForTest(async () => ({
    status: 'ok',
    language: 'typescript',
    symbols: [],
    edges: [],
    references: [],
    imports: [],
  }));

  return {
    vectors,
    roots,
    getOrCreateCollection,
    setCollectionFailure: (error: Error | null) => {
      collectionFailure = error;
    },
  };
};

const buildIngestDeps = (options?: { modelError?: Error }) => {
  let modelCalls = 0;
  return {
    baseUrl: 'http://lmstudio.local',
    lmClientFactory: () =>
      ({
        embedding: {
          model: async () => {
            modelCalls += 1;
            if (options?.modelError) {
              throw options.modelError;
            }
            return {
              embed: async () => ({ embedding: [0.1, 0.2, 0.3] }),
              getContextLength: async () => 256,
              countTokens: async (text: string) =>
                text.split(/\s+/).filter(Boolean).length,
            };
          },
        },
      }) as unknown as LMStudioClient,
    getModelCalls: () => modelCalls,
  };
};

test('ingest-reembed logs QUEUE_REQUEST_ACCEPTED_WITH_REQUEST_ID with shared canonicalTargetPath', async () => {
  const response = await request(buildApp()).post(
    '/ingest/reembed/%2Ftmp%2Frepo',
  );

  assert.equal(response.status, 202);
  assert.deepEqual(response.body, {
    queued: false,
    requestId: 'queue-request-123',
    runId: '00000000-0000-0000-0000-000000000001',
  });

  const entries = query({ text: 'QUEUE_REQUEST_ACCEPTED_WITH_REQUEST_ID' }, 20);
  const acceptanceEntry = entries.find(
    (entry) =>
      entry.context?.endpoint === '/ingest/reembed/:root' &&
      entry.context?.queueRequestId === 'queue-request-123' &&
      entry.context?.canonicalTargetPath === '/tmp/repo' &&
      entry.context?.runId === '00000000-0000-0000-0000-000000000001',
  );
  assert.ok(
    acceptanceEntry,
    'expected queue acceptance marker with shared canonicalTargetPath',
  );
});

test('ingest-reembed waiting queue-aware contract returns queued state without runId', async () => {
  const response = await request(
    buildApp({
      pumpIngestQueue: async () => ({
        started: false,
        blockedByCleanup: false,
        requestId: null,
        runId: 'some-other-run',
      }),
    }),
  ).post('/ingest/reembed/%2Ftmp%2Frepo');

  assert.equal(response.status, 202);
  assert.deepEqual(response.body, {
    queued: true,
    requestId: 'queue-request-123',
    queuePosition: 1,
  });
  assert.equal('runId' in response.body, false);
});

test('ingest-reembed promoted duplicate returns immediate acceptance with runId instead of stale waiting semantics', async () => {
  const response = await request(
    buildApp({
      enqueueOrReuseIngestRequest: async () =>
        buildQueueResult({
          queueState: 'running',
          queuePosition: null,
          runId: '00000000-0000-0000-0000-000000000124',
          reusedExisting: true,
          updatedExisting: false,
        }),
      pumpIngestQueue: async () => ({
        started: false,
        blockedByCleanup: false,
        requestId: 'queue-request-other',
        runId: null,
      }),
    }),
  ).post('/ingest/reembed/%2Ftmp%2Frepo');

  assert.equal(response.status, 202);
  assert.deepEqual(response.body, {
    queued: false,
    requestId: 'queue-request-123',
    runId: '00000000-0000-0000-0000-000000000124',
  });
  assert.equal('queuePosition' in response.body, false);
});

test('ingest-reembed logs QUEUE_REQUEST_UPDATED_IN_PLACE with shared canonicalTargetPath', async () => {
  const response = await request(
    buildApp({
      enqueueOrReuseIngestRequest: async (input) =>
        buildQueueResult({
          canonicalTargetPath: input.canonicalTargetPath,
          reusedExisting: true,
          updatedExisting: true,
        }),
      pumpIngestQueue: async () => ({
        started: false,
        blockedByCleanup: false,
        requestId: null,
        runId: 'other-run',
      }),
    }),
  ).post('/ingest/reembed/%2Ftmp%2Frepo');

  assert.equal(response.status, 202);
  assert.deepEqual(response.body, {
    queued: true,
    requestId: 'queue-request-123',
    queuePosition: 1,
  });

  const entries = query({ text: 'QUEUE_REQUEST_UPDATED_IN_PLACE' }, 20);
  const updateEntry = entries.find(
    (entry) =>
      entry.context?.endpoint === '/ingest/reembed/:root' &&
      entry.context?.queueRequestId === 'queue-request-123' &&
      entry.context?.canonicalTargetPath === '/tmp/repo' &&
      entry.context?.updatedExisting === true &&
      entry.context?.reusedExisting === true,
  );
  assert.ok(
    updateEntry,
    'expected updated-in-place queue marker with shared canonicalTargetPath',
  );
});

test('ingest-reembed rejects a still-visible queued start row before queue admission starts', async () => {
  let enqueueCalls = 0;
  const response = await request(
    buildApp({
      listIngestedRepositories: async () => ({
        repos: [
          {
            ...buildRepoEntry(),
            id: 'queued-only',
            containerPath: '/tmp/repo',
            lastIngestAt: null,
            requestId: 'queue-request-queued-only',
            runId: null,
            queueState: 'waiting',
            queuePosition: 1,
          },
        ],
        lockedModelId: 'embed-model',
      }),
      enqueueOrReuseIngestRequest: async () => {
        enqueueCalls += 1;
        return buildQueueResult();
      },
    }),
  ).post('/ingest/reembed/%2Ftmp%2Frepo');

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { status: 'error', code: 'NOT_FOUND' });
  assert.equal(enqueueCalls, 0);
});

test('ingest-reembed queue admission persists the stable repo name instead of an overlay run id', async () => {
  let queuedPayload: {
    name?: string;
    path?: string;
  } | null = null;
  const response = await request(
    buildApp({
      listIngestedRepositories: async () => ({
        repos: [
          {
            ...buildRepoEntry(),
            id: 'active-run-123',
            name: 'Stable Repo Name',
            containerPath: '/tmp/repo',
          },
        ],
        lockedModelId: 'embed-model',
      }),
      enqueueOrReuseIngestRequest: async (input) => {
        queuedPayload = {
          name:
            typeof input.requestPayload.name === 'string'
              ? input.requestPayload.name
              : undefined,
          path:
            typeof input.requestPayload.path === 'string'
              ? input.requestPayload.path
              : undefined,
        };
        return buildQueueResult({
          canonicalTargetPath: input.canonicalTargetPath,
        });
      },
      pumpIngestQueue: async () => ({
        started: false,
        blockedByCleanup: false,
        requestId: null,
        runId: 'some-other-run',
      }),
    }),
  ).post('/ingest/reembed/%2Ftmp%2Frepo');

  assert.equal(response.status, 202);
  assert.deepEqual(response.body, {
    queued: true,
    requestId: 'queue-request-123',
    queuePosition: 1,
  });
  if (!queuedPayload) {
    assert.fail('expected queue admission input');
  }
  const capturedPayload = queuedPayload as { name?: string; path?: string };
  assert.equal(capturedPayload.name, 'Stable Repo Name');
  assert.equal(capturedPayload.path, '/tmp/repo');
});

test('ingest-reembed queue-target normalization resolves encoded route aliases to one canonical target', () => {
  assert.equal(
    normalizeCanonicalQueueTargetPath('/tmp/repo/'),
    normalizeCanonicalQueueTargetPath('/tmp//repo'),
  );
  assert.equal(normalizeCanonicalQueueTargetPath('/tmp/repo'), '/tmp/repo');
});

test('queued reembed execution path and canonical bookkeeping path are kept separate for runtime operations', async () => {
  const { root, cleanup } = await createTempRepo({
    'src/hello.ts': 'export const x = 1;\n',
  });
  const mountedExecutionRoot = root;
  const canonicalTargetRoot = `${root}-canonical-stored`;
  const listLookupRoots: string[] = [];
  setupIngestChromaMocks();
  (mongoose.connection as unknown as { readyState: number }).readyState = 1;

  mock.method(IngestFileModel, 'find', (query: { root?: string }) => {
    listLookupRoots.push(query.root ?? '');
    (mongoose.connection as unknown as { readyState: number }).readyState = 0;
    return {
      select: () => ({
        lean: () => ({
          exec: async () => [],
        }),
      }),
    };
  });

  try {
    const runId = await startIngest(
      {
        path: mountedExecutionRoot,
        canonicalTargetPath: canonicalTargetRoot,
        name: 'queued-reembed-path-semantics',
        model: 'embed-model',
        operation: 'reembed',
      },
      buildIngestDeps(),
    );
    const status = await waitForTerminal(runId);

    assert.equal(
      status.state,
      'completed',
      `expected completed but got ${status.state}; lastError=${status.lastError}; error=${JSON.stringify(status.error)}`,
    );
    assert.equal(listLookupRoots.includes(canonicalTargetRoot), true);
    const startLog = query({ text: 'ingest start' }, 20).find(
      (entry) => entry.message === 'ingest start',
    );
    assert.equal(startLog?.context?.path, mountedExecutionRoot);
  } finally {
    await cleanup();
  }
});

test('queued reembed destructive cleanup stays keyed to canonicalTargetPath when execution path is mounted', async () => {
  const { root, cleanup } = await createTempRepo({
    'src/hello.ts': 'export const x = 1;\n',
  });
  const mountedExecutionRoot = root;
  const canonicalTargetRoot = `${root}-canonical-stored`;
  const deleteVectorRoots: Array<Record<string, unknown>> = [];
  const deleteRootRoots: Array<Record<string, unknown>> = [];
  const { vectors, roots } = setupIngestChromaMocks();
  (mongoose.connection as unknown as { readyState: number }).readyState = 1;

  mock.method(IngestFileModel, 'find', (query: { root?: string }) => {
    assert.equal(query.root, canonicalTargetRoot);
    (mongoose.connection as unknown as { readyState: number }).readyState = 0;
    return {
      select: () => ({
        lean: () => ({
          exec: async () => [],
        }),
      }),
    };
  });
  vectors.delete = mock.fn(
    async (opts?: { where?: Record<string, unknown> }) => {
      if (opts?.where && Object.hasOwn(opts.where, 'root')) {
        deleteVectorRoots.push(opts.where);
      }
    },
  );
  roots.delete = mock.fn(async (opts?: { where?: Record<string, unknown> }) => {
    if (opts?.where && Object.hasOwn(opts.where, 'root')) {
      deleteRootRoots.push(opts.where);
    }
  });

  try {
    const runId = await startIngest(
      {
        path: mountedExecutionRoot,
        canonicalTargetPath: canonicalTargetRoot,
        name: 'queued-reembed-path-semantics',
        model: 'embed-model',
        operation: 'reembed',
      },
      buildIngestDeps(),
    );
    const status = await waitForTerminal(runId);

    assert.equal(
      status.state,
      'completed',
      `expected completed but got ${status.state}; lastError=${status.lastError}; error=${JSON.stringify(status.error)}`,
    );
    assert.equal(
      deleteVectorRoots.some((where) => where.root === canonicalTargetRoot),
      true,
    );
    assert.equal(
      deleteRootRoots.some((where) => where.root === canonicalTargetRoot),
      true,
    );
  } finally {
    await cleanup();
  }
});

test('ingest-reembed queue outage mapping returns retryable 503 QUEUE_UNAVAILABLE', async () => {
  const response = await request(
    buildApp({
      enqueueOrReuseIngestRequest: async () => {
        const error = new Error(
          'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
        );
        (
          error as { code?: string; retryable?: boolean; status?: number }
        ).code = 'QUEUE_UNAVAILABLE';
        (error as { retryable?: boolean }).retryable = true;
        (error as { status?: number }).status = 503;
        throw error;
      },
    }),
  ).post('/ingest/reembed/%2Ftmp%2Frepo');

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    status: 'error',
    code: 'QUEUE_UNAVAILABLE',
    retryable: true,
    message:
      'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
  });

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const warnEntry = entries.find(
    (entry) =>
      entry.level === 'warn' &&
      entry.context?.surface === 'ingest/reembed' &&
      entry.context?.code === 'QUEUE_UNAVAILABLE',
  );
  assert.ok(warnEntry, 'expected retryable reembed queue outage warn log');
});

test('ingest-reembed degraded startup queue outage still returns retryable 503 QUEUE_UNAVAILABLE', async () => {
  (mongoose.connection as unknown as { readyState: number }).readyState = 1;
  markIngestQueueUnavailable(INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE);

  const response = await request(buildApp({ useRealQueueRequest: true })).post(
    '/ingest/reembed/%2Ftmp%2Frepo',
  );

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    status: 'error',
    code: 'QUEUE_UNAVAILABLE',
    retryable: true,
    message: INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE,
  });

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const warnEntry = entries.find(
    (entry) =>
      entry.level === 'warn' &&
      entry.context?.surface === 'ingest/reembed' &&
      entry.context?.code === 'QUEUE_UNAVAILABLE' &&
      entry.context?.message === INGEST_QUEUE_STARTUP_RECOVERY_DEGRADED_MESSAGE,
  );
  assert.ok(
    warnEntry,
    'expected retryable reembed warn log for degraded startup queue outage',
  );
});

test('blank-only delta reembed keeps a zero-count completed terminal result after execution-time validation passes', async () => {
  setupIngestChromaMocks();
  const { root, cleanup } = await createTempRepo({
    'src/blank.ts': '   \n\t\n',
  });

  try {
    const fileHash = await hashFile(path.join(root, 'src/blank.ts'));
    mock.method(IngestFileModel, 'find', () => ({
      select: () => ({
        lean: () => ({
          exec: async () => [{ relPath: 'src/blank.ts', fileHash }],
        }),
      }),
    }));
    await getLockedEmbeddingModel();

    const runId = await startIngest(
      {
        path: root,
        name: 'blank-reembed',
        model: 'embed-model',
        operation: 'reembed',
      },
      buildIngestDeps(),
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'completed');
    assert.deepEqual(status.counts, { files: 1, chunks: 0, embedded: 0 });
    assert.equal(status.error, null);
    assert.doesNotMatch(
      String(status.lastError ?? status.message ?? ''),
      /no eligible files/i,
    );
  } finally {
    await cleanup();
  }
});

test('queued zero-work delta reembed rejects execution-time lock drift before provider lookup or Chroma bootstrap', async () => {
  const { vectors, getOrCreateCollection } = setupIngestChromaMocks();
  (mongoose.connection as unknown as { readyState: number }).readyState = 1;
  const { root, cleanup } = await createTempRepo({
    'src/blank.ts': '   \n\t\n',
  });

  try {
    const fileHash = await hashFile(path.join(root, 'src/blank.ts'));
    const deps = buildIngestDeps();
    mock.method(IngestFileModel, 'find', () => ({
      select: () => ({
        lean: () => ({
          exec: async () => [{ relPath: 'src/blank.ts', fileHash }],
        }),
      }),
    }));
    await getLockedEmbeddingModel();
    const bootstrapCallsBeforeRun = getOrCreateCollection.mock.calls.length;
    vectors.metadata = {
      lockedModelId: 'embed-locked',
      embeddingProvider: 'lmstudio',
      embeddingModel: 'embed-locked',
      embeddingDimensions: 768,
    };

    const runId = await startIngest(
      {
        path: root,
        canonicalTargetPath: `${root}-queued`,
        name: 'blank-reembed-execution-drift',
        model: 'embed-model',
        operation: 'reembed',
      },
      deps,
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'error');
    assert.equal(status.lastError, 'MODEL_LOCKED');
    assert.equal(
      deps.getModelCalls(),
      0,
      'zero-work drift rejection should fail before provider lookup starts',
    );
    assert.equal(
      getOrCreateCollection.mock.calls.length,
      bootstrapCallsBeforeRun + 1,
      'zero-work drift rejection should fail before Chroma bootstrap starts',
    );
  } finally {
    await cleanup();
  }
});

test('blank-only delta reembed stays provider-free when model lookup would fail after execution-time validation passes', async () => {
  const { getOrCreateCollection } = setupIngestChromaMocks();
  (mongoose.connection as unknown as { readyState: number }).readyState = 1;
  const { root, cleanup } = await createTempRepo({
    'src/blank.ts': '   \n\t\n',
  });

  try {
    const fileHash = await hashFile(path.join(root, 'src/blank.ts'));
    const providerUnavailable = new Error('lmstudio unavailable');
    const deps = buildIngestDeps({ modelError: providerUnavailable });
    mock.method(IngestFileModel, 'find', () => ({
      select: () => ({
        lean: () => ({
          exec: async () => [{ relPath: 'src/blank.ts', fileHash }],
        }),
      }),
    }));
    await getLockedEmbeddingModel();
    const bootstrapCallsBeforeRun = getOrCreateCollection.mock.calls.length;

    const runId = await startIngest(
      {
        path: root,
        name: 'blank-reembed-provider-free',
        model: 'embed-model',
        operation: 'reembed',
      },
      deps,
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'completed');
    assert.deepEqual(status.counts, { files: 0, chunks: 0, embedded: 0 });
    assert.equal(status.error, null);
    assert.equal(deps.getModelCalls(), 0);
    assert.equal(
      getOrCreateCollection.mock.calls.length,
      bootstrapCallsBeforeRun + 1,
      'zero-work fast path should avoid extra late Chroma bootstrap after validation passes',
    );
  } finally {
    await cleanup();
  }
});

test('blank-only delta reembed returns a zero-count completed terminal result when late Chroma bootstrap would fail after validation passes', async () => {
  const chromaBootstrapFailure = new Error('chroma bootstrap failed');
  const { getOrCreateCollection, setCollectionFailure } =
    setupIngestChromaMocks();
  (mongoose.connection as unknown as { readyState: number }).readyState = 1;
  const { root, cleanup } = await createTempRepo({
    'src/blank.ts': '   \n\t\n',
  });

  try {
    const fileHash = await hashFile(path.join(root, 'src/blank.ts'));
    const deps = buildIngestDeps();
    mock.method(IngestFileModel, 'find', () => ({
      select: () => ({
        lean: () => ({
          exec: async () => [{ relPath: 'src/blank.ts', fileHash }],
        }),
      }),
    }));
    await getLockedEmbeddingModel();
    const bootstrapCallsBeforeRun = getOrCreateCollection.mock.calls.length;
    setCollectionFailure(chromaBootstrapFailure);

    const runId = await startIngest(
      {
        path: root,
        name: 'blank-reembed-bootstrap-failure',
        model: 'embed-model',
        operation: 'reembed',
      },
      deps,
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'completed');
    assert.deepEqual(status.counts, { files: 0, chunks: 0, embedded: 0 });
    assert.equal(status.error, null);
    assert.match(String(status.message ?? ''), /no changes/i);
    assert.equal(
      deps.getModelCalls(),
      0,
      'zero-work fast path should stay provider-free under bootstrap failure after validation passes',
    );
    assert.equal(
      getOrCreateCollection.mock.calls.length,
      bootstrapCallsBeforeRun + 1,
      'zero-work fast path should not add a second late Chroma bootstrap after validation passes',
    );
  } finally {
    await cleanup();
  }
});

test('successful ingest prefers the observed vector dimension over stale persisted hints', async () => {
  const { roots } = setupIngestChromaMocks();
  const rootsWithDimension = roots as typeof roots & { dimension?: number };
  rootsWithDimension.dimension = 1;
  roots.get = async () => ({ embeddings: [[0.1]] });
  const deps = buildIngestDeps();
  const { root, cleanup } = await createTempRepo({
    'large.md': '# heading\n\n' + 'alpha beta gamma '.repeat(5000),
  });

  try {
    const runId = await startIngest(
      { path: root, name: 'fresh-vector-dimension', model: 'embed-model' },
      deps,
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'completed');
    assert.equal(roots.add.mock.calls.length, 1);
    const addCall = roots.add.mock.calls[0] as unknown as {
      arguments: [
        {
          embeddings: number[][];
          metadatas: Array<{ embeddingDimensions?: number }>;
        },
      ];
    };
    assert.equal(addCall.arguments[0].embeddings[0]?.length, 3);
    assert.equal(addCall.arguments[0].metadatas[0]?.embeddingDimensions, 3);
  } finally {
    await cleanup();
  }
});

test('deletions-only delta reembed skips root persistence when no dimension can be trusted', async () => {
  const { roots } = setupIngestChromaMocks();
  const rootsWithDimension = roots as typeof roots & { dimension?: number };
  rootsWithDimension.dimension = undefined;
  roots.get = async () => ({ embeddings: [] });
  const providerUnavailable = new Error('lmstudio unavailable');
  const deletionReembedDeps = buildIngestDeps({
    modelError: providerUnavailable,
  });
  const liveDeps = buildIngestDeps();
  const { root, cleanup } = await createTempRepo({
    'docs/deleted.txt': 'to be removed\n',
  });

  try {
    mock.method(IngestFileModel, 'find', () => ({
      select: () => ({
        lean: () => ({
          exec: async () => [{ relPath: 'docs/deleted.txt', fileHash: 'old' }],
        }),
      }),
    }));
    await fs.rm(path.join(root, 'docs/deleted.txt'));
    process.env.CODEINFO_INGEST_TEST_GIT_PATHS = '';

    const deletionReembedId = await startIngest(
      {
        path: root,
        name: 'deletions-reembed-no-dimension',
        model: 'embed-model',
        operation: 'reembed',
      },
      deletionReembedDeps,
    );
    const deletionReembedStatus = await waitForTerminal(deletionReembedId);

    assert.equal(deletionReembedStatus.state, 'completed');
    assert.equal(
      deletionReembedDeps.getModelCalls(),
      0,
      'no-work reembed should remain provider-free when no dimension can be trusted',
    );
    assert.equal(
      roots.add.mock.calls.length,
      0,
      'no-work reembed should skip persisting an untrusted fallback root dimension',
    );

    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src/live.ts'),
      'export const value = 1;\n',
      'utf8',
    );
    process.env.CODEINFO_INGEST_TEST_GIT_PATHS = 'src/live.ts';

    const liveRunId = await startIngest(
      {
        path: root,
        name: 'live-after-deletions-reembed',
        model: 'embed-model',
      },
      liveDeps,
    );
    const liveStatus = await waitForTerminal(liveRunId);

    assert.equal(liveStatus.state, 'completed');
    assert.equal(roots.add.mock.calls.length, 1);
    const addCall = roots.add.mock.calls[0] as unknown as {
      arguments: [
        {
          embeddings: number[][];
          metadatas: Array<{ embeddingDimensions?: number }>;
        },
      ];
    };
    assert.equal(addCall.arguments[0].embeddings[0]?.length, 3);
    assert.equal(addCall.arguments[0].metadatas[0]?.embeddingDimensions, 3);
  } finally {
    await cleanup();
  }
});

test('deletions-only delta reembed keeps a numeric zero-file terminal percent', async () => {
  setupIngestChromaMocks();
  const { root, cleanup } = await createTempRepo({
    'src/deleted.ts': 'export const deleted = 1;\n',
  });

  try {
    mock.method(IngestFileModel, 'find', () => ({
      select: () => ({
        lean: () => ({
          exec: async () => [
            { relPath: 'src/deleted.ts', fileHash: 'deleted-hash' },
          ],
        }),
      }),
    }));
    await fs.rm(path.join(root, 'src/deleted.ts'));
    process.env.CODEINFO_INGEST_TEST_GIT_PATHS = '';

    const runId = await startIngest(
      {
        path: root,
        name: 'deleted-reembed',
        model: 'embed-model',
        operation: 'reembed',
      },
      buildIngestDeps(),
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'completed');
    assert.equal(status.percent, 0);
    assert.notEqual(status.error?.error, 'NO_ELIGIBLE_FILES');
    assert.doesNotMatch(String(status.message ?? ''), /no eligible files/i);
  } finally {
    await cleanup();
  }
});

test('deletions-only delta reembed stays provider-free when model lookup would fail', async () => {
  setupIngestChromaMocks();
  (mongoose.connection as unknown as { readyState: number }).readyState = 1;
  const { root, cleanup } = await createTempRepo({
    'docs/deleted.txt': 'to be removed\n',
  });

  try {
    const providerUnavailable = new Error('lmstudio unavailable');
    const deps = buildIngestDeps({ modelError: providerUnavailable });
    mock.method(IngestFileModel, 'find', () => ({
      select: () => ({
        lean: () => ({
          exec: async () => [
            { relPath: 'docs/deleted.txt', fileHash: 'deleted-hash' },
          ],
        }),
      }),
    }));
    await fs.rm(path.join(root, 'docs/deleted.txt'));
    process.env.CODEINFO_INGEST_TEST_GIT_PATHS = '';

    const runId = await startIngest(
      {
        path: root,
        name: 'deleted-reembed-provider-free',
        model: 'embed-model',
        operation: 'reembed',
      },
      deps,
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'completed');
    assert.deepEqual(status.counts, { files: 0, chunks: 0, embedded: 0 });
    assert.equal(status.error, null);
    assert.equal(deps.getModelCalls(), 0);
  } finally {
    await cleanup();
  }
});

test('deletions-only delta reembed returns a zero-count completed terminal result when late Chroma bootstrap would fail after validation passes', async () => {
  const chromaBootstrapFailure = new Error('chroma bootstrap failed');
  const { getOrCreateCollection, setCollectionFailure } =
    setupIngestChromaMocks();
  (mongoose.connection as unknown as { readyState: number }).readyState = 1;
  const { root, cleanup } = await createTempRepo({
    'docs/deleted.txt': 'to be removed\n',
  });

  try {
    const deps = buildIngestDeps();
    mock.method(IngestFileModel, 'find', () => ({
      select: () => ({
        lean: () => ({
          exec: async () => [
            { relPath: 'docs/deleted.txt', fileHash: 'deleted-hash' },
          ],
        }),
      }),
    }));
    await getLockedEmbeddingModel();
    const bootstrapCallsBeforeRun = getOrCreateCollection.mock.calls.length;
    await fs.rm(path.join(root, 'docs/deleted.txt'));
    process.env.CODEINFO_INGEST_TEST_GIT_PATHS = '';
    setCollectionFailure(chromaBootstrapFailure);

    const runId = await startIngest(
      {
        path: root,
        name: 'deleted-reembed-bootstrap-failure',
        model: 'embed-model',
        operation: 'reembed',
      },
      deps,
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'completed');
    assert.deepEqual(status.counts, { files: 0, chunks: 0, embedded: 0 });
    assert.equal(status.error, null);
    assert.equal(
      deps.getModelCalls(),
      0,
      'deletions-only fast path should stay provider-free under bootstrap failure after validation passes',
    );
    assert.equal(
      getOrCreateCollection.mock.calls.length,
      bootstrapCallsBeforeRun + 1,
      'deletions-only fast path should not add a second late Chroma bootstrap after validation passes',
    );
  } finally {
    await cleanup();
  }
});
