import assert from 'node:assert/strict';
import test from 'node:test';

import { runReingestRepository } from '../../ingest/reingestService.js';
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

test('success branch returns canonical payload', async () => {
  const result = await runReingestRepository(
    { sourceId: '/data/repo-a' },
    {
      listIngestedRepositories: async () => ({
        repos: [
          buildRepoEntry({ id: 'repo-a', containerPath: '/data/repo-a' }),
        ],
        lockedModelId: 'model',
      }),
      isBusy: () => false,
      reembed: async () => 'ingest-123',
      appendLog: noopLog,
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    status: 'started',
    operation: 'reembed',
    runId: 'ingest-123',
    sourceId: '/data/repo-a',
  });
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
