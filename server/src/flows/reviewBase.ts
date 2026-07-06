import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export type FlowReviewBasePolicy = 'branched_from_or_default_if_merged';

export type PreparedReviewBase = {
  story_id: string;
  plan_path: string;
  repo_alias: 'current_repository';
  repo_root: string;
  branch: string;
  head_commit: string;
  logical_base_branch: string;
  resolved_base_branch: string;
  resolved_base_source: 'remote' | 'local_fallback';
  remote_name: 'origin';
  remote_fetch_status:
    | 'success'
    | 'missing_remote'
    | 'fetch_failed'
    | 'missing_remote_ref';
  remote_fetch_error?: string;
  remote_fetch_exit_code?: number;
  local_fallback_reason:
    | null
    | 'missing_remote'
    | 'fetch_failed'
    | 'missing_remote_ref';
  comparison_base_ref: string;
  comparison_base_commit: string;
  comparison_head_ref: 'HEAD';
  comparison_rule: 'local_head_vs_resolved_base';
  status: 'completed';
  started_at: string;
  completed_at: string;
};

export type PrepareReviewBaseResult = {
  artifactPath: string;
  artifact: PreparedReviewBase;
};

type CurrentPlanPayload = {
  plan_path?: unknown;
  branched_from?: unknown;
};

type ExecFileOptions = {
  cwd?: string;
  signal?: AbortSignal;
  timeout?: number;
  killSignal?: NodeJS.Signals | number;
  encoding?: BufferEncoding;
};

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

type ReviewBaseDeps = {
  execFile: ExecFileLike;
  readFile: typeof fs.readFile;
  writeFile: typeof fs.writeFile;
  mkdir: typeof fs.mkdir;
  now: () => Date;
};

type GitCommandResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; stdout: string; stderr: string; code?: number };

type BaseResolution = {
  logicalBaseBranch: string;
  resolvedBaseBranch: string;
  resolvedBaseSource: 'remote' | 'local_fallback';
  remoteName: 'origin';
  remoteFetchStatus:
    | 'success'
    | 'missing_remote'
    | 'fetch_failed'
    | 'missing_remote_ref';
  remoteFetchError?: string;
  remoteFetchExitCode?: number;
  localFallbackReason:
    | null
    | 'missing_remote'
    | 'fetch_failed'
    | 'missing_remote_ref';
  comparisonBaseRef: string;
  comparisonBaseCommit: string;
};

const defaultDeps: ReviewBaseDeps = {
  execFile: (file, args, options) =>
    execFile(file, args, { encoding: 'utf8', ...options }),
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  mkdir: fs.mkdir,
  now: () => new Date(),
};

const GIT_PROCESS_TIMEOUT_MS = 120_000;
const PROCESS_KILL_SIGNAL: NodeJS.Signals = 'SIGTERM';
const SAFE_OUTPUT_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;
const STORY_NUMBER_PATTERN = /^(\d{7})-/;
const BRANCH_STORY_PATTERN = /(\d{7})/;

const normalizeOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;

const deriveStoryNumberFromPlanPath = (planPath: string): string => {
  const match = path.basename(planPath).match(STORY_NUMBER_PATTERN);
  if (!match) {
    throw new Error(
      `Current plan path "${planPath}" does not encode a 7-digit story number.`,
    );
  }
  return match[1];
};

const deriveBranchStoryNumber = (branchName: string): string | undefined =>
  branchName.match(BRANCH_STORY_PATTERN)?.[1];

const sanitizeGitError = (value: string) =>
  value.replace(/\s+/g, ' ').trim().slice(0, 300);

const ensureSafeOutputKey = (outputKey: string) => {
  const trimmed = outputKey.trim();
  if (!trimmed || !SAFE_OUTPUT_KEY_PATTERN.test(trimmed)) {
    throw new Error(
      `prepareReviewBase outputKey "${outputKey}" must be a safe file-name token.`,
    );
  }
  return trimmed;
};

const normalizeBranchedFrom = (value: string | undefined): string | undefined =>
  value
    ?.replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '')
    .trim() || undefined;

export async function resolveReviewRepositoryRoot(
  workingRepositoryPath: string,
  deps?: Pick<ReviewBaseDeps, 'execFile'>,
  signal?: AbortSignal,
): Promise<string> {
  const resolvedWorkingPath = path.resolve(workingRepositoryPath);
  const resolvedDeps = { ...defaultDeps, ...deps };
  const repoRoot = await gitStdoutOrThrow(
    resolvedWorkingPath,
    ['rev-parse', '--show-toplevel'],
    resolvedDeps,
    `Unable to resolve git repository root for "${resolvedWorkingPath}".`,
    signal,
  );
  return path.resolve(repoRoot);
}

