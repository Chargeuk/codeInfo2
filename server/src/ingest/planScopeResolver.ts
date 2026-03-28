import fs from 'node:fs/promises';
import path from 'node:path';

import {
  type ListReposResult,
  listIngestedRepositories,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { resolveRepositorySelector } from '../mcpCommon/repositorySelector.js';
import { resolveWorkingFolderWorkingDirectory } from '../workingFolders/state.js';

export type ReingestPlanScopeWarning = {
  code:
    | 'handoff_missing'
    | 'handoff_invalid'
    | 'repository_skipped'
    | 'repository_failed';
  message: string;
  repositoryPath?: string | null;
  resolvedRepositoryId?: string | null;
};

export type PlanScopeResolvedRepository = {
  sourceId: string;
  resolvedRepositoryId: string | null;
};

export type PlanScopeResolutionResult = {
  repositories: PlanScopeResolvedRepository[];
  warnings: ReingestPlanScopeWarning[];
};

type PlanScopeResolverDeps = {
  listIngestedRepositories?: () => Promise<ListReposResult>;
  readFile?: typeof fs.readFile;
  appendLog?: typeof append;
};

type CurrentPlanPayload = {
  additional_repositories?: Array<{ path: string }>;
};

const PLAN_SCOPE_MARKER = 'DEV-0000052:T3:plan-scope-resolver';

function normalizeRepositoryPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/').trim());
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function buildRepositorySkippedWarning(params: {
  repositoryPath: string;
  resolvedRepositoryId?: string | null;
  reason: string;
}): ReingestPlanScopeWarning {
  return {
    code: 'repository_skipped',
    message: params.reason,
    repositoryPath: params.repositoryPath,
    resolvedRepositoryId: params.resolvedRepositoryId ?? null,
  };
}

function isMissingPlanError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function hasUsableAdditionalRepositories(
  value: unknown,
): value is Array<{ path: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as { path?: unknown }).path === 'string' &&
        (entry as { path: string }).path.trim().length > 0,
    )
  );
}

function appendPlanScopeResolverLog(params: {
  appendLog: typeof append;
  workingRepositoryPath: string;
  currentPlanPath: string;
  repositories: PlanScopeResolvedRepository[];
  warnings: ReingestPlanScopeWarning[];
}) {
  params.appendLog({
    level: 'info',
    message: PLAN_SCOPE_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      workingRepositoryPath: params.workingRepositoryPath,
      currentPlanPath: params.currentPlanPath,
      repositoryCount: params.repositories.length,
      warningCount: params.warnings.length,
      resolvedPaths: params.repositories.map((repo) => repo.sourceId),
      warningCodes: params.warnings.map((warning) => warning.code),
      outcome:
        params.warnings.length === 0
          ? 'working_only_clean'
          : 'working_or_handoff_warning',
    },
  });
}

