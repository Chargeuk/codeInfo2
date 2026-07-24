import { execFile as execFileCb } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  type ListReposResult,
  listIngestedRepositories,
} from '../lmstudio/toolService.js';
import { resolveWorkingFolderWorkingDirectory } from '../workingFolders/executionContext.js';
import { hashFlowInput, normalizeFlowInput } from './flowInput.js';
import {
  resolveBaseComparison,
  resolveReviewRepositoryRoot,
} from './reviewBase.js';
import {
  atomicWriteJson,
  buildReviewArtifactPath,
  deriveCanonicalStoryId,
} from './reviewIdentity.js';

const execFile = promisify(execFileCb);
const BRANCH_STORY_PATTERN = /^(\d+)(?:-|$)/u;
const SAFE_ALIAS_PATTERN = /[^A-Za-z0-9._-]+/gu;

const normalizeStoryNumberToken = (value: string): string =>
  value.replace(/^0+/u, '') || '0';

export const REVIEW_TARGETS_SCHEMA_VERSION = 'codeinfo-review-targets/v1';

export type ReviewTarget = {
  target_id: string;
  repo_alias: string;
  repo_root: string;
  repository_id: string;
  branch: string;
  head_commit: string;
  comparison_base_commit?: string;
  story_id: string;
  is_primary: boolean;
};

export type ReviewTargetSnapshot = {
  schema_version: typeof REVIEW_TARGETS_SCHEMA_VERSION;
  story_id: string;
  plan_path: string;
  branched_from: string | null;
  plan_host_root: string;
  review_wave_id: string;
  review_cycle_id?: string;
  review_mode?: 'final' | 'diagnostic';
  targets_sha256: string;
  targets: ReviewTarget[];
  created_at: string;
};

type CurrentPlanPayload = {
  plan_path?: unknown;
  branched_from?: unknown;
  additional_repositories?: unknown;
};

type ReviewTargetDeps = {
  readFile: typeof fs.readFile;
  realpath: typeof fs.realpath;
  mkdir: typeof fs.mkdir;
  rename: typeof fs.rename;
  writeFile: typeof fs.writeFile;
  listIngestedRepositories: () => Promise<ListReposResult>;
  resolveWorkingDirectory: (
    workingFolder: string,
  ) => Promise<string | undefined>;
  execFile: typeof execFile;
  now: () => Date;
  randomHex: () => string;
};

const defaultDeps: ReviewTargetDeps = {
  readFile: fs.readFile,
  realpath: fs.realpath,
  mkdir: fs.mkdir,
  rename: fs.rename,
  writeFile: fs.writeFile,
  listIngestedRepositories,
  resolveWorkingDirectory: resolveWorkingFolderWorkingDirectory,
  execFile,
  now: () => new Date(),
  randomHex: () => crypto.randomBytes(4).toString('hex'),
};

const stableTargetPromotionLocks = new Map<string, Promise<void>>();

const withStableTargetPromotionLock = async <T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = stableTargetPromotionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  stableTargetPromotionLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (stableTargetPromotionLocks.get(key) === queued) {
      stableTargetPromotionLocks.delete(key);
    }
  }
};

const nonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing.`);
  }
  return value.trim();
};

type AdditionalRepositoryTarget = { path: string; branchedFrom?: string };

const additionalRepositoryTargets = (
  value: unknown,
): AdditionalRepositoryTarget[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('current-plan.additional_repositories must be an array.');
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(
        `current-plan.additional_repositories[${index}] must be an object.`,
      );
    }
    const repositoryPath = nonEmptyString(
      (entry as { path?: unknown }).path,
      `current-plan.additional_repositories[${index}].path`,
    );
    const rawBase = (entry as { branched_from?: unknown }).branched_from;
    if (
      rawBase !== undefined &&
      (typeof rawBase !== 'string' || !rawBase.trim())
    ) {
      throw new Error(
        `current-plan.additional_repositories[${index}].branched_from must be a non-empty string when supplied.`,
      );
    }
    return {
      path: repositoryPath,
      ...(typeof rawBase === 'string' ? { branchedFrom: rawBase.trim() } : {}),
    };
  });
};

const gitStdout = async (
  repoRoot: string,
  args: string[],
  deps: ReviewTargetDeps,
  signal?: AbortSignal,
): Promise<string> => {
  const result = await deps.execFile('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    signal,
  });
  return result.stdout.trim();
};

const normalizeAlias = (value: string): string => {
  const normalized = value.trim().replace(SAFE_ALIAS_PATTERN, '-');
  return normalized.replace(/^-+|-+$/gu, '') || 'repository';
};

const formatTimestamp = (value: Date): string =>
  value
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}Z$/u, 'Z');

export async function prepareReviewTargets(
  params: {
    workingRepositoryPath: string;
    reviewMode?: 'final' | 'diagnostic';
    signal?: AbortSignal;
  },
  deps: Partial<ReviewTargetDeps> = {},
): Promise<{
  snapshot: ReviewTargetSnapshot;
  stablePath: string;
  versionedPath: string;
}> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const planHostRoot = await resolveReviewRepositoryRoot(
    params.workingRepositoryPath,
    { execFile: resolvedDeps.execFile },
    params.signal,
  );
  const currentPlanPath = path.join(
    planHostRoot,
    'codeInfoStatus',
    'flow-state',
    'current-plan.json',
  );
  const currentPlan = JSON.parse(
    await resolvedDeps.readFile(currentPlanPath, 'utf8'),
  ) as CurrentPlanPayload;
  const planPath = nonEmptyString(
    currentPlan.plan_path,
    'current-plan.plan_path',
  );
  const storyId = deriveCanonicalStoryId(planPath);
  let activeCycle: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(
      await resolvedDeps.readFile(
        path.join(
          planHostRoot,
          'codeInfoStatus',
          'flow-state',
          'active-review-cycle.json',
        ),
        'utf8',
      ),
    );
    activeCycle =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const activeCycleMatches =
    activeCycle?.story_id === storyId &&
    activeCycle.plan_path === planPath &&
    typeof activeCycle.review_cycle_id === 'string' &&
    (activeCycle.status === 'in_progress' || activeCycle.status === undefined) &&
    (activeCycle.review_mode === 'final' ||
      activeCycle.review_mode === 'diagnostic') &&
    (params.reviewMode === undefined ||
      activeCycle.review_mode === params.reviewMode);
  const reviewCycleId = activeCycleMatches
    ? (activeCycle?.review_cycle_id as string)
    : undefined;
  const reviewMode = activeCycleMatches
    ? (activeCycle?.review_mode as 'final' | 'diagnostic')
    : undefined;
  const branchedFrom =
    typeof currentPlan.branched_from === 'string' &&
    currentPlan.branched_from.trim()
      ? currentPlan.branched_from.trim()
      : null;
  const requestedTargets: AdditionalRepositoryTarget[] = [
    { path: planHostRoot, ...(branchedFrom ? { branchedFrom } : {}) },
    ...additionalRepositoryTargets(currentPlan.additional_repositories),
  ];
  const listed = await resolvedDeps.listIngestedRepositories();
  const listedByRealPath = new Map<string, (typeof listed.repos)[number]>();
  for (const repository of listed.repos) {
    try {
      listedByRealPath.set(
        await resolvedDeps.realpath(repository.containerPath),
        repository,
      );
    } catch {
      continue;
    }
  }

  const seenRoots = new Set<string>();
  const seenAliases = new Set<string>();
  const targets: ReviewTarget[] = [];
  let primaryRealRoot: string | undefined;
  for (const [index, requestedTarget] of requestedTargets.entries()) {
    const requestedPath = requestedTarget.path;
    params.signal?.throwIfAborted();
    const mapped = await resolvedDeps.resolveWorkingDirectory(requestedPath);
    if (!mapped) {
      throw new Error(
        `Review target "${requestedPath}" could not be resolved.`,
      );
    }
    const repoRoot = await resolveReviewRepositoryRoot(
      mapped,
      { execFile: resolvedDeps.execFile },
      params.signal,
    );
    const realRoot = await resolvedDeps.realpath(repoRoot);
    if (seenRoots.has(realRoot)) {
      if (realRoot === primaryRealRoot) continue;
      throw new Error(
        `Review target "${requestedPath}" duplicates ${realRoot}.`,
      );
    }
    seenRoots.add(realRoot);
    if (index === 0) primaryRealRoot = realRoot;
    const repository = listedByRealPath.get(realRoot);
    if (!repository) {
      throw new Error(`Review target "${requestedPath}" is not ingested.`);
    }
    const branch = await gitStdout(
      realRoot,
      ['branch', '--show-current'],
      resolvedDeps,
      params.signal,
    );
    if (!branch) {
      throw new Error(`Review target "${realRoot}" has a detached HEAD.`);
    }
    const branchStoryId = branch
      .split('/')
      .at(-1)
      ?.match(BRANCH_STORY_PATTERN)?.[1];
    if (
      !branchStoryId ||
      normalizeStoryNumberToken(branchStoryId) !==
        normalizeStoryNumberToken(storyId)
    ) {
      throw new Error(
        `Review target branch "${branch}" does not match plan story ${storyId}.`,
      );
    }
    const headCommit = await gitStdout(
      realRoot,
      ['rev-parse', 'HEAD^{commit}'],
      resolvedDeps,
      params.signal,
    );
    const base = await resolveBaseComparison({
      repoRoot: realRoot,
      currentBranch: branch,
      branchedFrom: requestedTarget.branchedFrom,
      deps: { execFile: resolvedDeps.execFile },
      signal: params.signal,
    });
    const baseAlias =
      index === 0
        ? 'current_repository'
        : normalizeAlias(repository.id || path.basename(realRoot));
    let repoAlias = baseAlias;
    if (seenAliases.has(repoAlias)) {
      const suffix = crypto
        .createHash('sha256')
        .update(realRoot)
        .digest('hex')
        .slice(0, 12);
      repoAlias = `${baseAlias}-${suffix}`;
      if (seenAliases.has(repoAlias)) {
        throw new Error(`Review target alias "${repoAlias}" is duplicated.`);
      }
    }
    seenAliases.add(repoAlias);
    targets.push({
      target_id: repoAlias,
      repo_alias: repoAlias,
      repo_root: realRoot,
      repository_id: repository.id,
      branch,
      head_commit: headCommit,
      comparison_base_commit: base.comparisonBaseCommit,
      story_id: storyId,
      is_primary: index === 0,
    });
  }

  const now = resolvedDeps.now();
  const reviewWaveId = `${storyId}-rw-${formatTimestamp(now)}-${resolvedDeps.randomHex()}`;
  const targetsForHash = { story_id: storyId, plan_path: planPath, targets };
  const snapshot: ReviewTargetSnapshot = {
    schema_version: REVIEW_TARGETS_SCHEMA_VERSION,
    story_id: storyId,
    plan_path: planPath,
    branched_from: branchedFrom,
    plan_host_root: planHostRoot,
    review_wave_id: reviewWaveId,
    ...(reviewCycleId && reviewMode
      ? {
          review_cycle_id: reviewCycleId,
          review_mode: reviewMode,
        }
      : {}),
    targets_sha256: hashFlowInput(normalizeFlowInput(targetsForHash)),
    targets,
    created_at: now.toISOString(),
  };
  const reviewRoot = path.join(planHostRoot, 'codeInfoTmp', 'reviews');
  const versionedPath = path.join(
    reviewRoot,
    `${reviewWaveId}-review-targets.json`,
  );
  const stablePath = buildReviewArtifactPath({
    repoRoot: planHostRoot,
    storyId,
    outputKey: 'current-review-targets',
  });
  const atomicDeps = {
    mkdir: resolvedDeps.mkdir,
    rename: resolvedDeps.rename,
    writeFile: resolvedDeps.writeFile,
  };
  await atomicWriteJson(versionedPath, snapshot, atomicDeps);
  await withStableTargetPromotionLock(stablePath, async () => {
    let currentCreatedAt = '';
    try {
      const current = JSON.parse(
        await resolvedDeps.readFile(stablePath, 'utf8'),
      ) as Partial<ReviewTargetSnapshot>;
      currentCreatedAt = current.created_at ?? '';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (currentCreatedAt > snapshot.created_at) return;
    await atomicWriteJson(stablePath, snapshot, atomicDeps);
  });
  return { snapshot, stablePath, versionedPath };
}
