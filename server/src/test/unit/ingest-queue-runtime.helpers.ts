import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'node:test';
import { mock } from 'node:test';
import { ChromaClient } from 'chromadb';
import mongoose from 'mongoose';
import { resetCollectionsForTests } from '../../ingest/chromaClient.js';
import {
  __resetIngestJobsForTest,
  __setQueueRuntimeOpsForTest,
  __setRunProcessorForTest,
  __setRunSchedulerForTest,
  setIngestDeps,
  waitForQueueRequestTerminalStatus,
} from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import { __resetIngestQueueAvailabilityForTest } from '../../ingest/requestQueue.js';
import { resetStore } from '../../logStore.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import {
  clearScopedTestEnvValue,
  setScopedTestEnvValue,
} from '../support/processEnvIsolation.js';

const ORIGINAL_CODEINFO_CODEX_WORKDIR = process.env.CODEINFO_CODEX_WORKDIR;

export function waitForNextTurn() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

export async function waitForQueueManagedTerminalResult(
  requestId: string,
  timeoutMs = 20_000,
) {
  return await waitForQueueRequestTerminalStatus(requestId, {
    timeoutMs,
  });
}

export async function waitForQueueManagedTerminalStatus(
  requestId: string,
  timeoutMs = 20_000,
) {
  const result = await waitForQueueManagedTerminalResult(requestId, timeoutMs);
  if (result.reason === 'terminal' && result.status) {
    return result.status;
  }
  throw new Error(
    `Timed out waiting for queue request ${requestId} (reason=${result.reason}, runId=${result.runId ?? 'missing'}, lastKnown=${result.lastKnown?.state ?? 'missing'})`,
  );
}

export function createQueueRequest(params: {
  requestId: string;
  root: string;
  operation?: 'start' | 'reembed';
  queueState: 'waiting' | 'running' | 'cleanup-blocked';
  runId?: string | null;
  nonReplayableAt?: Date | null;
  terminalPublishedAt?: Date | null;
}) {
  const operation = params.operation ?? 'reembed';
  const objectIdHex = /^[0-9a-f]+$/iu.test(params.requestId)
    ? params.requestId.toLowerCase().slice(0, 24).padStart(24, '0')
    : Buffer.from(params.requestId, 'utf8')
        .toString('hex')
        .slice(0, 24)
        .padStart(24, '0');
  return {
    _id: new mongoose.Types.ObjectId(objectIdHex),
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

export async function createTempRepo(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-queue-'));
  await fs.mkdir(path.join(root, '.git'));
  await Promise.all(
    Object.entries(files).map(async ([relPath, contents]) => {
      const fullPath = path.join(root, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, contents, 'utf8');
    }),
  );
  setScopedTestEnvValue(
    'CODEINFO_INGEST_TEST_GIT_PATHS',
    Object.keys(files).join(','),
  );
  return {
    root,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

export function setupIngestChromaMocks(options?: {
  rootIds?: string[];
  rootMetadatas?: Record<string, unknown>[];
  rootMetadataReadError?: Error;
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
      if (
        include.includes('metadatas') &&
        options?.rootMetadataReadError instanceof Error
      ) {
        throw options.rootMetadataReadError;
      }
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
  setScopedTestEnvValue('NODE_ENV', 'test');
  return { roots, vectors };
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

export function installQueueRuntimeTestHooks() {
  beforeEach(() => {
    mock.restoreAll();
    mock.reset();
    resetCollectionsForTests();
    resetStore();
    setScopedTestEnvValue('NODE_ENV', 'test');
    clearScopedTestEnvValue('CODEINFO_CODEX_WORKDIR');
    __resetIngestJobsForTest();
    __resetIngestQueueAvailabilityForTest();
    release();
    clearScopedTestEnvValue('CODEINFO_INGEST_TEST_GIT_PATHS');
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
    clearScopedTestEnvValue('CODEINFO_INGEST_TEST_GIT_PATHS');
    if (ORIGINAL_CODEINFO_CODEX_WORKDIR === undefined) {
      clearScopedTestEnvValue('CODEINFO_CODEX_WORKDIR');
    } else {
      setScopedTestEnvValue(
        'CODEINFO_CODEX_WORKDIR',
        ORIGINAL_CODEINFO_CODEX_WORKDIR,
      );
    }
  });
}
