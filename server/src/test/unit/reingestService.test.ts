import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';

import {
  __getIngestEventListenerCountForTest,
  __resetIngestJobsForTest,
  __setQueueRequestIdForRunForTest,
  __setQueueRequestTerminalStatusTtlForTest,
  __setQueueRuntimeOpsForTest,
  __setStatusAndPublishForTest,
} from '../../ingest/ingestJob.js';
import {
  runReingestRepository,
  type ReingestSuccess,
} from '../../ingest/reingestService.js';
import type { EnqueueIngestRequestResult } from '../../ingest/requestQueue.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';

const noopLog = () => undefined;

function useMicrotaskTimeoutMock() {
  mock.method(globalThis, 'setTimeout', ((callback: () => void) => {
    void Promise.resolve().then(callback);
    return {
      unref() {
        return this;
      },
    } as ReturnType<typeof globalThis.setTimeout>;
  }) as typeof globalThis.setTimeout);
  mock.method(
    globalThis,
    'clearTimeout',
    (() => undefined) as typeof globalThis.clearTimeout,
  );
}

afterEach(() => {
  mock.restoreAll();
  mock.reset();
  if (process.env.NODE_ENV === 'test') {
    __resetIngestJobsForTest();
    __setQueueRuntimeOpsForTest(null);
  }
  delete process.env.NODE_ENV;
});

const buildRepoEntry = (params: {
  id?: string;
  name?: string;
  description?: string | null;
  containerPath: string;
  lastIngestAt?: string | null;
}): RepoEntry => ({
  id: params.id ?? 'repo-a',
  name: params.name,
  description: params.description ?? null,
  containerPath: params.containerPath,
  hostPath: `/host${params.containerPath}`,
  lastIngestAt:
    params.lastIngestAt === undefined
      ? '2026-01-01T00:00:00.000Z'
      : params.lastIngestAt,
  embeddingProvider: 'lmstudio',
  embeddingModel: 'model',
  embeddingDimensions: 768,
  model: 'model',
  modelId: 'model',
  lock: {
    embeddingProvider: 'lmstudio',
    embeddingModel: 'model',
    embeddingDimensions: 768,
    lockedModelId: 'model',
    modelId: 'model',
  },
  counts: { files: 1, chunks: 1, embedded: 1 },
  lastError: null,
});

const buildTerminal = (
  state: 'completed' | 'cancelled' | 'error' | 'skipped',
  counts = { files: 3, chunks: 8, embedded: 5 },
) => ({
  runId: 'ingest-123',
  state,
  counts,
  message: state,
  lastError: state === 'error' ? 'boom' : null,
  error:
    state === 'error'
      ? {
          error: 'INGEST_FAIL',
          message: 'boom',
          retryable: false,
          provider: 'lmstudio' as const,
        }
      : null,
});

const buildDeps = () => ({
  listIngestedRepositories: async () => ({
    repos: [buildRepoEntry({ id: 'repo-a', containerPath: '/data/repo-a' })],
    lockedModelId: 'model',
  }),
  enqueueOrReuseIngestRequest: async () =>
    buildQueueResult({
      requestId: 'queue-request-123',
      canonicalTargetPath: '/data/repo-a',
      queueState: 'waiting',
      queuePosition: 1,
      runId: null,
    }),
  pumpIngestQueue: async () => ({
    started: true,
    blockedByCleanup: false,
    requestId: 'queue-request-123',
    runId: 'ingest-123',
  }),
  appendLog: noopLog,
});

function buildQueueResult(
  overrides: Partial<EnqueueIngestRequestResult>,
): EnqueueIngestRequestResult {
  return {
    requestId: 'queue-request-123',
    canonicalTargetPath: '/data/repo-a',
    queueState: 'waiting',
    queuePosition: 1,
    runId: null,
    reusedExisting: false,
    updatedExisting: false,
    queueRequest: {} as EnqueueIngestRequestResult['queueRequest'],
    ...overrides,
  };
}

