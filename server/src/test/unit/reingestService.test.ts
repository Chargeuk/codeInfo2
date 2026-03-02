import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runReingestRepository,
  type ReingestSuccess,
} from '../../ingest/reingestService.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';

const noopLog = () => undefined;

const buildRepoEntry = (params: {
  id: string;
  containerPath: string;
}): RepoEntry => ({
  id: params.id,
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
  assert.equal(typeof payload.durationMs, 'number');
  assert.equal(payload.durationMs >= 0, true);
  assert.equal(typeof payload.files, 'number');
  assert.equal(typeof payload.chunks, 'number');
  assert.equal(typeof payload.embedded, 'number');
  assert.equal(payload.errorCode, null);
});

test('internal skipped maps to completed', async () => {
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
  assert.equal(result.value.errorCode, null);
});

test('cancelled returns last-known counters and errorCode null', async () => {
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
  assert.equal(result.value.files, counts.files);
  assert.equal(result.value.chunks, counts.chunks);
  assert.equal(result.value.embedded, counts.embedded);
  assert.equal(result.value.errorCode, null);
});

test('terminal error contract includes non-null errorCode and full field set', async () => {
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
  assert.equal(result.value.errorCode, 'RUN_STATUS_MISSING');
});

test('invalid sourceId reason branches map to INVALID_PARAMS', async () => {
  const listIngestedRepositories = async () => ({
    repos: [buildRepoEntry({ id: 'repo-a', containerPath: '/data/repo-a' })],
    lockedModelId: 'model',
  });

  const cases: Array<{ name: string; args: unknown; reason: string }> = [
    { name: 'missing', args: {}, reason: 'missing' },
    { name: 'non-string', args: { sourceId: 1 }, reason: 'non_string' },
    { name: 'empty', args: { sourceId: '   ' }, reason: 'empty' },
    {
      name: 'non-absolute',
      args: { sourceId: 'repo-a' },
      reason: 'non_absolute',
    },
    {
      name: 'non-normalized',
      args: { sourceId: '/data/repo-a//src' },
      reason: 'non_normalized',
    },
    {
      name: 'ambiguous path',
      args: { sourceId: '/data\\repo-a' },
      reason: 'ambiguous_path',
    },
  ];

  for (const c of cases) {
    const result = await runReingestRepository(c.args, {
      listIngestedRepositories,
      isBusy: () => false,
      reembed: async () => 'unused',
      appendLog: noopLog,
    });

    assert.equal(result.ok, false, c.name);
    if (result.ok) continue;
    assert.equal(result.error.code, -32602, c.name);
    assert.equal(result.error.message, 'INVALID_PARAMS', c.name);
    assert.equal(result.error.data.code, 'INVALID_SOURCE_ID', c.name);
    assert.equal(result.error.data.fieldErrors[0]?.reason, c.reason, c.name);
  }
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