async function runGit(
  repoRoot: string,
  args: readonly string[],
  deps: Pick<ReviewBaseDeps, 'execFile'>,
  signal?: AbortSignal,
): Promise<GitCommandResult> {
  try {
    const result = await deps.execFile('git', ['-C', repoRoot, ...args], {
      signal,
      timeout: GIT_PROCESS_TIMEOUT_MS,
      killSignal: PROCESS_KILL_SIGNAL,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const execError = error as
      | (NodeJS.ErrnoException & {
          name?: string;
          stdout?: string;
          stderr?: string;
          code?: number | string;
          signal?: NodeJS.Signals | null;
          killed?: boolean;
        })
      | undefined;
    if (signal?.aborted || execError?.name === 'AbortError') {
      throw error;
    }
    if (execError?.killed && execError.signal === PROCESS_KILL_SIGNAL) {
      throw new Error(
        `git ${args.join(' ')} timed out after ${GIT_PROCESS_TIMEOUT_MS}ms.`,
      );
    }
    return {
      ok: false,
      stdout: execError?.stdout ?? '',
      stderr: execError?.stderr ?? '',
      code: typeof execError?.code === 'number' ? execError.code : undefined,
    };
  }
}

async function gitStdoutOrThrow(
  repoRoot: string,
  args: readonly string[],
  deps: Pick<ReviewBaseDeps, 'execFile'>,
  failureMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await runGit(repoRoot, args, deps, signal);
  if (!result.ok) {
    throw new Error(failureMessage);
  }
  return result.stdout.trim();
}

async function refExists(
  repoRoot: string,
  ref: string,
  deps: Pick<ReviewBaseDeps, 'execFile'>,
  signal?: AbortSignal,
): Promise<boolean> {
  const result = await runGit(
    repoRoot,
    ['rev-parse', '--verify', ref],
    deps,
    signal,
  );
  return result.ok;
}

async function resolveDefaultBranch(
  repoRoot: string,
  remoteFetchStatus: 'success' | 'missing_remote' | 'fetch_failed',
  deps: Pick<ReviewBaseDeps, 'execFile'>,
  signal?: AbortSignal,
): Promise<string> {
  if (remoteFetchStatus !== 'missing_remote') {
    const symbolic = await runGit(
      repoRoot,
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      deps,
      signal,
    );
    if (symbolic.ok) {
      const normalized = symbolic.stdout.trim().replace(/^origin\//, '');
      if (normalized) return normalized;
    }
  }

  for (const candidate of ['main', 'master', 'develop']) {
    if (
      (await refExists(repoRoot, candidate, deps, signal)) ||
      (await refExists(repoRoot, `origin/${candidate}`, deps, signal))
    ) {
      return candidate;
    }
  }

  return 'main';
}

async function resolveBaseComparison(params: {
  repoRoot: string;
  currentBranch: string;
  branchedFrom?: string;
  deps: Pick<ReviewBaseDeps, 'execFile'>;
  signal?: AbortSignal;
}): Promise<BaseResolution> {
  const { repoRoot, currentBranch, deps, signal } = params;
  const branchedFrom = normalizeBranchedFrom(params.branchedFrom);

  const remoteExists = await runGit(
    repoRoot,
    ['remote', 'get-url', 'origin'],
    deps,
    signal,
  );
  let remoteFetchStatus: 'success' | 'missing_remote' | 'fetch_failed' =
    remoteExists.ok ? 'success' : 'missing_remote';
  let remoteFetchError: string | undefined;
  let remoteFetchExitCode: number | undefined;

  if (remoteExists.ok) {
    const fetched = await runGit(
      repoRoot,
      ['fetch', '--prune', 'origin'],
      deps,
      signal,
    );
    if (!fetched.ok) {
      remoteFetchStatus = 'fetch_failed';
      remoteFetchExitCode = fetched.code;
      const combined = `${fetched.stderr}\n${fetched.stdout}`.trim();
      if (combined) {
        remoteFetchError = sanitizeGitError(combined);
      }
    }
  }

  const defaultBranch = await resolveDefaultBranch(
    repoRoot,
    remoteFetchStatus,
    deps,
    signal,
  );

  let logicalBaseBranch = defaultBranch;
  if (
    branchedFrom &&
    branchedFrom !== currentBranch &&
    branchedFrom !== defaultBranch
  ) {
    const remoteBranchRef = `origin/${branchedFrom}`;
    const remoteDefaultRef = `origin/${defaultBranch}`;
    const localBranchRef = branchedFrom;
    const localDefaultRef = defaultBranch;

    let mergedResult: GitCommandResult | null = null;
    const canCompareRemote =
      (await refExists(repoRoot, remoteBranchRef, deps, signal)) &&
      (await refExists(repoRoot, remoteDefaultRef, deps, signal));
    const canCompareLocal =
      (await refExists(repoRoot, localBranchRef, deps, signal)) &&
      (await refExists(repoRoot, localDefaultRef, deps, signal));
    if (canCompareRemote) {
      mergedResult = await runGit(
        repoRoot,
        ['merge-base', '--is-ancestor', remoteBranchRef, remoteDefaultRef],
        deps,
        signal,
      );
    } else if (canCompareLocal) {
      mergedResult = await runGit(
        repoRoot,
        ['merge-base', '--is-ancestor', localBranchRef, localDefaultRef],
        deps,
        signal,
      );
    }

    if (mergedResult?.ok) {
      logicalBaseBranch = defaultBranch;
    } else if (mergedResult && mergedResult.code === 1) {
      logicalBaseBranch = branchedFrom;
    }
  }

  const preferredRemoteRef = `origin/${logicalBaseBranch}`;
  const remoteBaseRefAvailable = await refExists(
    repoRoot,
    preferredRemoteRef,
    deps,
    signal,
  );
  if (remoteBaseRefAvailable) {
    const comparisonBaseCommit = await gitStdoutOrThrow(
      repoRoot,
      ['rev-parse', `${preferredRemoteRef}^{commit}`],
      deps,
      `Unable to resolve comparison base commit for ${preferredRemoteRef}.`,
      signal,
    );
    return {
      logicalBaseBranch,
      resolvedBaseBranch: logicalBaseBranch,
      resolvedBaseSource: 'remote',
      remoteName: 'origin',
      remoteFetchStatus: 'success',
      localFallbackReason: null,
      comparisonBaseRef: preferredRemoteRef,
      comparisonBaseCommit,
    };
  }

  const localFallbackReason:
    | 'missing_remote'
    | 'fetch_failed'
    | 'missing_remote_ref' =
    remoteFetchStatus === 'success' ? 'missing_remote_ref' : remoteFetchStatus;

  if (!(await refExists(repoRoot, logicalBaseBranch, deps, signal))) {
    throw new Error(
      `Unable to resolve a local fallback base ref for "${logicalBaseBranch}".`,
    );
  }

  const comparisonBaseCommit = await gitStdoutOrThrow(
    repoRoot,
    ['rev-parse', `${logicalBaseBranch}^{commit}`],
    deps,
    `Unable to resolve comparison base commit for ${logicalBaseBranch}.`,
    signal,
  );

  return {
    logicalBaseBranch,
    resolvedBaseBranch: logicalBaseBranch,
    resolvedBaseSource: 'local_fallback',
    remoteName: 'origin',
    remoteFetchStatus: localFallbackReason,
    ...(remoteFetchError ? { remoteFetchError } : {}),
    ...(remoteFetchExitCode !== undefined ? { remoteFetchExitCode } : {}),
    localFallbackReason,
    comparisonBaseRef: logicalBaseBranch,
    comparisonBaseCommit,
  };
}

export const resolvePreparedReviewBasePath = (
  repoRoot: string,
  storyNumber: string,
  outputKey: string,
) =>
  path.join(
    path.resolve(repoRoot),
    'codeInfoTmp',
    'reviews',
    `${storyNumber}-${ensureSafeOutputKey(outputKey)}.json`,
  );

export async function readPreparedReviewBase(
  params: {
    workingRepositoryPath: string;
    storyNumber: string;
    outputKey: string;
  },
  deps?: Partial<ReviewBaseDeps>,
): Promise<{ artifactPath: string; artifact: PreparedReviewBase } | null> {
  const resolvedDeps: ReviewBaseDeps = { ...defaultDeps, ...deps };
  const repoRoot = await resolveReviewRepositoryRoot(
    params.workingRepositoryPath,
    resolvedDeps,
  );
  const artifactPath = resolvePreparedReviewBasePath(
    repoRoot,
    params.storyNumber,
    params.outputKey,
  );
  try {
    const raw = await resolvedDeps.readFile(artifactPath, 'utf8');
    return {
      artifactPath,
      artifact: JSON.parse(raw) as PreparedReviewBase,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
}

export async function prepareReviewBase(
  params: {
    workingRepositoryPath: string;
    outputKey: string;
    basePolicy?: FlowReviewBasePolicy;
    signal?: AbortSignal;
  },
  deps?: Partial<ReviewBaseDeps>,
): Promise<PrepareReviewBaseResult> {
  const resolvedDeps: ReviewBaseDeps = { ...defaultDeps, ...deps };
  const repoRoot = await resolveReviewRepositoryRoot(
    params.workingRepositoryPath,
    resolvedDeps,
    params.signal,
  );
  const outputKey = ensureSafeOutputKey(params.outputKey);
  const basePolicy = params.basePolicy ?? 'branched_from_or_default_if_merged';
  if (basePolicy !== 'branched_from_or_default_if_merged') {
    throw new Error(
      `Unsupported prepareReviewBase basePolicy "${basePolicy}".`,
    );
  }

  const startedAt = resolvedDeps.now();
  const startedAtIso = startedAt.toISOString();
  params.signal?.throwIfAborted();

  const currentPlanPath = path.join(
    repoRoot,
    'codeInfoStatus',
    'flow-state',
    'current-plan.json',
  );
  const currentPlanRaw = await resolvedDeps.readFile(currentPlanPath, 'utf8');
  const currentPlan = JSON.parse(currentPlanRaw) as CurrentPlanPayload;
  const planPath = normalizeOptionalString(currentPlan.plan_path);
  if (!planPath) {
    throw new Error('current-plan.json lacked a usable plan_path.');
  }

  const storyNumber = deriveStoryNumberFromPlanPath(planPath);
  const currentBranch = await gitStdoutOrThrow(
    repoRoot,
    ['branch', '--show-current'],
    resolvedDeps,
    'Unable to determine the current branch for prepareReviewBase.',
    params.signal,
  );
  const branchStoryNumber = deriveBranchStoryNumber(currentBranch);
  if (branchStoryNumber && branchStoryNumber !== storyNumber) {
    throw new Error(
      `Current branch "${currentBranch}" does not match plan story ${storyNumber}.`,
    );
  }

  const headCommit = await gitStdoutOrThrow(
    repoRoot,
    ['rev-parse', 'HEAD^{commit}'],
    resolvedDeps,
    'Unable to resolve HEAD for prepareReviewBase.',
    params.signal,
  );

  const baseResolution = await resolveBaseComparison({
    repoRoot,
    currentBranch,
    branchedFrom: normalizeOptionalString(currentPlan.branched_from),
    deps: resolvedDeps,
    signal: params.signal,
  });

  const reviewDir = path.join(repoRoot, 'codeInfoTmp', 'reviews');
  await resolvedDeps.mkdir(reviewDir, { recursive: true });
  const artifactPath = resolvePreparedReviewBasePath(
    repoRoot,
    storyNumber,
    outputKey,
  );

  const artifact: PreparedReviewBase = {
    story_id: storyNumber,
    plan_path: planPath,
    repo_alias: 'current_repository',
    repo_root: repoRoot,
    branch: currentBranch,
    head_commit: headCommit,
    logical_base_branch: baseResolution.logicalBaseBranch,
    resolved_base_branch: baseResolution.resolvedBaseBranch,
    resolved_base_source: baseResolution.resolvedBaseSource,
    remote_name: baseResolution.remoteName,
    remote_fetch_status: baseResolution.remoteFetchStatus,
    ...(baseResolution.remoteFetchError
      ? { remote_fetch_error: baseResolution.remoteFetchError }
      : {}),
    ...(baseResolution.remoteFetchExitCode !== undefined
      ? { remote_fetch_exit_code: baseResolution.remoteFetchExitCode }
      : {}),
    local_fallback_reason: baseResolution.localFallbackReason,
    comparison_base_ref: baseResolution.comparisonBaseRef,
    comparison_base_commit: baseResolution.comparisonBaseCommit,
    comparison_head_ref: 'HEAD',
    comparison_rule: 'local_head_vs_resolved_base',
    status: 'completed',
    started_at: startedAtIso,
    completed_at: resolvedDeps.now().toISOString(),
  };

  await resolvedDeps.writeFile(
    artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
  );

  return { artifactPath, artifact };
}

export const REVIEW_BASE_CONSTANTS = {
  PROCESS_KILL_SIGNAL,
  GIT_PROCESS_TIMEOUT_MS,
};

export const REVIEW_BASE_DEFAULT_OUTPUT_KEY = 'current-review-base';
