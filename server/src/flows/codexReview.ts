import { execFile as execFileCb } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export type FlowCodexReviewBasePolicy =
  'branched_from_or_default_if_merged';

export type FlowCodexReviewModelSource = 'flow_request_or_step';

export type FlowCodexReviewStepConfig = {
  outputKey: string;
  basePolicy?: FlowCodexReviewBasePolicy;
  modelSource?: FlowCodexReviewModelSource;
  model?: string;
};

export type CodexReviewPointer = {
  story_id: string;
  plan_path: string;
  review_cycle_id: string | null;
  canonical_review_pass_id: string | null;
  codex_review_pass_id: string;
  repo_alias: 'current_repository';
  repo_root: string;
  branch: string;
  head_commit: string;
  model: string;
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
  local_fallback_reason: null | 'missing_remote' | 'fetch_failed' | 'missing_remote_ref';
  comparison_base_ref: string;
  comparison_base_commit: string;
  comparison_head_ref: 'HEAD';
  comparison_rule: 'local_head_vs_resolved_base';
  review_output_file: string;
  merge_output_file: string | null;
  merged_into_canonical_findings: boolean;
  merged_findings_file: string | null;
  status: 'completed';
  started_at: string;
  completed_at: string;
};

export type CodexReviewStepResult = {
  modelId: string;
  pointerPath: string;
  reviewOutputPath: string;
  pointer: CodexReviewPointer;
};

type CurrentPlanPayload = {
  plan_path?: unknown;
  branched_from?: unknown;
};

type CurrentReviewPayload = {
  review_pass_id?: unknown;
};

type ReviewDispositionStatePayload = {
  review_cycle_id?: unknown;
};

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

type CodexReviewDeps = {
  execFile: ExecFileLike;
  readFile: typeof fs.readFile;
  writeFile: typeof fs.writeFile;
  mkdir: typeof fs.mkdir;
  now: () => Date;
  randomHex: (bytes: number) => string;
};

const defaultDeps: CodexReviewDeps = {
  execFile: (file, args, options) => execFile(file, args, options),
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  mkdir: fs.mkdir,
  now: () => new Date(),
  randomHex: (bytes: number) => crypto.randomBytes(bytes).toString('hex'),
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
  localFallbackReason: null | 'missing_remote' | 'fetch_failed' | 'missing_remote_ref';
  comparisonBaseRef: string;
  comparisonBaseCommit: string;
};

const SAFE_OUTPUT_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;
const STORY_NUMBER_PATTERN = /^(\d{7})-/;
const BRANCH_STORY_PATTERN = /(\d{7})/;

const normalizeOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;

const toPosixRelative = (repoRoot: string, absolutePath: string) =>
  path.relative(repoRoot, absolutePath).split(path.sep).join('/');

const formatUtcTimestamp = (value: Date) =>
  value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

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

const ensureSafeOutputKey = (outputKey: string) => {
  const trimmed = outputKey.trim();
  if (!trimmed || !SAFE_OUTPUT_KEY_PATTERN.test(trimmed)) {
    throw new Error(
      `codexReview outputKey "${outputKey}" must be a safe file-name token.`,
    );
  }
  return trimmed;
};

const sanitizeGitError = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

const readJsonIfExists = async <T>(
  filePath: string,
  deps: Pick<CodexReviewDeps, 'readFile'>,
): Promise<T | null> => {
  try {
    const raw = await deps.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
};

const normalizeBranchedFrom = (value: string | undefined): string | undefined =>
  value
    ?.replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '')
    .trim() || undefined;

async function runGit(
  repoRoot: string,
  args: readonly string[],
  deps: Pick<CodexReviewDeps, 'execFile'>,
): Promise<GitCommandResult> {
  try {
    const result = await deps.execFile('git', ['-C', repoRoot, ...args]);
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const execError = error as
      | (NodeJS.ErrnoException & {
          stdout?: string;
          stderr?: string;
          code?: number | string;
        })
      | undefined;
    return {
      ok: false,
      stdout: execError?.stdout ?? '',
      stderr: execError?.stderr ?? '',
      code:
        typeof execError?.code === 'number' ? execError.code : undefined,
    };
  }
}

async function gitStdoutOrThrow(
  repoRoot: string,
  args: readonly string[],
  deps: Pick<CodexReviewDeps, 'execFile'>,
  failureMessage: string,
): Promise<string> {
  const result = await runGit(repoRoot, args, deps);
  if (!result.ok) {
    throw new Error(failureMessage);
  }
  return result.stdout.trim();
}

