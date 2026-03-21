import path from 'node:path';

import {
  listIngestedRepositories,
  type ListReposResult,
  type RepoEntry,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { resolveRepositorySelector } from '../mcpCommon/repositorySelector.js';

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

type ReingestRequest = { sourceId: string } | { target: 'current' | 'all' };

export type ReingestTargetMode = 'sourceId' | 'current' | 'all';

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
  targetMode: 'sourceId' | 'current';
  requestedSelector: string | null;
  resolvedSourceId: string;
  outcome: ReingestSuccess;
};

export type ReingestExecutionBatchResult = {
  kind: 'batch';
  targetMode: 'all';
  requestedSelector: null;
  repositories: ReingestRepositoryExecutionOutcome[];
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
};

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

function invalidCurrentOwnerError(repos: RepoEntry[]): ReingestError {
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
          message:
            'target "current" requires an owning repository path for this command or flow',
        },
      ],
      ...buildRetryLists(repos),
    },
  };
}

function currentOwnerNotIngestedError(repos: RepoEntry[]): ReingestError {
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
          message:
            'target "current" owner repository is not currently ingested',
        },
      ],
      ...buildRetryLists(repos),
    },
  };
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
  try {
    const repo = await resolveRepositorySelector(params.sourceId, {
      listIngestedRepositories: params.listRepos,
    });
    if (repo) {
      return {
        sourceId: normalizeContainerPath(repo.containerPath),
        repo,
      };
    }
  } catch {
    // Fall back to the original selector so the strict service can keep its
    // current validation categories for unresolved input.
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

export async function executeReingestRequest(params: {
  request: ReingestRequest;
  surface: 'command' | 'flow' | 'flow_command';
  currentOwnerSourceId?: string;
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

  const listed = await listRepos();
  if (params.request.target === 'current') {
    if (!params.currentOwnerSourceId?.trim()) {
      return {
        ok: false,
        error: invalidCurrentOwnerError(listed.repos),
      };
    }

    const repo = await resolveRepositorySelector(params.currentOwnerSourceId, {
      listIngestedRepositories: listRepos,
    });
    if (!repo) {
      return {
        ok: false,
        error: currentOwnerNotIngestedError(listed.repos),
      };
    }

    const resolvedPath = normalizeContainerPath(repo.containerPath);
    appendResolutionLog({
      appendLog,
      surface: params.surface,
      targetMode: 'current',
      requestedSelector: null,
      resolvedPaths: [resolvedPath],
    });

    const result = await runReingest({ sourceId: resolvedPath });
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        kind: 'single',
        targetMode: 'current',
        requestedSelector: null,
        resolvedSourceId: result.value.sourceId,
        outcome: result.value,
      },
    };
  }

  const orderedRepos = [...listed.repos].sort((left, right) =>
    normalizeContainerPath(left.containerPath).localeCompare(
      normalizeContainerPath(right.containerPath),
    ),
  );

  appendResolutionLog({
    appendLog,
    surface: params.surface,
    targetMode: 'all',
    requestedSelector: null,
    resolvedPaths: orderedRepos.map((repo) =>
      normalizeContainerPath(repo.containerPath),
    ),
  });

  const repositories: ReingestRepositoryExecutionOutcome[] = [];
  for (const repo of orderedRepos) {
    try {
      const result = await runReingest({
        sourceId: normalizeContainerPath(repo.containerPath),
      });
      if (result.ok) {
        repositories.push(normalizeOutcome(result.value));
      } else {
        repositories.push(
          normalizeFailureOutcome({
            repo,
            error: result.error,
          }),
        );
      }
    } catch (error) {
      repositories.push(
        normalizeFailureOutcome({
          repo,
          error:
            error instanceof Error
              ? error
              : new Error('Unexpected reingest error'),
        }),
      );
    }
  }

  return {
    ok: true,
    value: {
      kind: 'batch',
      targetMode: 'all',
      requestedSelector: null,
      repositories,
    },
  };
}