test('blocking success returns completed terminal payload with required fields', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'terminal',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: buildTerminal('completed'),
        lastKnown: buildTerminal('completed'),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const payload = result.value;
  assert.equal(payload.status, 'completed');
  assert.equal(payload.operation, 'reembed');
  assert.equal(payload.runId, 'ingest-123');
  assert.equal(payload.sourceId, '/data/repo-a');
  assert.equal(payload.resolvedRepositoryId, 'repo-a');
  assert.equal(payload.completionMode, 'reingested');
  assert.equal(typeof payload.durationMs, 'number');
  assert.equal(payload.durationMs >= 0, true);
  assert.equal(typeof payload.files, 'number');
  assert.equal(typeof payload.chunks, 'number');
  assert.equal(typeof payload.embedded, 'number');
  assert.equal(payload.errorCode, null);
});

test('actual queue terminal cache still resolves completed and failed payloads before TTL eviction', async () => {
  process.env.NODE_ENV = 'test';
  __setQueueRequestTerminalStatusTtlForTest(60_000);

  for (const state of ['completed', 'error'] as const) {
    __resetIngestJobsForTest();
    __setQueueRequestTerminalStatusTtlForTest(60_000);
    __setQueueRequestIdForRunForTest('ingest-123', 'queue-request-123');
    __setStatusAndPublishForTest('ingest-123', buildTerminal(state));

    const result = await runReingestRepository(
      { sourceId: '/data/repo-a' },
      buildDeps(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(
      result.value.status,
      state === 'error' ? 'error' : 'completed',
    );
    assert.equal(result.value.runId, 'ingest-123');
  }
});

test('internal skipped maps to completed with skipped completionMode', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'terminal',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: buildTerminal('skipped'),
        lastKnown: buildTerminal('skipped'),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'completed');
  assert.equal(result.value.completionMode, 'skipped');
  assert.equal(result.value.errorCode, null);
});

test('cancelled returns last-known counters, null completionMode, and errorCode null', async () => {
  const counts = { files: 9, chunks: 13, embedded: 4 };
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'terminal',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: buildTerminal('cancelled', counts),
        lastKnown: buildTerminal('cancelled', counts),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'cancelled');
  assert.equal(result.value.completionMode, null);
  assert.equal(result.value.files, counts.files);
  assert.equal(result.value.chunks, counts.chunks);
  assert.equal(result.value.embedded, counts.embedded);
  assert.equal(result.value.errorCode, null);
});

test('terminal error contract includes null completionMode, non-null errorCode, and full field set', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'terminal',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: buildTerminal('error'),
        lastKnown: buildTerminal('error'),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const payload = result.value;
  assert.equal(payload.status, 'error');
  assert.equal(payload.completionMode, null);
  assert.notEqual(payload.errorCode, null);
  assert.equal(payload.operation, 'reembed');
  assert.equal(typeof payload.durationMs, 'number');
  assert.equal(typeof payload.files, 'number');
  assert.equal(typeof payload.chunks, 'number');
  assert.equal(typeof payload.embedded, 'number');
});

test('timeout during wait returns deterministic terminal error payload', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'timeout',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: null,
        lastKnown: buildTerminal('cancelled', {
          files: 2,
          chunks: 3,
          embedded: 1,
        }),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'error');
  assert.equal(result.value.completionMode, null);
  assert.equal(result.value.errorCode, 'WAIT_TIMEOUT');
});

test('queue read failure during wait returns deterministic terminal error payload', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'queue-read-failed',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: null,
        lastKnown: buildTerminal('cancelled', {
          files: 2,
          chunks: 3,
          embedded: 1,
        }),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'error');
  assert.equal(result.value.completionMode, null);
  assert.equal(result.value.errorCode, 'QUEUE_READ_FAILED');
});

test('missing run status after start returns deterministic terminal error payload', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'timeout',
        requestId: 'queue-request-123',
        runId: null,
        status: null,
        lastKnown: null,
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'error');
  assert.equal(result.value.completionMode, null);
  assert.equal(result.value.errorCode, 'WAIT_TIMEOUT');
});

