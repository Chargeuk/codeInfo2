import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { afterEach, describe, test } from 'node:test';

import { resolvePlanScopeRepositories } from '../../ingest/planScopeResolver.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { append, query, resetStore } from '../../logStore.js';
import { createPlanScopeFixture } from '../support/planScopeFixture.js';

function buildRepoEntry(params: {
  id: string;
  containerPath: string;
  hostPath?: string;
}): RepoEntry {
  return {
    id: params.id,
    description: null,
    containerPath: params.containerPath,
    hostPath: params.hostPath ?? params.containerPath,
    lastIngestAt: '2026-03-26T00:00:00.000Z',
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

describe('resolvePlanScopeRepositories', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    resetStore();
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  test('falls back with warnings when the handoff is missing, unreadable, or malformed', async () => {
    const missingFixture = await createPlanScopeFixture({
      planFile: { mode: 'missing' },
    });
    const unreadableFixture = await createPlanScopeFixture({
      planFile: { mode: 'unreadable' },
    });
    const malformedFixture = await createPlanScopeFixture({
      planFile: {
        mode: 'malformed',
        rawText: '{"additional_repositories": [',
      },
    });
    cleanups.push(
      missingFixture.cleanup,
      unreadableFixture.cleanup,
      malformedFixture.cleanup,
    );

    const missingResult = await resolvePlanScopeRepositories({
      workingRepositoryPath: missingFixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'working-repo',
              containerPath: missingFixture.workingRepositoryPath,
            }),
          ],
          lockedModelId: 'model',
        }),
        appendLog: append,
      },
    });
    assert.deepEqual(missingResult.repositories, [
      {
        sourceId: missingFixture.workingRepositoryPath,
        resolvedRepositoryId: 'working-repo',
      },
    ]);
    assert.equal(missingResult.warnings[0]?.code, 'handoff_missing');

    const unreadableResult = await resolvePlanScopeRepositories({
      workingRepositoryPath: unreadableFixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'working-repo',
              containerPath: unreadableFixture.workingRepositoryPath,
            }),
          ],
          lockedModelId: 'model',
        }),
        appendLog: append,
      },
    });
    assert.equal(unreadableResult.repositories.length, 1);
    assert.equal(unreadableResult.warnings[0]?.code, 'handoff_invalid');

    const malformedResult = await resolvePlanScopeRepositories({
      workingRepositoryPath: malformedFixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'working-repo',
              containerPath: malformedFixture.workingRepositoryPath,
            }),
          ],
          lockedModelId: 'model',
        }),
        appendLog: append,
      },
    });
    assert.equal(malformedResult.repositories.length, 1);
    assert.equal(malformedResult.warnings[0]?.code, 'handoff_invalid');
  });

  test('keeps the working repository first, ignores unrelated handoff fields, and treats empty additional_repositories as a clean working-only path', async () => {
    const workingOnlyFixture = await createPlanScopeFixture({
      additionalRepositories: [{ name: 'repo-a' }],
      planFile: {
        mode: 'valid',
        additionalRepositoryPaths: [],
        extraFields: {
          plan_path: 'planning/should-be-ignored.md',
          branched_from: 'feature/ignored',
          note: 'ignored',
        },
      },
    });
    cleanups.push(workingOnlyFixture.cleanup);

    const workingOnlyResult = await resolvePlanScopeRepositories({
      workingRepositoryPath: workingOnlyFixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'working-repo',
              containerPath: workingOnlyFixture.workingRepositoryPath,
            }),
            buildRepoEntry({
              id: 'repo-a',
              containerPath: workingOnlyFixture.additionalRepositoryPaths[0]!,
            }),
          ],
          lockedModelId: 'model',
        }),
        appendLog: append,
      },
    });

    assert.deepEqual(workingOnlyResult.repositories, [
      {
        sourceId: workingOnlyFixture.workingRepositoryPath,
        resolvedRepositoryId: 'working-repo',
      },
    ]);
    assert.deepEqual(workingOnlyResult.warnings, []);
  });

  test('uses first-seen ordering and surfaces duplicate or unusable additional repositories as repository_skipped warnings', async () => {
    const fixture = await createPlanScopeFixture({
      additionalRepositories: [
        { name: 'repo-a' },
        { name: 'repo-b' },
        { name: 'missing-repo', create: false },
      ],
    });
    cleanups.push(fixture.cleanup);

    const repoAPath = fixture.additionalRepositoryPaths[0]!;
    const repoBPath = fixture.additionalRepositoryPaths[1]!;
    const missingRepoPath = fixture.additionalRepositoryPaths[2]!;
    await fs.writeFile(
      fixture.currentPlanPath,
      JSON.stringify(
        {
          plan_path: 'planning/ignored.md',
          branched_from: 'feature/ignored',
          additional_repositories: [
            { path: fixture.workingRepositoryPath },
            { path: repoAPath },
            { path: repoAPath },
            { path: repoBPath },
            { path: missingRepoPath },
          ],
          note: 'ignored-by-runtime',
        },
        null,
        2,
      ),
    );

    const result = await resolvePlanScopeRepositories({
      workingRepositoryPath: fixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'working-repo',
              containerPath: fixture.workingRepositoryPath,
            }),
            buildRepoEntry({
              id: 'repo-a',
              containerPath: repoAPath,
            }),
            buildRepoEntry({
              id: 'repo-b',
              containerPath: repoBPath,
            }),
          ],
          lockedModelId: 'model',
        }),
        appendLog: append,
      },
    });

    assert.deepEqual(result.repositories, [
      {
        sourceId: fixture.workingRepositoryPath,
        resolvedRepositoryId: 'working-repo',
      },
      {
        sourceId: repoAPath,
        resolvedRepositoryId: 'repo-a',
      },
      {
        sourceId: repoBPath,
        resolvedRepositoryId: 'repo-b',
      },
    ]);
    assert.deepEqual(
      result.warnings.map((warning) => warning.code),
      ['repository_skipped', 'repository_skipped', 'repository_skipped'],
    );
    assert.equal(
      result.warnings[0]?.repositoryPath,
      fixture.workingRepositoryPath,
    );
    assert.equal(result.warnings[1]?.repositoryPath, repoAPath);
    assert.equal(result.warnings[2]?.repositoryPath, missingRepoPath);
  });

  test('treats invalid additional_repositories content as a handoff_invalid working-only fallback', async () => {
    const fixture = await createPlanScopeFixture({
      planFile: {
        mode: 'invalid_additional_repositories',
        additionalRepositoriesValue: { path: 'not-an-array' },
      },
    });
    cleanups.push(fixture.cleanup);

    const result = await resolvePlanScopeRepositories({
      workingRepositoryPath: fixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'working-repo',
              containerPath: fixture.workingRepositoryPath,
            }),
          ],
          lockedModelId: 'model',
        }),
        appendLog: append,
      },
    });

    assert.deepEqual(result.repositories, [
      {
        sourceId: fixture.workingRepositoryPath,
        resolvedRepositoryId: 'working-repo',
      },
    ]);
    assert.deepEqual(
      result.warnings.map((warning) => warning.code),
      ['handoff_invalid'],
    );
  });

  test('emits the resolver proof marker for both clean and warning-producing outcomes', async () => {
    const cleanFixture = await createPlanScopeFixture({
      planFile: {
        mode: 'valid',
        additionalRepositoryPaths: [],
      },
    });
    const warningFixture = await createPlanScopeFixture({
      planFile: { mode: 'missing' },
    });
    cleanups.push(cleanFixture.cleanup, warningFixture.cleanup);

    for (const fixture of [cleanFixture, warningFixture]) {
      await resolvePlanScopeRepositories({
        workingRepositoryPath: fixture.workingRepositoryPath,
        deps: {
          listIngestedRepositories: async () => ({
            repos: [
              buildRepoEntry({
                id: pathBasename(fixture.workingRepositoryPath),
                containerPath: fixture.workingRepositoryPath,
              }),
            ],
            lockedModelId: 'model',
          }),
          appendLog: append,
        },
      });
    }

    const logs = query({ text: 'DEV-0000052:T3:plan-scope-resolver' });
    assert.equal(logs.length, 2);
    assert.deepEqual(
      logs.map((entry) => entry.context?.outcome),
      ['working_only_clean', 'working_or_handoff_warning'],
    );
  });
});

function pathBasename(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) ?? 'repo';
}
