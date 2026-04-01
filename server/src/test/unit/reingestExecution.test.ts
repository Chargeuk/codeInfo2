import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test, { afterEach, describe } from 'node:test';

import { executeReingestRequest } from '../../ingest/reingestExecution.js';
import { runReingestRepository } from '../../ingest/reingestService.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { append, query, resetStore } from '../../logStore.js';
import { createPlanScopeFixture } from '../support/planScopeFixture.js';

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

function buildReingestSuccess(params: {
  sourceId: string;
  resolvedRepositoryId: string | null;
  completionMode?: 'reingested' | 'skipped' | null;
  status?: 'completed' | 'cancelled' | 'error';
  errorCode?: string | null;
}) {
  return {
    status: params.status ?? ('completed' as const),
    operation: 'reembed' as const,
    runId: `run:${params.sourceId}`,
    sourceId: params.sourceId,
    resolvedRepositoryId: params.resolvedRepositoryId,
    completionMode: params.completionMode ?? 'reingested',
    durationMs: 12,
    files: 1,
    chunks: 2,
    embedded: 2,
    errorCode: params.errorCode ?? null,
  };
}

describe('executeReingestRequest', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    resetStore();
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  test('canonicalizes valid selectors to the canonical container path', async () => {
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
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId: 'Repo A',
            }),
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

  test('keeps unresolved selectors on the strict invalid-input path when lookup succeeds honestly', async () => {
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
            appendLog: noopLog,
          }),
        appendLog: noopLog,
      },
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.data.code, 'NOT_FOUND');
    assert.equal(result.error.data.fieldErrors[0]?.reason, 'unknown_root');
  });

  test('surfaces selector-listing failures for sourceId, working, and plan_scope without INVALID_SOURCE_ID fallback', async () => {
    const outage = new Error('ingested repository listing unavailable');
    const listIngestedRepositories = async () => {
      throw outage;
    };

    for (const request of [
      { sourceId: 'Repo A' } as const,
      { target: 'working' } as const,
      { target: 'plan_scope' } as const,
    ]) {
      await assert.rejects(
        async () =>
          executeReingestRequest({
            request,
            surface: 'command',
            workingRepositoryPath: '/data/repo-a',
            deps: {
              listIngestedRepositories,
              appendLog: noopLog,
            },
          }),
        (error) => error === outage,
      );
    }
  });

  test('working target resolves the selected working repository and completes as a single execution result', async () => {
    let capturedSourceId: string | undefined;
    const result = await executeReingestRequest({
      request: { target: 'working' },
      surface: 'command',
      workingRepositoryPath: '/host/repo-a',
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
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId: 'Repo A',
            }),
          };
        },
        appendLog: append,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(capturedSourceId, '/data/repo-a');
    if (!result.ok) return;
    assert.equal(result.value.kind, 'single');
    assert.equal(result.value.targetMode, 'working');
    assert.equal(result.value.resolvedSourceId, '/data/repo-a');
  });

  test('working and plan_scope reuse a request-scoped ingested repository listing snapshot', async () => {
    const workingFixture = await createPlanScopeFixture();
    const planScopeFixture = await createPlanScopeFixture({
      additionalRepositories: [{ name: 'repo-a' }],
    });
    cleanups.push(workingFixture.cleanup, planScopeFixture.cleanup);

    let workingListCalls = 0;
    const workingResult = await executeReingestRequest({
      request: { target: 'working' },
      surface: 'command',
      workingRepositoryPath: workingFixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => {
          workingListCalls += 1;
          return {
            repos: [
              buildRepoEntry({
                id: 'working-repo',
                containerPath: workingFixture.workingRepositoryPath,
                hostPath: workingFixture.workingRepositoryPath,
              }),
            ],
            lockedModelId: 'model',
          };
        },
        runReingestRepository: async ({ sourceId }) => ({
          ok: true,
          value: buildReingestSuccess({
            sourceId: sourceId ?? '/missing',
            resolvedRepositoryId: 'working-repo',
          }),
        }),
        appendLog: noopLog,
      },
    });

    let planScopeListCalls = 0;
    const planScopeResult = await executeReingestRequest({
      request: { target: 'plan_scope' },
      surface: 'command',
      workingRepositoryPath: planScopeFixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => {
          planScopeListCalls += 1;
          return {
            repos: [
              buildRepoEntry({
                id: 'working-repo',
                containerPath: planScopeFixture.workingRepositoryPath,
                hostPath: planScopeFixture.workingRepositoryPath,
              }),
              buildRepoEntry({
                id: 'repo-a',
                containerPath: planScopeFixture.additionalRepositoryPaths[0]!,
                hostPath: planScopeFixture.additionalRepositoryPaths[0]!,
              }),
            ],
            lockedModelId: 'model',
          };
        },
        runReingestRepository: async ({ sourceId }) => ({
          ok: true,
          value: buildReingestSuccess({
            sourceId: sourceId ?? '/missing',
            resolvedRepositoryId:
              sourceId === planScopeFixture.workingRepositoryPath
                ? 'working-repo'
                : 'repo-a',
          }),
        }),
        appendLog: noopLog,
      },
    });

    assert.equal(workingResult.ok, true);
    assert.equal(planScopeResult.ok, true);
    assert.equal(workingListCalls, 1);
    assert.equal(planScopeListCalls, 1);
  });

  test('working and plan_scope fail before start when the working repository path is missing or not currently ingested', async () => {
    const listIngestedRepositories = async () => ({
      repos: [buildRepoEntry({ id: 'Repo A', containerPath: '/data/repo-a' })],
      lockedModelId: 'model',
    });

    for (const target of ['working', 'plan_scope'] as const) {
      const missingPathResult = await executeReingestRequest({
        request: { target },
        surface: 'command',
        deps: {
          listIngestedRepositories,
          appendLog: noopLog,
        },
      });
      assert.equal(missingPathResult.ok, false);
      if (missingPathResult.ok) continue;
      assert.equal(
        missingPathResult.error.data.fieldErrors[0]?.reason,
        'invalid_state',
      );

      let resolverCalls = 0;
      const missingIngestResult = await executeReingestRequest({
        request: { target },
        surface: 'command',
        workingRepositoryPath: '/host/missing',
        deps: {
          listIngestedRepositories,
          resolvePlanScopeRepositories: async () => {
            resolverCalls += 1;
            return { repositories: [], warnings: [] };
          },
          appendLog: noopLog,
        },
      });
      assert.equal(missingIngestResult.ok, false);
      if (!missingIngestResult.ok) {
        assert.equal(missingIngestResult.error.data.code, 'NOT_FOUND');
        assert.equal(
          missingIngestResult.error.data.fieldErrors[0]?.reason,
          'unknown_root',
        );
      }
      assert.equal(resolverCalls, 0);
    }
  });

  test('plan_scope passes the resolved working repository sourceId into the resolver instead of the raw working-folder path', async () => {
    let resolverWorkingRepositoryPath: string | undefined;
    let capturedSourceId: string | undefined;

    const result = await executeReingestRequest({
      request: { target: 'plan_scope' },
      surface: 'command',
      workingRepositoryPath: '/host/repo-a',
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
        resolvePlanScopeRepositories: async ({ workingRepositoryPath }) => {
          resolverWorkingRepositoryPath = workingRepositoryPath;
          return {
            repositories: [
              {
                sourceId: '/data/repo-a',
                resolvedRepositoryId: 'Repo A',
              },
            ],
            warnings: [],
          };
        },
        runReingestRepository: async ({ sourceId }) => {
          capturedSourceId = sourceId;
          return {
            ok: true,
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId: 'Repo A',
            }),
          };
        },
        appendLog: noopLog,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(resolverWorkingRepositoryPath, '/data/repo-a');
    assert.equal(capturedSourceId, '/data/repo-a');
  });

  test('plan_scope uses working-first ordering, file-order additional repositories, and first-seen de-duplication', async () => {
    const fixture = await createPlanScopeFixture({
      additionalRepositories: [{ name: 'repo-a' }, { name: 'repo-b' }],
      planFile: {
        mode: 'valid',
        additionalRepositoryPaths: [],
      },
    });
    cleanups.push(fixture.cleanup);

    await fs.writeFile(
      fixture.currentPlanPath,
      JSON.stringify(
        {
          plan_path: 'planning/ignored.md',
          branched_from: 'feature/ignored',
          additional_repositories: [
            { path: fixture.additionalRepositoryPaths[0] },
            { path: fixture.workingRepositoryPath },
            { path: fixture.additionalRepositoryPaths[0] },
            { path: fixture.additionalRepositoryPaths[1] },
          ],
        },
        null,
        2,
      ),
    );

    const calls: string[] = [];
    const result = await executeReingestRequest({
      request: { target: 'plan_scope' },
      surface: 'command',
      workingRepositoryPath: fixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'working-repo',
              containerPath: fixture.workingRepositoryPath,
              hostPath: fixture.workingRepositoryPath,
            }),
            buildRepoEntry({
              id: 'repo-a',
              containerPath: fixture.additionalRepositoryPaths[0]!,
              hostPath: fixture.additionalRepositoryPaths[0]!,
            }),
            buildRepoEntry({
              id: 'repo-b',
              containerPath: fixture.additionalRepositoryPaths[1]!,
              hostPath: fixture.additionalRepositoryPaths[1]!,
            }),
          ],
          lockedModelId: 'model',
        }),
        runReingestRepository: async ({ sourceId }) => {
          calls.push(sourceId ?? '(missing)');
          return {
            ok: true,
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId:
                sourceId === fixture.workingRepositoryPath
                  ? 'working-repo'
                  : sourceId === fixture.additionalRepositoryPaths[0]
                    ? 'repo-a'
                    : 'repo-b',
            }),
          };
        },
        appendLog: append,
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.kind, 'batch');
    assert.deepEqual(calls, [
      fixture.workingRepositoryPath,
      fixture.additionalRepositoryPaths[0],
      fixture.additionalRepositoryPaths[1],
    ]);
    assert.deepEqual(result.value.summary, {
      reingested: 3,
      skipped: 0,
      failed: 0,
    });
    assert.deepEqual(
      result.value.warnings.map((warning) => warning.code),
      ['repository_skipped', 'repository_skipped'],
    );
  });

  test('plan_scope handoff fallback cases resolve to working-only execution with the expected warning behavior', async () => {
    const missingFixture = await createPlanScopeFixture({
      planFile: { mode: 'missing' },
    });
    const malformedFixture = await createPlanScopeFixture({
      planFile: { mode: 'malformed' },
    });
    const unreadableFixture = await createPlanScopeFixture({
      planFile: { mode: 'unreadable' },
    });
    const invalidFixture = await createPlanScopeFixture({
      planFile: {
        mode: 'invalid_additional_repositories',
        additionalRepositoriesValue: { path: 'not-an-array' },
      },
    });
    const cleanFixture = await createPlanScopeFixture({
      planFile: {
        mode: 'valid',
        additionalRepositoryPaths: [],
      },
    });
    cleanups.push(
      missingFixture.cleanup,
      malformedFixture.cleanup,
      unreadableFixture.cleanup,
      invalidFixture.cleanup,
      cleanFixture.cleanup,
    );

    const cases = [
      { fixture: missingFixture, warningCodes: ['handoff_missing'] },
      { fixture: malformedFixture, warningCodes: ['handoff_invalid'] },
      { fixture: unreadableFixture, warningCodes: ['handoff_invalid'] },
      { fixture: invalidFixture, warningCodes: ['handoff_invalid'] },
      { fixture: cleanFixture, warningCodes: [] },
    ];

    for (const testCase of cases) {
      let calls = 0;
      const result = await executeReingestRequest({
        request: { target: 'plan_scope' },
        surface: 'command',
        workingRepositoryPath: testCase.fixture.workingRepositoryPath,
        deps: {
          listIngestedRepositories: async () => ({
            repos: [
              buildRepoEntry({
                id: 'working-repo',
                containerPath: testCase.fixture.workingRepositoryPath,
                hostPath: testCase.fixture.workingRepositoryPath,
              }),
            ],
            lockedModelId: 'model',
          }),
          runReingestRepository: async ({ sourceId }) => {
            calls += 1;
            return {
              ok: true,
              value: buildReingestSuccess({
                sourceId: sourceId ?? '/missing',
                resolvedRepositoryId: 'working-repo',
              }),
            };
          },
          appendLog: noopLog,
        },
      });

      assert.equal(result.ok, true);
      if (!result.ok) continue;
      assert.equal(result.value.kind, 'batch');
      assert.equal(calls, 1);
      assert.deepEqual(
        result.value.warnings.map((warning) => warning.code),
        testCase.warningCodes,
      );
      assert.deepEqual(result.value.summary, {
        reingested: 1,
        skipped: 0,
        failed: 0,
      });
    }
  });

  test('plan_scope skips invalid additional repositories before execution and excludes them from attempted repositories and summary counts', async () => {
    const fixture = await createPlanScopeFixture({
      additionalRepositories: [
        { name: 'repo-a' },
        { name: 'missing-repo', create: false },
        { name: 'not-ingested' },
      ],
    });
    cleanups.push(fixture.cleanup);

    await fs.writeFile(
      fixture.currentPlanPath,
      JSON.stringify(
        {
          additional_repositories: [
            { path: fixture.additionalRepositoryPaths[0] },
            { path: fixture.additionalRepositoryPaths[1] },
            { path: fixture.additionalRepositoryPaths[2] },
          ],
        },
        null,
        2,
      ),
    );

    const calls: string[] = [];
    const result = await executeReingestRequest({
      request: { target: 'plan_scope' },
      surface: 'command',
      workingRepositoryPath: fixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'working-repo',
              containerPath: fixture.workingRepositoryPath,
              hostPath: fixture.workingRepositoryPath,
            }),
            buildRepoEntry({
              id: 'repo-a',
              containerPath: fixture.additionalRepositoryPaths[0]!,
              hostPath: fixture.additionalRepositoryPaths[0]!,
            }),
          ],
          lockedModelId: 'model',
        }),
        runReingestRepository: async ({ sourceId }) => {
          calls.push(sourceId ?? '(missing)');
          return {
            ok: true,
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId:
                sourceId === fixture.workingRepositoryPath
                  ? 'working-repo'
                  : 'repo-a',
            }),
          };
        },
        appendLog: noopLog,
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.kind, 'batch');
    assert.deepEqual(calls, [
      fixture.workingRepositoryPath,
      fixture.additionalRepositoryPaths[0],
    ]);
    assert.equal(result.value.repositories.length, 2);
    assert.deepEqual(result.value.summary, {
      reingested: 2,
      skipped: 0,
      failed: 0,
    });
    assert.deepEqual(
      result.value.warnings.map((warning) => warning.code),
      ['repository_skipped', 'repository_skipped'],
    );
  });

  test('plan_scope records repository_failed warnings, continues after failures, and returns a completed batch payload', async () => {
    const fixture = await createPlanScopeFixture({
      additionalRepositories: [{ name: 'repo-a' }, { name: 'repo-b' }],
    });
    cleanups.push(fixture.cleanup);

    const calls: string[] = [];
    const result = await executeReingestRequest({
      request: { target: 'plan_scope' },
      surface: 'command',
      workingRepositoryPath: fixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'working-repo',
              containerPath: fixture.workingRepositoryPath,
              hostPath: fixture.workingRepositoryPath,
            }),
            buildRepoEntry({
              id: 'repo-a',
              containerPath: fixture.additionalRepositoryPaths[0]!,
              hostPath: fixture.additionalRepositoryPaths[0]!,
            }),
            buildRepoEntry({
              id: 'repo-b',
              containerPath: fixture.additionalRepositoryPaths[1]!,
              hostPath: fixture.additionalRepositoryPaths[1]!,
            }),
          ],
          lockedModelId: 'model',
        }),
        runReingestRepository: async ({ sourceId }) => {
          calls.push(sourceId ?? '(missing)');
          if (sourceId === fixture.additionalRepositoryPaths[0]) {
            return {
              ok: false,
              error: {
                code: 429,
                message: 'BUSY',
                data: {
                  tool: 'reingest_repository',
                  code: 'BUSY',
                  retryable: true,
                  retryMessage: 'retry',
                  reingestableRepositoryIds: ['repo-a'],
                  reingestableSourceIds: [
                    fixture.additionalRepositoryPaths[0]!,
                  ],
                  fieldErrors: [
                    {
                      field: 'sourceId',
                      reason: 'busy',
                      message:
                        'reingest is currently locked by another ingest operation',
                    },
                  ],
                },
              },
            };
          }
          return {
            ok: true,
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId:
                sourceId === fixture.workingRepositoryPath
                  ? 'working-repo'
                  : 'repo-b',
            }),
          };
        },
        appendLog: noopLog,
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.kind, 'batch');
    assert.deepEqual(calls, [
      fixture.workingRepositoryPath,
      fixture.additionalRepositoryPaths[0],
      fixture.additionalRepositoryPaths[1],
    ]);
    assert.deepEqual(result.value.summary, {
      reingested: 2,
      skipped: 0,
      failed: 1,
    });
    assert.equal(result.value.repositories[1]?.outcome, 'failed');
    assert.deepEqual(
      result.value.warnings.map((warning) => warning.code),
      ['repository_failed'],
    );
  });

  test('plan_scope records repository_failed warnings for ok-shaped terminal error and cancelled outcomes', async () => {
    const fixture = await createPlanScopeFixture({
      additionalRepositories: [{ name: 'repo-a' }, { name: 'repo-b' }],
    });
    cleanups.push(fixture.cleanup);

    const result = await executeReingestRequest({
      request: { target: 'plan_scope' },
      surface: 'command',
      workingRepositoryPath: fixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories: async () => ({
          repos: [
            buildRepoEntry({
              id: 'working-repo',
              containerPath: fixture.workingRepositoryPath,
              hostPath: fixture.workingRepositoryPath,
            }),
            buildRepoEntry({
              id: 'repo-a',
              containerPath: fixture.additionalRepositoryPaths[0]!,
              hostPath: fixture.additionalRepositoryPaths[0]!,
            }),
            buildRepoEntry({
              id: 'repo-b',
              containerPath: fixture.additionalRepositoryPaths[1]!,
              hostPath: fixture.additionalRepositoryPaths[1]!,
            }),
          ],
          lockedModelId: 'model',
        }),
        runReingestRepository: async ({ sourceId }) => {
          if (sourceId === fixture.additionalRepositoryPaths[0]) {
            return {
              ok: true,
              value: buildReingestSuccess({
                sourceId: sourceId ?? '/missing',
                resolvedRepositoryId: 'repo-a',
                status: 'error',
                completionMode: null,
                errorCode: 'INGEST_ERROR',
              }),
            };
          }
          if (sourceId === fixture.additionalRepositoryPaths[1]) {
            return {
              ok: true,
              value: buildReingestSuccess({
                sourceId: sourceId ?? '/missing',
                resolvedRepositoryId: 'repo-b',
                status: 'cancelled',
                completionMode: null,
              }),
            };
          }
          return {
            ok: true,
            value: buildReingestSuccess({
              sourceId: sourceId ?? '/missing',
              resolvedRepositoryId: 'working-repo',
            }),
          };
        },
        appendLog: noopLog,
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.kind, 'batch');
    assert.deepEqual(
      result.value.repositories.map((repository) => ({
        sourceId: repository.sourceId,
        outcome: repository.outcome,
        status: repository.status,
        errorCode: repository.errorCode,
      })),
      [
        {
          sourceId: fixture.workingRepositoryPath,
          outcome: 'reingested',
          status: 'completed',
          errorCode: null,
        },
        {
          sourceId: fixture.additionalRepositoryPaths[0],
          outcome: 'failed',
          status: 'error',
          errorCode: 'INGEST_ERROR',
        },
        {
          sourceId: fixture.additionalRepositoryPaths[1],
          outcome: 'failed',
          status: 'cancelled',
          errorCode: null,
        },
      ],
    );
    assert.deepEqual(result.value.summary, {
      reingested: 1,
      skipped: 0,
      failed: 2,
    });
    assert.deepEqual(
      result.value.warnings.map((warning) => ({
        code: warning.code,
        repositoryPath: warning.repositoryPath,
      })),
      [
        {
          code: 'repository_failed',
          repositoryPath: fixture.additionalRepositoryPaths[0],
        },
        {
          code: 'repository_failed',
          repositoryPath: fixture.additionalRepositoryPaths[1],
        },
      ],
    );
  });

  test('execution-layer logs distinguish working and warning-aware plan_scope runs', async () => {
    const fixture = await createPlanScopeFixture({
      additionalRepositories: [{ name: 'repo-a' }],
      planFile: { mode: 'missing' },
    });
    cleanups.push(fixture.cleanup);

    const listIngestedRepositories = async () => ({
      repos: [
        buildRepoEntry({
          id: 'working-repo',
          containerPath: fixture.workingRepositoryPath,
          hostPath: fixture.workingRepositoryPath,
        }),
      ],
      lockedModelId: 'model',
    });

    await executeReingestRequest({
      request: { target: 'working' },
      surface: 'command',
      workingRepositoryPath: fixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories,
        runReingestRepository: async ({ sourceId }) => ({
          ok: true,
          value: buildReingestSuccess({
            sourceId: sourceId ?? '/missing',
            resolvedRepositoryId: 'working-repo',
          }),
        }),
        appendLog: append,
      },
    });

    await executeReingestRequest({
      request: { target: 'plan_scope' },
      surface: 'command',
      workingRepositoryPath: fixture.workingRepositoryPath,
      deps: {
        listIngestedRepositories,
        runReingestRepository: async ({ sourceId }) => ({
          ok: true,
          value: buildReingestSuccess({
            sourceId: sourceId ?? '/missing',
            resolvedRepositoryId: 'working-repo',
          }),
        }),
        appendLog: append,
      },
    });

    const executionLogs = query({ text: 'DEV-0000052:T4:reingest-execution' });
    assert.equal(executionLogs.length, 2);
    const workingLog = executionLogs.find(
      (entry) => entry.context?.targetMode === 'working',
    );
    assert.equal(workingLog?.context?.attemptedRepositoryCount, 1);

    const planScopeLog = executionLogs.find(
      (entry) => entry.context?.targetMode === 'plan_scope',
    );
    assert.equal(planScopeLog?.context?.attemptedRepositoryCount, 1);
    assert.equal(planScopeLog?.context?.warningCount, 1);
    assert.deepEqual(planScopeLog?.context?.warningCodes, ['handoff_missing']);
  });
});