test('missing validation failure preserves the strict INVALID_PARAMS contract', async () => {
  const listIngestedRepositories = async () => ({
    repos: [buildRepoEntry({ id: 'repo-a', containerPath: '/data/repo-a' })],
    lockedModelId: 'model',
  });

  const result = await runReingestRepository(
    {},
    {
      listIngestedRepositories,
      appendLog: noopLog,
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, -32602);
  assert.equal(result.error.message, 'INVALID_PARAMS');
  assert.equal(result.error.data.code, 'INVALID_SOURCE_ID');
  assert.equal(result.error.data.retryable, true);
  assert.equal(result.error.data.retryMessage.includes('retry'), true);
  assert.equal(result.error.data.fieldErrors[0]?.reason, 'missing');
  assert.equal(
    result.error.data.fieldErrors[0]?.message,
    'sourceId is required',
  );
});

test('non-absolute validation failure preserves the strict INVALID_PARAMS contract', async () => {
  const result = await runReingestRepository(
    { sourceId: 'repo-a' },
    {
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry({ containerPath: '/data/repo-a' })],
        lockedModelId: 'model',
      }),
      appendLog: noopLog,
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, -32602);
  assert.equal(result.error.message, 'INVALID_PARAMS');
  assert.equal(result.error.data.code, 'INVALID_SOURCE_ID');
  assert.equal(result.error.data.retryable, true);
  assert.equal(result.error.data.retryMessage.includes('retry'), true);
  assert.equal(result.error.data.fieldErrors[0]?.reason, 'non_absolute');
  assert.equal(
    result.error.data.fieldErrors[0]?.message,
    'sourceId must be an absolute normalized container path',
  );
});

test('ambiguous_path validation failure preserves the strict INVALID_PARAMS contract', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data\\repo-a' },
    {
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry({ containerPath: '/data/repo-a' })],
        lockedModelId: 'model',
      }),
      appendLog: noopLog,
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, -32602);
  assert.equal(result.error.message, 'INVALID_PARAMS');
  assert.equal(result.error.data.code, 'INVALID_SOURCE_ID');
  assert.equal(result.error.data.retryable, true);
  assert.equal(result.error.data.retryMessage.includes('retry'), true);
  assert.equal(result.error.data.fieldErrors[0]?.reason, 'ambiguous_path');
  assert.equal(
    result.error.data.fieldErrors[0]?.message,
    'sourceId must not mix slash styles',
  );
});

test('unsupported wait/blocking args are rejected with INVALID_PARAMS', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a', wait: true, blocking: true },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'terminal',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: buildTerminal('completed'),
        lastKnown: buildTerminal('completed'),
      }),
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, -32602);
  assert.equal(result.error.message, 'INVALID_PARAMS');
});

test('unknown root includes AI retry guidance fields', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-missing' },
    {
      listIngestedRepositories: async () => ({
        repos: [
          buildRepoEntry({ id: 'repo-a', containerPath: '/data/repo-a' }),
          buildRepoEntry({ id: 'repo-b', containerPath: '/data/repo-b' }),
        ],
        lockedModelId: 'model',
      }),
      appendLog: noopLog,
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 404);
  assert.equal(result.error.message, 'NOT_FOUND');
  assert.deepEqual(result.error.data.reingestableRepositoryIds, [
    'repo-a',
    'repo-b',
  ]);
  assert.deepEqual(result.error.data.reingestableSourceIds, [
    '/data/repo-a',
    '/data/repo-b',
  ]);
  assert.equal(result.error.data.fieldErrors[0]?.reason, 'unknown_root');
});

test('known repository id is surfaced as resolvedRepositoryId', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'terminal',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: buildTerminal('completed'),
        lastKnown: buildTerminal('completed'),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.resolvedRepositoryId, 'repo-a');
});

test('missing repository id is surfaced as resolvedRepositoryId null', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      listIngestedRepositories: async () => ({
        repos: [
          {
            ...buildRepoEntry({
              containerPath: '/data/repo-a',
            }),
            id: undefined,
          } as unknown as RepoEntry,
        ],
        lockedModelId: 'model',
      }),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'terminal',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: buildTerminal('completed'),
        lastKnown: buildTerminal('completed'),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.resolvedRepositoryId, null);
});

