import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runReingestRepository,
  type ReingestSuccess,
} from '../../ingest/reingestService.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';

const noopLog = () => undefined;

const buildRepoEntry = (params: {
  id?: string;
  containerPath: string;
}): RepoEntry => ({
  id: params.id ?? 'repo-a',
  description: null,
  containerPath: params.containerPath,
  hostPath: `/host${params.containerPath}`,
  lastIngestAt: null,
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
  isBusy: () => false,
  reembed: async () => 'ingest-123',
  appendLog: noopLog,
});

test('blocking success returns completed terminal payload with required fields', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForTerminalIngestStatus: async () => ({
        reason: 'terminal',
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

test('internal skipped maps to completed with skipped completionMode', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForTerminalIngestStatus: async () => ({
        reason: 'terminal',
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
      waitForTerminalIngestStatus: async () => ({
        reason: 'terminal',
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
      waitForTerminalIngestStatus: async () => ({
        reason: 'terminal',
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
      waitForTerminalIngestStatus: async () => ({
        reason: 'timeout',
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

test('missing run status after start returns deterministic terminal error payload', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      ...buildDeps(),
      waitForTerminalIngestStatus: async () => ({
        reason: 'missing',
        status: null,
        lastKnown: null,
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, 'error');
  assert.equal(result.value.completionMode, null);
  assert.equal(result.value.errorCode, 'RUN_STATUS_MISSING');
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
      isBusy: () => false,
      reembed: async () => 'unused',
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
      isBusy: () => false,
      reembed: async () => 'unused',
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
      isBusy: () => false,
      reembed: async () => 'unused',
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
      waitForTerminalIngestStatus: async () => ({
        reason: 'terminal',
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
      isBusy: () => false,
      reembed: async () => 'unused',
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
      waitForTerminalIngestStatus: async () => ({
        reason: 'terminal',
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
      waitForTerminalIngestStatus: async () => ({
        reason: 'terminal',
        status: buildTerminal('completed'),
        lastKnown: buildTerminal('completed'),
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.resolvedRepositoryId, null);
});

test('busy maps to canonical BUSY contract from lock and reembed', async () => {
  const listIngestedRepositories = async () => ({
    repos: [buildRepoEntry({ id: 'repo-a', containerPath: '/data/repo-a' })],
    lockedModelId: 'model',
  });

  const lockResult = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      listIngestedRepositories,
      isBusy: () => true,
      reembed: async () => 'unused',
      appendLog: noopLog,
    },
  );

  assert.equal(lockResult.ok, false);
  if (!lockResult.ok) {
    assert.equal(lockResult.error.code, 429);
    assert.equal(lockResult.error.message, 'BUSY');
    assert.equal(lockResult.error.data.code, 'BUSY');
    assert.equal(lockResult.error.data.fieldErrors[0]?.reason, 'busy');
  }

  const reembedBusyResult = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      listIngestedRepositories,
      isBusy: () => false,
      reembed: async () => {
        const error = new Error('BUSY');
        (error as { code?: string }).code = 'BUSY';
        throw error;
      },
      appendLog: noopLog,
    },
  );

  assert.equal(reembedBusyResult.ok, false);
  if (!reembedBusyResult.ok) {
    assert.equal(reembedBusyResult.error.code, 429);
    assert.equal(reembedBusyResult.error.message, 'BUSY');
    assert.equal(reembedBusyResult.error.data.code, 'BUSY');
  }
});

test('busy validation failure preserves the strict BUSY contract', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry({ containerPath: '/data/repo-a' })],
        lockedModelId: 'model',
      }),
      isBusy: () => true,
      reembed: async () => 'unused',
      appendLog: noopLog,
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 429);
  assert.equal(result.error.message, 'BUSY');
  assert.equal(result.error.data.code, 'BUSY');
  assert.equal(result.error.data.retryable, true);
  assert.equal(result.error.data.retryMessage.includes('retry'), true);
  assert.equal(result.error.data.fieldErrors[0]?.reason, 'busy');
  assert.equal(
    result.error.data.fieldErrors[0]?.message,
    'reingest is currently locked by another ingest operation',
  );
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
        reembed: async () => {
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

test('unknown_root validation failure preserves the strict NOT_FOUND contract', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-missing' },
    {
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry({ containerPath: '/data/repo-a' })],
        lockedModelId: 'model',
      }),
      isBusy: () => false,
      reembed: async () => 'unused',
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
      waitForTerminalIngestStatus: async () => ({
        reason: 'terminal',
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
      waitForTerminalIngestStatus: async () => ({
        reason: 'terminal',
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
