import assert from 'node:assert/strict';
import test from 'node:test';

import { executeReingestRequest } from '../../ingest/reingestExecution.js';
import { runReingestRepository } from '../../ingest/reingestService.js';
import { append } from '../../logStore.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';

const noopLog = (entry: Parameters<typeof append>[0]) => entry;

function buildRepoEntry(params: {
  id: string;
  containerPath: string;
  hostPath?: string;
  lastIngestAt?: string | null;
}): RepoEntry {
  return {
    id: params.id,
    description: null,
    containerPath: params.containerPath,
    hostPath: params.hostPath ?? `/host${params.containerPath}`,
    lastIngestAt: params.lastIngestAt ?? null,
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
    counts: { files: 1, chunks: 2, embedded: 2 },
    lastError: null,
  };
}

test('executeReingestRequest canonicalizes valid selectors to the canonical container path', async () => {
  let capturedSourceId: string | undefined;
  const result = await executeReingestRequest({
    request: { sourceId: '/host/repo-a' },
    surface: 'command',
    deps: {
      listIngestedRepositories: async () => ({
        repos: [
          buildRepoEntry({
            id: 'Repo A',
            containerPath: '/data/repo-a',
            hostPath: '/host/repo-a',
          }),
        ],
        lockedModelId: 'model',
      }),
      runReingestRepository: async ({ sourceId }) => {
        capturedSourceId = sourceId;
        return {
          ok: true,
          value: {
            status: 'completed',
            operation: 'reembed',
            runId: 'run-123',
            sourceId: sourceId ?? '/missing',
            resolvedRepositoryId: 'Repo A',
            completionMode: 'reingested',
            durationMs: 12,
            files: 1,
            chunks: 2,
            embedded: 2,
            errorCode: null,
          },
        };
      },
      appendLog: noopLog,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(capturedSourceId, '/data/repo-a');
  if (!result.ok) return;
  assert.equal(result.value.requestedSelector, '/host/repo-a');
  assert.equal(result.value.resolvedSourceId, '/data/repo-a');
});

test('executeReingestRequest keeps unresolved selectors on the strict invalid-input path when lookup succeeds honestly', async () => {
  const listIngestedRepositories = async () => ({
    repos: [buildRepoEntry({ id: 'Repo A', containerPath: '/data/repo-a' })],
    lockedModelId: 'model',
  });

  const result = await executeReingestRequest({
    request: { sourceId: '/host/missing' },
    surface: 'command',
    deps: {
      listIngestedRepositories,
      runReingestRepository: (args) =>
        runReingestRepository(args, {
          listIngestedRepositories,
          isBusy: () => false,
          appendLog: noopLog,
        }),
      appendLog: noopLog,
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.data.code, 'INVALID_SOURCE_ID');
  assert.equal(result.error.data.fieldErrors[0]?.reason, 'non_absolute');
});

test('executeReingestRequest surfaces selector-listing failures for sourceId, current, and all without INVALID_SOURCE_ID fallback', async () => {
  const outage = new Error('ingested repository listing unavailable');
  const listIngestedRepositories = async () => {
    throw outage;
  };

  for (const request of [
    { sourceId: 'Repo A' } as const,
    { target: 'current' } as const,
    { target: 'all' } as const,
  ]) {
    await assert.rejects(
      async () =>
        executeReingestRequest({
          request,
          surface: 'command',
          currentOwnerSourceId: '/data/repo-a',
          deps: {
            listIngestedRepositories,
            appendLog: noopLog,
          },
        }),
      (error) => error === outage,
    );
  }
});