test('queue delay is treated as normal blocking progress before the terminal run result arrives', async () => {
  let waitedForRequestId: string | null = null;
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      enqueueOrReuseIngestRequest: async () =>
        buildQueueResult({
          requestId: 'queue-request-delayed',
          canonicalTargetPath: '/data/repo-a',
          queueState: 'waiting',
          queuePosition: 2,
          runId: null,
        }),
      pumpIngestQueue: async () => ({
        started: false,
        blockedByCleanup: false,
        requestId: 'other-request',
        runId: 'other-run',
      }),
      waitForQueueRequestTerminalStatus: async (requestId) => {
        waitedForRequestId = requestId;
        return {
          reason: 'terminal',
          requestId,
          runId: 'ingest-queued',
          status: buildTerminal('completed'),
          lastKnown: {
            ...buildTerminal('completed'),
            runId: 'ingest-queued',
          },
        };
      },
    },
  );

  assert.equal(waitedForRequestId, 'queue-request-delayed');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.runId, 'ingest-queued');
  assert.equal(result.value.status, 'completed');
  assert.equal(result.value.completionMode, 'reingested');
});

test('queued reembed requests prefer the stable display name while keeping canonical and execution paths split when host mapping is available', async () => {
  const originalHostIngestDir = process.env.CODEINFO_HOST_INGEST_DIR;
  const originalCodexWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
  process.env.CODEINFO_HOST_INGEST_DIR = '/tmp/codeinfo-host-ingest';
  process.env.CODEINFO_CODEX_WORKDIR = '/tmp/codeinfo-codex-workdir';
  const activeRunId = 'active-run-123';
  const stableDisplayName = 'Stable Repo Name';
  const stableDescription = 'Stable description';

  try {
    const result = await runReingestRepository(
      { sourceId: '/data/codeInfo2/codeInfo2' },
      {
        listIngestedRepositories: async () => ({
          repos: [
            {
              ...buildRepoEntry({
                id: activeRunId,
                name: stableDisplayName,
                description: stableDescription,
                containerPath: '/data/codeInfo2/codeInfo2',
              }),
              hostPath: '/tmp/codeinfo-host-ingest/codeInfo2/codeInfo2',
            },
          ],
          lockedModelId: 'model',
        }),
        enqueueOrReuseIngestRequest: async (input) => {
          assert.equal(input.canonicalTargetPath, '/data/codeInfo2/codeInfo2');
          assert.equal(input.requestPayload.name, stableDisplayName);
          assert.equal(
            input.requestPayload.path,
            '/tmp/codeinfo-codex-workdir/codeInfo2/codeInfo2',
          );
          assert.equal(input.requestPayload.description, stableDescription);
          assert.equal(input.requestPayload.embeddingProvider, 'lmstudio');
          assert.equal(input.requestPayload.embeddingModel, 'model');
          assert.equal(input.requestPayload.model, 'model');
          return buildQueueResult({
            requestId: 'queue-request-remapped',
            canonicalTargetPath: String(input.canonicalTargetPath),
          });
        },
        pumpIngestQueue: async () => ({
          started: true,
          blockedByCleanup: false,
          requestId: 'queue-request-remapped',
          runId: 'ingest-remapped',
        }),
        waitForQueueRequestTerminalStatus: async () => ({
          reason: 'terminal',
          requestId: 'queue-request-remapped',
          runId: 'ingest-remapped',
          status: buildTerminal('completed'),
          lastKnown: buildTerminal('completed'),
        }),
        appendLog: noopLog,
        waitOptions: { timeoutMs: 5_000 },
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.status, 'completed');
  } finally {
    if (originalHostIngestDir === undefined) {
      delete process.env.CODEINFO_HOST_INGEST_DIR;
    } else {
      process.env.CODEINFO_HOST_INGEST_DIR = originalHostIngestDir;
    }
    if (originalCodexWorkdir === undefined) {
      delete process.env.CODEINFO_CODEX_WORKDIR;
    } else {
      process.env.CODEINFO_CODEX_WORKDIR = originalCodexWorkdir;
    }
  }
});

test('queued reembed requests fall back to the canonical-target basename when no stable display name is available', async () => {
  const originalHostIngestDir = process.env.CODEINFO_HOST_INGEST_DIR;
  const originalCodexWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
  delete process.env.CODEINFO_HOST_INGEST_DIR;
  delete process.env.CODEINFO_CODEX_WORKDIR;

  try {
    const result = await runReingestRepository(
      { sourceId: '/data/repo-a' },
      {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'active-run-456',
              containerPath: '/data/repo-a',
            }),
          ],
          lockedModelId: 'model',
        }),
        enqueueOrReuseIngestRequest: async (input) => {
          assert.equal(input.canonicalTargetPath, '/data/repo-a');
          assert.equal(input.requestPayload.name, 'repo-a');
          assert.equal(input.requestPayload.path, '/data/repo-a');
          return buildQueueResult({
            requestId: 'queue-request-unmapped',
            canonicalTargetPath: String(input.canonicalTargetPath),
          });
        },
        pumpIngestQueue: async () => ({
          started: true,
          blockedByCleanup: false,
          requestId: 'queue-request-unmapped',
          runId: 'ingest-unmapped',
        }),
        waitForQueueRequestTerminalStatus: async () => ({
          reason: 'terminal',
          requestId: 'queue-request-unmapped',
          runId: 'ingest-unmapped',
          status: buildTerminal('completed'),
          lastKnown: buildTerminal('completed'),
        }),
        appendLog: noopLog,
        waitOptions: { timeoutMs: 5_000 },
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.status, 'completed');
  } finally {
    if (originalHostIngestDir === undefined) {
      delete process.env.CODEINFO_HOST_INGEST_DIR;
    } else {
      process.env.CODEINFO_HOST_INGEST_DIR = originalHostIngestDir;
    }
    if (originalCodexWorkdir === undefined) {
      delete process.env.CODEINFO_CODEX_WORKDIR;
    } else {
      process.env.CODEINFO_CODEX_WORKDIR = originalCodexWorkdir;
    }
  }
});

