import path from 'node:path';

import {
  listIngestedRepositories,
  type ListReposResult,
  type RepoEntry,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { resolveRepositorySelector } from '../mcpCommon/repositorySelector.js';

import {
  resolvePlanScopeRepositories,
  type PlanScopeResolutionResult,
  type ReingestPlanScopeWarning,
} from './planScopeResolver.js';
import { formatReingestPrestartReason } from './reingestError.js';
import type {
  ReingestError,
  ReingestResult,
  ReingestSuccess,
} from './reingestService.js';
import { runReingestRepository } from './reingestService.js';

const TOOL_NAME = 'reingest_repository';
const RETRY_MESSAGE =
  'The AI can retry using one of the provided re-ingestable repository ids/sourceIds.';

type ReingestRequest =
  | { sourceId: string }
  | { target: 'working' | 'plan_scope' };

export type ReingestTargetMode = 'sourceId' | 'working' | 'plan_scope';

export type ReingestRepositoryExecutionOutcome = {
  sourceId: string;
  resolvedRepositoryId: string | null;
  outcome: 'reingested' | 'skipped' | 'failed';
  status: 'completed' | 'cancelled' | 'error';
  completionMode: 'reingested' | 'skipped' | null;
  runId: string | null;
  files: number;
  chunks: number;
  embedded: number;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ReingestExecutionSingleResult = {
  kind: 'single';
  targetMode: 'sourceId' | 'working';
  requestedSelector: string | null;
  resolvedSourceId: string;
  outcome: ReingestSuccess;
};

export type ReingestExecutionBatchResult = {
  kind: 'batch';
  targetMode: 'plan_scope';
  requestedSelector: null;
  repositories: ReingestRepositoryExecutionOutcome[];
  summary: {
    reingested: number;
    skipped: number;
    failed: number;
  };
  warnings: ReingestPlanScopeWarning[];
};

export type ReingestExecutionResult =
  | ReingestExecutionSingleResult
  | ReingestExecutionBatchResult;

type ExecuteReingestRequestDeps = {
  listIngestedRepositories?: () => Promise<ListReposResult>;
  runReingestRepository?: (args: {
    sourceId?: string;
  }) => Promise<ReingestResult>;
  appendLog?: typeof append;
  resolvePlanScopeRepositories?: (params: {
    workingRepositoryPath: string;
    deps?: {
      listIngestedRepositories?: () => Promise<ListReposResult>;
      appendLog?: typeof append;
    };
  }) => Promise<PlanScopeResolutionResult>;
};

async function listReposSnapshot(
  listRepos: () => Promise<ListReposResult>,
): Promise<{
  listed: ListReposResult;
  cachedListRepos: () => Promise<ListReposResult>;
}> {
  const listed = await listRepos();
  return {
    listed,
    cachedListRepos: async () => listed,
  };
}

function normalizeContainerPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/').trim());
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function buildRetryLists(repos: RepoEntry[]) {
  const repositoryIds = new Set<string>();
  const sourceIds = new Set<string>();

  repos.forEach((repo) => {
    if (repo.id) repositoryIds.add(repo.id);
    if (repo.containerPath) {
      sourceIds.add(normalizeContainerPath(repo.containerPath));
    }
  });

  return {
    reingestableRepositoryIds: Array.from(repositoryIds).sort((a, b) =>
      a.localeCompare(b),
    ),
    reingestableSourceIds: Array.from(sourceIds).sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}

function invalidWorkingTargetError(params: {
  repos: RepoEntry[];
  target: 'working' | 'plan_scope';
}): ReingestError {
  return {
    code: -32602,
    message: 'INVALID_PARAMS',
    data: {
      tool: TOOL_NAME,
      code: 'INVALID_SOURCE_ID',
      retryable: true,
      retryMessage: RETRY_MESSAGE,
      fieldErrors: [
        {
          field: 'sourceId',
          reason: 'invalid_state',
          message: `target "${params.target}" requires a selected working repository path for this run`,
        },
      ],
      ...buildRetryLists(params.repos),
    },
  };
}

function workingTargetNotIngestedError(params: {
  repos: RepoEntry[];
  target: 'working' | 'plan_scope';
}): ReingestError {
  return {
    code: 404,
    message: 'NOT_FOUND',
    data: {
      tool: TOOL_NAME,
      code: 'NOT_FOUND',
      retryable: true,
      retryMessage: RETRY_MESSAGE,
      fieldErrors: [
        {
          field: 'sourceId',
          reason: 'unknown_root',
          message: `target "${params.target}" selected working repository is not currently ingested`,
        },
      ],
      ...buildRetryLists(params.repos),
    },
  };
}

function buildBatchSummary(
  repositories: ReingestRepositoryExecutionOutcome[],
): ReingestExecutionBatchResult['summary'] {
  return repositories.reduce<ReingestExecutionBatchResult['summary']>(
    (summary, repository) => {
      summary[repository.outcome] += 1;
      return summary;
    },
    { reingested: 0, skipped: 0, failed: 0 },
  );
}

function normalizeOutcome(
  result: ReingestSuccess,
): ReingestRepositoryExecutionOutcome {
  return {
    sourceId: result.sourceId,
    resolvedRepositoryId: result.resolvedRepositoryId,
    outcome:
      result.status === 'completed'
        ? result.completionMode === 'skipped'
          ? 'skipped'
          : 'reingested'
        : 'failed',
    status: result.status,
    completionMode: result.completionMode,
    runId: result.runId,
    files: result.files,
    chunks: result.chunks,
    embedded: result.embedded,
    errorCode: result.errorCode,
    errorMessage: null,
  };
}

function normalizeFailureOutcome(params: {
  repo: RepoEntry;
  error: ReingestError | Error;
}): ReingestRepositoryExecutionOutcome {
  const isStructured =
    'code' in params.error &&
    'message' in params.error &&
    'data' in params.error;
  return {
    sourceId: params.repo.containerPath,
    resolvedRepositoryId: params.repo.id ?? null,
    outcome: 'failed',
    status: 'error',
    completionMode: null,
    runId: null,
    files: 0,
    chunks: 0,
    embedded: 0,
    errorCode: isStructured
      ? (params.error as ReingestError).data.code
      : 'UNEXPECTED_ERROR',
    errorMessage: isStructured
      ? formatReingestPrestartReason(params.error as ReingestError)
      : params.error.message,
  };
}

async function canonicalizeSelector(params: {
  sourceId: string;
  listRepos: () => Promise<ListReposResult>;
}): Promise<{ sourceId: string; repo: RepoEntry | null }> {
  const repo = await resolveRepositorySelector(params.sourceId, {
    listIngestedRepositories: params.listRepos,
  });
  if (repo) {
    return {
      sourceId: normalizeContainerPath(repo.containerPath),
      repo,
    };
  }

  return {
    sourceId: params.sourceId,
    repo: null,
  };
}

function appendResolutionLog(params: {
  appendLog: typeof append;
  surface: 'command' | 'flow' | 'flow_command';
  targetMode: ReingestTargetMode;
  requestedSelector: string | null;
  resolvedPaths: string[];
}) {
  params.appendLog({
    level: 'info',
    message: 'DEV-0000050:T03:reingest_targets_resolved',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface: params.surface,
      targetMode: params.targetMode,
      requestedSelector: params.requestedSelector,
      resolvedCount: params.resolvedPaths.length,
      resolvedPaths: params.resolvedPaths,
    },
  });
}

function appendExecutionLog(params: {
  appendLog: typeof append;
  surface: 'command' | 'flow' | 'flow_command';
  targetMode: ReingestTargetMode;
  requestedSelector: string | null;
  repositories: ReingestRepositoryExecutionOutcome[];
  warnings: ReingestPlanScopeWarning[];
}) {
  params.appendLog({
    level: 'info',
    message: 'DEV-0000052:T4:reingest-execution',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface: params.surface,
      targetMode: params.targetMode,
      requestedSelector: params.requestedSelector,
      attemptedRepositoryCount: params.repositories.length,
      warningCount: params.warnings.length,
      warningCodes: params.warnings.map((warning) => warning.code),
      resolvedPaths: params.repositories.map((repo) => repo.sourceId),
      summary: buildBatchSummary(params.repositories),
    },
  });
}

function buildRepositoryFailedWarning(params: {
  sourceId: string;
  resolvedRepositoryId: string | null;
  errorMessage: string | null;
  errorCode: string | null;
}): ReingestPlanScopeWarning {
  return {
    code: 'repository_failed',
    message: `plan_scope repository "${params.sourceId}" failed: ${params.errorMessage ?? params.errorCode ?? 'Unknown reingest failure'}`,
    repositoryPath: params.sourceId,
    resolvedRepositoryId: params.resolvedRepositoryId,
  };
}

function toFailureRepoEntry(params: {
  sourceId: string;
  resolvedRepositoryId: string | null;
}): RepoEntry {
  return {
    id: params.resolvedRepositoryId ?? params.sourceId,
    description: null,
    containerPath: params.sourceId,
    hostPath: params.sourceId,
    lastIngestAt: null,
    embeddingProvider: 'lmstudio',
    embeddingModel: 'model',
    embeddingDimensions: 0,
    model: 'model',
    modelId: 'model',
    lock: {
      embeddingProvider: 'lmstudio',
      embeddingModel: 'model',
      embeddingDimensions: 0,
      lockedModelId: 'model',
      modelId: 'model',
    },
    counts: { files: 0, chunks: 0, embedded: 0 },
    lastError: null,
  };
}

export async function executeReingestRequest(params: {
  request: ReingestRequest;
  surface: 'command' | 'flow' | 'flow_command';
  workingRepositoryPath?: string;
  deps?: ExecuteReingestRequestDeps;
}): Promise<
  | { ok: true; value: ReingestExecutionResult }
  | { ok: false; error: ReingestError }
> {
  const listRepos =
    params.deps?.listIngestedRepositories ?? listIngestedRepositories;
  const runReingest =
    params.deps?.runReingestRepository ?? runReingestRepository;
  const appendLog = params.deps?.appendLog ?? append;
  const resolvePlanScope =
    params.deps?.resolvePlanScopeRepositories ?? resolvePlanScopeRepositories;

  if ('sourceId' in params.request) {
    const resolved = await canonicalizeSelector({
      sourceId: params.request.sourceId,
      listRepos,
    });

    appendResolutionLog({
      appendLog,
      surface: params.surface,
      targetMode: 'sourceId',
      requestedSelector: params.request.sourceId,
      resolvedPaths: [resolved.sourceId],
    });

    const result = await runReingest({ sourceId: resolved.sourceId });
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        kind: 'single',
        targetMode: 'sourceId',
        requestedSelector: params.request.sourceId,
        resolvedSourceId: result.value.sourceId,
        outcome: result.value,
      },
    };
  }

  if (params.request.target === 'working') {
    const { listed, cachedListRepos } = await listReposSnapshot(listRepos);
    const runtimeWorkingRepositoryPath = params.workingRepositoryPath?.trim();
    if (!runtimeWorkingRepositoryPath) {
      return {
        ok: false,
        error: invalidWorkingTargetError({
          repos: listed.repos,
          target: 'working',
        }),
      };
    }

    const repo = await resolveRepositorySelector(runtimeWorkingRepositoryPath, {
      listIngestedRepositories: cachedListRepos,
    });
    if (!repo) {
      return {
        ok: false,
        error: workingTargetNotIngestedError({
          repos: listed.repos,
          target: 'working',
        }),
      };
    }

    const resolvedPath = normalizeContainerPath(repo.containerPath);
    appendResolutionLog({
      appendLog,
      surface: params.surface,
      targetMode: 'working',
      requestedSelector: null,
      resolvedPaths: [resolvedPath],
    });

    const result = await runReingest({ sourceId: resolvedPath });
    if (!result.ok) {
      return result;
    }

    appendExecutionLog({
      appendLog,
      surface: params.surface,
      targetMode: 'working',
      requestedSelector: null,
      repositories: [normalizeOutcome(result.value)],
      warnings: [],
    });

    return {
      ok: true,
      value: {
        kind: 'single',
        targetMode: 'working',
        requestedSelector: null,
        resolvedSourceId: result.value.sourceId,
        outcome: result.value,
      },
    };
  }

  const { listed, cachedListRepos } = await listReposSnapshot(listRepos);
  const workingRepositoryPath = params.workingRepositoryPath?.trim();
  if (!workingRepositoryPath) {
    return {
      ok: false,
      error: invalidWorkingTargetError({
        repos: listed.repos,
        target: 'plan_scope',
      }),
    };
  }
  const workingRepository = await resolveRepositorySelector(
    workingRepositoryPath,
    {
      listIngestedRepositories: cachedListRepos,
    },
  );
  if (!workingRepository) {
    return {
      ok: false,
      error: workingTargetNotIngestedError({
        repos: listed.repos,
        target: 'plan_scope',
      }),
    };
  }

  const resolution = await resolvePlanScope({
    workingRepositoryPath: normalizeContainerPath(
      workingRepository.containerPath,
    ),
    deps: {
      listIngestedRepositories: cachedListRepos,
      appendLog,
    },
  });

  appendResolutionLog({
    appendLog,
    surface: params.surface,
    targetMode: 'plan_scope',
    requestedSelector: null,
    resolvedPaths: resolution.repositories.map((repo) => repo.sourceId),
  });

  const repositories: ReingestRepositoryExecutionOutcome[] = [];
  const warnings = [...resolution.warnings];
  for (const repo of resolution.repositories) {
    try {
      const result = await runReingest({
        sourceId: repo.sourceId,
      });
      if (result.ok) {
        const outcome = normalizeOutcome(result.value);
        repositories.push(outcome);
        if (outcome.outcome === 'failed') {
          warnings.push(
            buildRepositoryFailedWarning({
              sourceId: outcome.sourceId,
              resolvedRepositoryId: outcome.resolvedRepositoryId,
              errorMessage: outcome.errorMessage,
              errorCode: outcome.errorCode,
            }),
          );
        }
      } else {
        const failure = normalizeFailureOutcome({
          repo: toFailureRepoEntry({
            sourceId: repo.sourceId,
            resolvedRepositoryId: repo.resolvedRepositoryId,
          }),
          error: result.error,
        });
        repositories.push(failure);
        warnings.push(
          buildRepositoryFailedWarning({
            sourceId: repo.sourceId,
            resolvedRepositoryId: repo.resolvedRepositoryId,
            errorMessage: failure.errorMessage,
            errorCode: failure.errorCode,
          }),
        );
      }
    } catch (error) {
      const failure = normalizeFailureOutcome({
        repo: toFailureRepoEntry({
          sourceId: repo.sourceId,
          resolvedRepositoryId: repo.resolvedRepositoryId,
        }),
        error:
          error instanceof Error
            ? error
            : new Error('Unexpected reingest error'),
      });
      repositories.push(failure);
      warnings.push(
        buildRepositoryFailedWarning({
          sourceId: repo.sourceId,
          resolvedRepositoryId: repo.resolvedRepositoryId,
          errorMessage: failure.errorMessage,
          errorCode: failure.errorCode,
        }),
      );
    }
  }

  appendExecutionLog({
    appendLog,
    surface: params.surface,
    targetMode: 'plan_scope',
    requestedSelector: null,
    repositories,
    warnings,
  });

  return {
    ok: true,
    value: {
      kind: 'batch',
      targetMode: 'plan_scope',
      requestedSelector: null,
      repositories,
      summary: buildBatchSummary(repositories),
      warnings,
    },
  };
}