export async function resolvePlanScopeRepositories(params: {
  workingRepositoryPath: string;
  deps?: PlanScopeResolverDeps;
}): Promise<PlanScopeResolutionResult> {
  const listRepos =
    params.deps?.listIngestedRepositories ?? listIngestedRepositories;
  const readFile = params.deps?.readFile ?? fs.readFile;
  const appendLog = params.deps?.appendLog ?? append;

  const resolvedWorkingRepositoryPath =
    await resolveWorkingFolderWorkingDirectory(params.workingRepositoryPath);
  if (!resolvedWorkingRepositoryPath) {
    throw new Error('workingRepositoryPath is required for plan scope');
  }

  const normalizedWorkingRepositoryPath = normalizeRepositoryPath(
    resolvedWorkingRepositoryPath,
  );
  const currentPlanPath = path.join(
    resolvedWorkingRepositoryPath,
    'codeInfoStatus',
    'flow-state',
    'current-plan.json',
  );

  const listed = await listRepos();
  const cachedListRepos = async () => listed;
  const workingRepository = await resolveRepositorySelector(
    resolvedWorkingRepositoryPath,
    {
      listIngestedRepositories: cachedListRepos,
    },
  );

  const repositories: PlanScopeResolvedRepository[] = [
    {
      sourceId: workingRepository
        ? normalizeRepositoryPath(workingRepository.containerPath)
        : normalizedWorkingRepositoryPath,
      resolvedRepositoryId: workingRepository?.id ?? null,
    },
  ];
  const seenSourceIds = new Set([repositories[0].sourceId]);
  const warnings: ReingestPlanScopeWarning[] = [];

  let rawPlanText: string;
  try {
    rawPlanText = await readFile(currentPlanPath, { encoding: 'utf8' });
  } catch (error) {
    if (isMissingPlanError(error)) {
      warnings.push({
        code: 'handoff_missing',
        message:
          'plan_scope handoff file is missing; falling back to the working repository only',
        repositoryPath: currentPlanPath,
        resolvedRepositoryId: null,
      });
      appendPlanScopeResolverLog({
        appendLog,
        workingRepositoryPath: normalizedWorkingRepositoryPath,
        currentPlanPath,
        repositories,
        warnings,
      });
      return { repositories, warnings };
    }

    warnings.push({
      code: 'handoff_invalid',
      message:
        'plan_scope handoff file could not be read; falling back to the working repository only',
      repositoryPath: currentPlanPath,
      resolvedRepositoryId: null,
    });
    appendPlanScopeResolverLog({
      appendLog,
      workingRepositoryPath: normalizedWorkingRepositoryPath,
      currentPlanPath,
      repositories,
      warnings,
    });
    return { repositories, warnings };
  }

  let payload: CurrentPlanPayload;
  try {
    payload = JSON.parse(rawPlanText) as CurrentPlanPayload;
  } catch {
    warnings.push({
      code: 'handoff_invalid',
      message:
        'plan_scope handoff file contained malformed JSON; falling back to the working repository only',
      repositoryPath: currentPlanPath,
      resolvedRepositoryId: null,
    });
    appendPlanScopeResolverLog({
      appendLog,
      workingRepositoryPath: normalizedWorkingRepositoryPath,
      currentPlanPath,
      repositories,
      warnings,
    });
    return { repositories, warnings };
  }

  if (payload.additional_repositories === undefined) {
    appendPlanScopeResolverLog({
      appendLog,
      workingRepositoryPath: normalizedWorkingRepositoryPath,
      currentPlanPath,
      repositories,
      warnings,
    });
    return { repositories, warnings };
  }

  if (!hasUsableAdditionalRepositories(payload.additional_repositories)) {
    warnings.push({
      code: 'handoff_invalid',
      message:
        'plan_scope handoff additional_repositories was not a usable array of { path } entries; falling back to the working repository only',
      repositoryPath: currentPlanPath,
      resolvedRepositoryId: null,
    });
    appendPlanScopeResolverLog({
      appendLog,
      workingRepositoryPath: normalizedWorkingRepositoryPath,
      currentPlanPath,
      repositories,
      warnings,
    });
    return { repositories, warnings };
  }

  for (const entry of payload.additional_repositories) {
    const repositoryPath = entry.path.trim();
    let resolvedAdditionalPath: string | undefined;
    try {
      resolvedAdditionalPath =
        await resolveWorkingFolderWorkingDirectory(repositoryPath);
    } catch (error) {
      const reason =
        typeof (error as { reason?: unknown } | undefined)?.reason === 'string'
          ? (error as { reason: string }).reason
          : 'repository path could not be resolved';
      warnings.push(
        buildRepositorySkippedWarning({
          repositoryPath,
          reason: `plan_scope skipped additional repository "${repositoryPath}": ${reason}`,
        }),
      );
      continue;
    }

    if (!resolvedAdditionalPath) {
      warnings.push(
        buildRepositorySkippedWarning({
          repositoryPath,
          reason: `plan_scope skipped additional repository "${repositoryPath}": repository path could not be resolved`,
        }),
      );
      continue;
    }

    const resolvedRepository = await resolveRepositorySelector(
      resolvedAdditionalPath,
      {
        listIngestedRepositories: cachedListRepos,
      },
    );
    if (!resolvedRepository) {
      warnings.push(
        buildRepositorySkippedWarning({
          repositoryPath,
          reason: `plan_scope skipped additional repository "${repositoryPath}": repository is not currently ingested`,
        }),
      );
      continue;
    }

    const normalizedSourceId = normalizeRepositoryPath(
      resolvedRepository.containerPath,
    );
    if (seenSourceIds.has(normalizedSourceId)) {
      warnings.push(
        buildRepositorySkippedWarning({
          repositoryPath,
          resolvedRepositoryId: resolvedRepository.id,
          reason: `plan_scope skipped additional repository "${repositoryPath}": duplicate repository scope entry`,
        }),
      );
      continue;
    }

    seenSourceIds.add(normalizedSourceId);
    repositories.push({
      sourceId: normalizedSourceId,
      resolvedRepositoryId: resolvedRepository.id ?? null,
    });
  }

  appendPlanScopeResolverLog({
    appendLog,
    workingRepositoryPath: normalizedWorkingRepositoryPath,
    currentPlanPath,
    repositories,
    warnings,
  });

  return { repositories, warnings };
}