test('queue-aware wait cleanup uses the request identity and preserves timeout errors without dangling listener assumptions', async () => {
  process.env.NODE_ENV = 'test';
  __setQueueRuntimeOpsForTest({
    findQueueRequestById: async () => null,
  });
  useMicrotaskTimeoutMock();

  assert.equal(__getIngestEventListenerCountForTest(), 0);
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitOptions: { timeoutMs: 5 },
    },
  );

  assert.equal(__getIngestEventListenerCountForTest(), 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'error');
  assert.equal(result.value.errorCode, 'WAIT_TIMEOUT');
});

test('queue-aware wait genuine timeout still settles as WAIT_TIMEOUT and unregisters listeners', async () => {
  process.env.NODE_ENV = 'test';
  __setQueueRuntimeOpsForTest({
    findQueueRequestById: async () => null,
  });
  useMicrotaskTimeoutMock();

  assert.equal(__getIngestEventListenerCountForTest(), 0);
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitOptions: { timeoutMs: 5 },
    },
  );

  assert.equal(__getIngestEventListenerCountForTest(), 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'error');
  assert.equal(result.value.errorCode, 'WAIT_TIMEOUT');
});

test('queue-aware wait timeout-fallback read rejection settles as QUEUE_READ_FAILED and unregisters listeners', async () => {
  process.env.NODE_ENV = 'test';
  let readCount = 0;
  __setQueueRuntimeOpsForTest({
    findQueueRequestById: async () => {
      readCount += 1;
      if (readCount === 1) {
        return null;
      }
      throw new Error('queue read failed during timeout fallback');
    },
  });
  useMicrotaskTimeoutMock();

  assert.equal(__getIngestEventListenerCountForTest(), 0);
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitOptions: { timeoutMs: 5 },
    },
  );

  assert.equal(readCount, 2);
  assert.equal(__getIngestEventListenerCountForTest(), 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'error');
  assert.equal(result.value.errorCode, 'QUEUE_READ_FAILED');
});