async function refExists(
  repoRoot: string,
  ref: string,
  deps: Pick<CodexReviewDeps, 'execFile'>,
): Promise<boolean> {
  const result = await runGit(repoRoot, ['rev-parse', '--verify', ref], deps);
  return result.ok;
}

async function resolveDefaultBranch(
  repoRoot: string,
  remoteFetchStatus: 'success' | 'missing_remote' | 'fetch_failed',
  deps: Pick<CodexReviewDeps, 'execFile'>,
): Promise<string> {
  if (remoteFetchStatus === 'success') {
    const symbolic = await runGit(
      repoRoot,
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      deps,
    );
    if (symbolic.ok) {
      const normalized = symbolic.stdout.trim().replace(/^origin\//, '');
      if (normalized) return normalized;
    }
  }

  for (const candidate of ['main', 'master', 'develop']) {
    if (
      (await refExists(repoRoot, candidate, deps)) ||
      (await refExists(repoRoot, `origin/${candidate}`, deps))
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
  deps: Pick<CodexReviewDeps, 'execFile'>;
}): Promise<BaseResolution> {
  const { repoRoot, currentBranch, deps } = params;
  const branchedFrom = normalizeBranchedFrom(params.branchedFrom);

  const remoteExists = await runGit(
    repoRoot,
    ['remote', 'get-url', 'origin'],
    deps,
  );
  let remoteFetchStatus: 'success' | 'missing_remote' | 'fetch_failed' =
    remoteExists.ok ? 'success' : 'missing_remote';
  let remoteFetchError: string | undefined;
  let remoteFetchExitCode: number | undefined;

  if (remoteExists.ok) {
    const fetched = await runGit(repoRoot, ['fetch', '--prune', 'origin'], deps);
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
    if (
      remoteFetchStatus === 'success' &&
      (await refExists(repoRoot, remoteBranchRef, deps)) &&
      (await refExists(repoRoot, remoteDefaultRef, deps))
    ) {
      mergedResult = await runGit(
        repoRoot,
        ['merge-base', '--is-ancestor', remoteBranchRef, remoteDefaultRef],
        deps,
      );
    } else if (
      remoteFetchStatus !== 'success' &&
      (await refExists(repoRoot, localBranchRef, deps)) &&
      (await refExists(repoRoot, localDefaultRef, deps))
    ) {
      mergedResult = await runGit(
        repoRoot,
        ['merge-base', '--is-ancestor', localBranchRef, localDefaultRef],
        deps,
      );
    }

    if (mergedResult?.ok) {
      logicalBaseBranch = defaultBranch;
    } else if (mergedResult && mergedResult.code === 1) {
      logicalBaseBranch = branchedFrom;
    }
  }

  const preferredRemoteRef = `origin/${logicalBaseBranch}`;
  if (
    remoteFetchStatus === 'success' &&
    (await refExists(repoRoot, preferredRemoteRef, deps))
  ) {
    const comparisonBaseCommit = await gitStdoutOrThrow(
      repoRoot,
      ['rev-parse', `${preferredRemoteRef}^{commit}`],
      deps,
      `Unable to resolve comparison base commit for ${preferredRemoteRef}.`,
    );
    return {
      logicalBaseBranch,
      resolvedBaseBranch: logicalBaseBranch,
      resolvedBaseSource: 'remote',
      remoteName: 'origin',
      remoteFetchStatus: 'success',
      ...(remoteFetchError ? { remoteFetchError } : {}),
      ...(remoteFetchExitCode !== undefined ? { remoteFetchExitCode } : {}),
      localFallbackReason: null,
      comparisonBaseRef: preferredRemoteRef,
      comparisonBaseCommit,
    };
  }

  const localFallbackReason: 'missing_remote' | 'fetch_failed' | 'missing_remote_ref' =
    remoteFetchStatus === 'success' ? 'missing_remote_ref' : remoteFetchStatus;

  if (!(await refExists(repoRoot, logicalBaseBranch, deps))) {
    throw new Error(
      `Unable to resolve a local fallback base ref for "${logicalBaseBranch}".`,
    );
  }

  const comparisonBaseCommit = await gitStdoutOrThrow(
    repoRoot,
    ['rev-parse', `${logicalBaseBranch}^{commit}`],
    deps,
    `Unable to resolve comparison base commit for ${logicalBaseBranch}.`,
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

export function resolveCodexReviewModel(params: {
  requestedModelId?: string;
  stepModelId?: string;
}): string | null {
  const requested = normalizeOptionalString(params.requestedModelId);
  if (requested) return requested;
  const stepModel = normalizeOptionalString(params.stepModelId);
  return stepModel ?? null;
}

export async function runCodexReviewStep(
  params: {
    workingRepositoryPath: string;
    outputKey: string;
    modelId: string;
    basePolicy?: FlowCodexReviewBasePolicy;
  },
  deps?: Partial<CodexReviewDeps>,
): Promise<CodexReviewStepResult> {
  const resolvedDeps: CodexReviewDeps = { ...defaultDeps, ...deps };
  const repoRoot = path.resolve(params.workingRepositoryPath);
  const outputKey = ensureSafeOutputKey(params.outputKey);
  const basePolicy =
    params.basePolicy ?? 'branched_from_or_default_if_merged';
  if (basePolicy !== 'branched_from_or_default_if_merged') {
    throw new Error(`Unsupported codexReview basePolicy "${basePolicy}".`);
  }

  const startedAt = resolvedDeps.now();
  const startedAtIso = startedAt.toISOString();
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
    'Unable to determine the current branch for codexReview.',
  );
  const branchStoryNumber = deriveBranchStoryNumber(currentBranch);
  if (branchStoryNumber && branchStoryNumber !== storyNumber) {
    throw new Error(
      `Current branch "${currentBranch}" does not match plan story ${storyNumber}.`,
    );
  }

  const baseResolution = await resolveBaseComparison({
    repoRoot,
    currentBranch,
    branchedFrom: normalizeOptionalString(currentPlan.branched_from),
    deps: resolvedDeps,
  });

  const currentReviewPath = path.join(
    repoRoot,
    'codeInfoTmp',
    'reviews',
    `${storyNumber}-current-review.json`,
  );
  const reviewStatePath = path.join(
    repoRoot,
    'codeInfoStatus',
    'flow-state',
    'review-disposition-state.json',
  );
  const [currentReview, reviewState] = await Promise.all([
    readJsonIfExists<CurrentReviewPayload>(currentReviewPath, resolvedDeps),
    readJsonIfExists<ReviewDispositionStatePayload>(reviewStatePath, resolvedDeps),
  ]);

  const canonicalReviewPassId = normalizeOptionalString(
    currentReview?.review_pass_id,
  );
  const reviewCycleId = normalizeOptionalString(reviewState?.review_cycle_id) ?? null;
  const headCommit = await gitStdoutOrThrow(
    repoRoot,
    ['rev-parse', 'HEAD^{commit}'],
    resolvedDeps,
    'Unable to resolve HEAD for codexReview.',
  );
  const shortHead = await gitStdoutOrThrow(
    repoRoot,
    ['rev-parse', '--short', 'HEAD^{commit}'],
    resolvedDeps,
    'Unable to resolve short HEAD for codexReview.',
  );
  const passTimestamp = formatUtcTimestamp(startedAt);
  const passSeed =
    canonicalReviewPassId ?? reviewCycleId ?? `${storyNumber}-codex-review`;
  const codexReviewPassId = `${passSeed}-codex-${passTimestamp}-${shortHead}-${resolvedDeps.randomHex(
    4,
  )}`;

  const reviewDir = path.join(repoRoot, 'codeInfoTmp', 'reviews');
  await resolvedDeps.mkdir(reviewDir, { recursive: true });

  const reviewOutputPath = path.join(
    reviewDir,
    `${codexReviewPassId}-codex-review.md`,
  );
  const pointerPath = path.join(reviewDir, `${storyNumber}-${outputKey}.json`);

  const configOverride = `review_model=${JSON.stringify(params.modelId)}`;
  await resolvedDeps.execFile('codex', [
    'exec',
    'review',
    '-C',
    repoRoot,
    '--base',
    baseResolution.resolvedBaseBranch,
    '-m',
    params.modelId,
    '-c',
    configOverride,
    '-o',
    reviewOutputPath,
  ]);

  const completedAtIso = resolvedDeps.now().toISOString();
  const pointer: CodexReviewPointer = {
    story_id: storyNumber,
    plan_path: planPath,
    review_cycle_id: reviewCycleId,
    canonical_review_pass_id: canonicalReviewPassId ?? null,
    codex_review_pass_id: codexReviewPassId,
    repo_alias: 'current_repository',
    repo_root: repoRoot,
    branch: currentBranch,
    head_commit: headCommit,
    model: params.modelId,
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
    review_output_file: toPosixRelative(repoRoot, reviewOutputPath),
    merge_output_file: null,
    merged_into_canonical_findings: false,
    merged_findings_file: null,
    status: 'completed',
    started_at: startedAtIso,
    completed_at: completedAtIso,
  };

  await resolvedDeps.writeFile(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`);

  return {
    modelId: params.modelId,
    pointerPath,
    reviewOutputPath,
    pointer,
  };
}