test('queue-aware wait setup-read rejection settles as QUEUE_READ_FAILED and unregisters listeners', async () => {
  process.env.NODE_ENV = 'test';
  let readCount = 0;
  __setQueueRuntimeOpsForTest({
    findQueueRequestById: async () => {
      readCount += 1;
      if (readCount === 1) {
        throw new Error('queue read failed during waiter setup');
      }
      return null;
    },
  });
  useMicrotaskTimeoutMock();

  assert.equal(__getIngestEventListenerCountForTest(), 0);
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitOptions: { timeoutMs: 5 },
    },
  );

  assert.equal(readCount, 2);
  assert.equal(__getIngestEventListenerCountForTest(), 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'error');
  assert.equal(result.value.errorCode, 'QUEUE_READ_FAILED');
});

test('queue-aware wait observed cancelled terminal state unregisters listeners before returning', async () => {
  process.env.NODE_ENV = 'test';
  __setQueueRuntimeOpsForTest({
    findQueueRequestById: async () =>
      ({
        _id: { toString: () => 'queue-request-123' },
        canonicalTargetPath: '/data/repo-a',
        operation: 'reembed',
        queueState: 'running',
        requestPayload: {},
        runId: 'ingest-123',
      }) as never,
  });
  __setQueueRequestIdForRunForTest('ingest-123', 'queue-request-123');
  __setStatusAndPublishForTest(
    'ingest-123',
    buildTerminal('cancelled', {
      files: 1,
      chunks: 2,
      embedded: 0,
    }),
  );

  assert.equal(__getIngestEventListenerCountForTest(), 0);
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitOptions: { timeoutMs: 5 },
    },
  );

  assert.equal(__getIngestEventListenerCountForTest(), 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'cancelled');
  assert.equal(result.value.errorCode, null);
});

test('queue unavailable maps to the canonical retryable QUEUE_UNAVAILABLE contract', async () => {
  const listIngestedRepositories = async () => ({
    repos: [buildRepoEntry({ id: 'repo-a', containerPath: '/data/repo-a' })],
    lockedModelId: 'model',
  });

  const queueUnavailableResult = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      listIngestedRepositories,
      enqueueOrReuseIngestRequest: async () => {
        const error = new Error(
          'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
        );
        (error as { code?: string }).code = 'QUEUE_UNAVAILABLE';
        throw error;
      },
      appendLog: noopLog,
    },
  );

  assert.equal(queueUnavailableResult.ok, false);
  if (!queueUnavailableResult.ok) {
    assert.equal(queueUnavailableResult.error.code, 503);
    assert.equal(queueUnavailableResult.error.message, 'QUEUE_UNAVAILABLE');
    assert.equal(queueUnavailableResult.error.data.code, 'QUEUE_UNAVAILABLE');
    assert.equal(queueUnavailableResult.error.data.retryable, true);
  }
});

test('pre-run invalid states remain protocol-level INVALID_PARAMS errors', async () => {
  const invalidCodes = [
    'INVALID_REEMBED_STATE',
    'INVALID_LOCK_METADATA',
    'MODEL_LOCKED',
  ];
  for (const code of invalidCodes) {
    const result = await runReingestRepository(
      { sourceId: '/data/repo-a' },
      {
        ...buildDeps(),
        enqueueOrReuseIngestRequest: async () => {
          const error = new Error(String(code));
          (error as { code?: string }).code = String(code);
          throw error;
        },
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.code, -32602);
    assert.equal(result.error.message, 'INVALID_PARAMS');
  }
});

test('selected cancelled and error repositories are rejected before queue admission starts', async () => {
  for (const status of ['cancelled', 'error'] as const) {
    let enqueueCalls = 0;
    const result = await runReingestRepository(
      { sourceId: '/data/repo-a' },
      {
        listIngestedRepositories: async () => ({
          repos: [
            {
              ...buildRepoEntry({
                id: 'repo-a',
                containerPath: '/data/repo-a',
              }),
              status,
              lastError: status === 'error' ? 'boom' : null,
            },
          ],
          lockedModelId: 'model',
        }),
        enqueueOrReuseIngestRequest: async () => {
          enqueueCalls += 1;
          return buildQueueResult({});
        },
        appendLog: noopLog,
      },
    );

    assert.equal(result.ok, false);
    assert.equal(enqueueCalls, 0);
    if (result.ok) continue;
    assert.equal(result.error.code, -32602);
    assert.equal(result.error.message, 'INVALID_PARAMS');
  }
});

test('unknown_root validation failure preserves the strict NOT_FOUND contract', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-missing' },
    {
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry({ containerPath: '/data/repo-a' })],
        lockedModelId: 'model',
      }),
      appendLog: noopLog,
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 404);
  assert.equal(result.error.message, 'NOT_FOUND');
  assert.equal(result.error.data.code, 'NOT_FOUND');
  assert.equal(result.error.data.retryable, true);
  assert.equal(result.error.data.retryMessage.includes('retry'), true);
  assert.equal(result.error.data.fieldErrors[0]?.reason, 'unknown_root');
  assert.equal(
    result.error.data.fieldErrors[0]?.message,
    'sourceId must match an existing ingested repository root exactly',
  );
});

test('retry lists exclude queued start rows that have never produced an ingested root record', async () => {
  let enqueueCalls = 0;
  const result = await runReingestRepository(
    { sourceId: '/data/queued-only' },
    {
      listIngestedRepositories: async () => ({
        repos: [
          buildRepoEntry({
            id: 'queued-only',
            containerPath: '/data/queued-only',
            lastIngestAt: null,
          }),
          buildRepoEntry({
            id: 'repo-a',
            containerPath: '/data/repo-a',
          }),
        ],
        lockedModelId: 'model',
      }),
      enqueueOrReuseIngestRequest: async () => {
        enqueueCalls += 1;
        return buildQueueResult({});
      },
      appendLog: noopLog,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(enqueueCalls, 0);
  if (result.ok) return;
  assert.equal(result.error.code, 404);
  assert.equal(result.error.message, 'NOT_FOUND');
  assert.deepEqual(result.error.data.reingestableRepositoryIds, ['repo-a']);
  assert.deepEqual(result.error.data.reingestableSourceIds, ['/data/repo-a']);
  assert.equal(result.error.data.fieldErrors[0]?.reason, 'unknown_root');
});

test('invalid_state validation failure preserves the strict INVALID_PARAMS contract', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a', wait: true },
    {
      ...buildDeps(),
      appendLog: noopLog,
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, -32602);
  assert.equal(result.error.message, 'INVALID_PARAMS');
  assert.equal(result.error.data.code, 'INVALID_SOURCE_ID');
  assert.equal(result.error.data.retryable, true);
  assert.equal(result.error.data.retryMessage.includes('retry'), true);
  assert.equal(result.error.data.fieldErrors[0]?.reason, 'invalid_state');
  assert.equal(
    result.error.data.fieldErrors[0]?.message,
    'Unsupported arguments for reingest_repository: wait',
  );
});

test('success result contract omits top-level message field', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'terminal',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: buildTerminal('completed'),
        lastKnown: buildTerminal('completed'),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const payload = result.value as ReingestSuccess & { message?: unknown };
  assert.equal(Object.hasOwn(payload, 'message'), false);
});

test('no-change terminal completed payload remains external completed with zero counters', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForQueueRequestTerminalStatus: async () => ({
        reason: 'terminal',
        requestId: 'queue-request-123',
        runId: 'ingest-123',
        status: buildTerminal('completed', {
          files: 0,
          chunks: 0,
          embedded: 0,
        }),
        lastKnown: buildTerminal('completed', {
          files: 0,
          chunks: 0,
          embedded: 0,
        }),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'completed');
  assert.equal(result.value.completionMode, 'reingested');
  assert.equal(result.value.files, 0);
  assert.equal(result.value.chunks, 0);
  assert.equal(result.value.embedded, 0);
  assert.equal(result.value.errorCode, null);
});
