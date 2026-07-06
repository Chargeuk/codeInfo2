import { execFile as execFileCb } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveCodexHome } from '../config/codexConfig.js';
import {
  prepareReviewBase,
  readPreparedReviewBase,
  REVIEW_BASE_DEFAULT_OUTPUT_KEY,
  resolveReviewRepositoryRoot,
  type FlowReviewBasePolicy,
  type PreparedReviewBase,
} from './reviewBase.js';

const execFile = promisify(execFileCb);

export type FlowCodexReviewBasePolicy = FlowReviewBasePolicy;

export type FlowCodexReviewModelSource = 'flow_request_or_step';

export type FlowCodexReviewStepConfig = {
  outputKey: string;
  basePolicy?: FlowCodexReviewBasePolicy;
  modelSource?: FlowCodexReviewModelSource;
  model?: string;
  reasoningEffort?: CodexReviewReasoningEffort;
};

export type CodexReviewReasoningEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

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
  reasoning_effort: CodexReviewReasoningEffort | null;
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
  reasoningEffort: CodexReviewReasoningEffort | null;
  pointerPath: string;
  reviewOutputPath: string;
  pointer: CodexReviewPointer;
};

type CurrentPlanPayload = {
  plan_path?: unknown;
};

type CurrentReviewPayload = {
  review_pass_id?: unknown;
};

type ReviewDispositionStatePayload = {
  story_number?: unknown;
  review_cycle_id?: unknown;
};

type ExecFileOptions = {
  cwd?: string;
  signal?: AbortSignal;
  timeout?: number;
  killSignal?: NodeJS.Signals | number;
  encoding?: BufferEncoding;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
};

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
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
  execFile: (file, args, options) =>
    execFile(file, args, { encoding: 'utf8', ...options }),
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  mkdir: fs.mkdir,
  now: () => new Date(),
  randomHex: (bytes: number) => crypto.randomBytes(bytes).toString('hex'),
};

const GIT_PROCESS_TIMEOUT_MS = 120_000;
const CODEX_REVIEW_TIMEOUT_MS = 1_800_000;
const CODEX_REVIEW_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const PROCESS_KILL_SIGNAL: NodeJS.Signals = 'SIGTERM';
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
  value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

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

const sanitizePassSeed = (value: string): string => {
  const sanitized = value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return sanitized || 'codex-review';
};

const resolveApplicableReviewCycleId = (params: {
  storyNumber: string;
  reviewState: ReviewDispositionStatePayload | null;
}): string | null => {
  const reviewCycleId = normalizeOptionalString(
    params.reviewState?.review_cycle_id,
  );
  if (!reviewCycleId) return null;

  const reviewStateStoryNumber = normalizeOptionalString(
    params.reviewState?.story_number,
  );
  if (reviewStateStoryNumber) {
    return reviewStateStoryNumber === params.storyNumber ? reviewCycleId : null;
  }

  return reviewCycleId.startsWith(`${params.storyNumber}-`)
    ? reviewCycleId
    : null;
};

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

const runGitOrThrow = async (
  repoRoot: string,
  args: readonly string[],
  deps: Pick<CodexReviewDeps, 'execFile'>,
  failureMessage: string,
  signal?: AbortSignal,
): Promise<void> => {
  try {
    await deps.execFile('git', ['-C', repoRoot, ...args], {
      signal,
      encoding: 'utf8',
      timeout: GIT_PROCESS_TIMEOUT_MS,
      killSignal: PROCESS_KILL_SIGNAL,
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error as Error | undefined)?.name === 'AbortError'
    ) {
      throw error;
    }
    throw new Error(failureMessage);
  }
};

const gitStdoutOrThrow = async (
  repoRoot: string,
  args: readonly string[],
  deps: Pick<CodexReviewDeps, 'execFile'>,
  failureMessage: string,
  signal?: AbortSignal,
): Promise<string> => {
  try {
    const result = await deps.execFile('git', ['-C', repoRoot, ...args], {
      signal,
      encoding: 'utf8',
      timeout: GIT_PROCESS_TIMEOUT_MS,
      killSignal: PROCESS_KILL_SIGNAL,
    });
    return result.stdout.trim();
  } catch (error) {
    if (
      signal?.aborted ||
      (error as Error | undefined)?.name === 'AbortError'
    ) {
      throw error;
    }
    throw new Error(failureMessage);
  }
};

const loadOrPrepareReviewBase = async (
  repoRoot: string,
  storyNumber: string,
  currentBranch: string,
  headCommit: string,
  basePolicy: FlowCodexReviewBasePolicy,
  deps: CodexReviewDeps,
  signal?: AbortSignal,
) => {
  const prepared = await readPreparedReviewBase(
    {
      workingRepositoryPath: repoRoot,
      storyNumber,
      outputKey: REVIEW_BASE_DEFAULT_OUTPUT_KEY,
    },
    deps,
  );
  if (
    prepared &&
    prepared.artifact.branch === currentBranch &&
    prepared.artifact.head_commit === headCommit &&
    prepared.artifact.story_id === storyNumber &&
    (await isPreparedBaseStillFresh({
      repoRoot,
      artifact: prepared.artifact,
      deps,
      signal,
    }))
  ) {
    return prepared;
  }

  return prepareReviewBase(
    {
      workingRepositoryPath: repoRoot,
      outputKey: REVIEW_BASE_DEFAULT_OUTPUT_KEY,
      basePolicy,
      signal,
    },
    deps,
  );
};

const isPreparedBaseStillFresh = async (params: {
  repoRoot: string;
  artifact: PreparedReviewBase;
  deps: Pick<CodexReviewDeps, 'execFile'>;
  signal?: AbortSignal;
}): Promise<boolean> => {
  try {
    const currentComparisonBaseCommit = await gitStdoutOrThrow(
      params.repoRoot,
      ['rev-parse', `${params.artifact.comparison_base_ref}^{commit}`],
      params.deps,
      `Unable to resolve comparison base commit for ${params.artifact.comparison_base_ref}.`,
      params.signal,
    );
    return (
      currentComparisonBaseCommit === params.artifact.comparison_base_commit
    );
  } catch (error) {
    if (
      params.signal?.aborted ||
      (error as Error | undefined)?.name === 'AbortError'
    ) {
      throw error;
    }
    return false;
  }
};

const createPinnedReviewBaseRef = async (params: {
  repoRoot: string;
  storyNumber: string;
  comparisonBaseCommit: string;
  passTimestamp: string;
  deps: Pick<CodexReviewDeps, 'execFile' | 'randomHex'>;
  signal?: AbortSignal;
}) => {
  const refName = `refs/codeinfo/review-bases/${params.storyNumber}-${params.passTimestamp}-${params.deps.randomHex(4)}`;
  await runGitOrThrow(
    params.repoRoot,
    ['update-ref', refName, params.comparisonBaseCommit],
    params.deps,
    `Unable to create pinned review base ref for ${params.comparisonBaseCommit}.`,
    params.signal,
  );

  return {
    refName,
    cleanup: async () => {
      await runGitOrThrow(
        params.repoRoot,
        ['update-ref', '-d', refName],
        params.deps,
        `Unable to delete pinned review base ref ${refName}.`,
      );
    },
  };
};

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
    reasoningEffort?: CodexReviewReasoningEffort;
    basePolicy?: FlowCodexReviewBasePolicy;
    signal?: AbortSignal;
  },
  deps?: Partial<CodexReviewDeps>,
): Promise<CodexReviewStepResult> {
  const resolvedDeps: CodexReviewDeps = { ...defaultDeps, ...deps };
  const repoRoot = await resolveReviewRepositoryRoot(
    params.workingRepositoryPath,
    resolvedDeps,
    params.signal,
  );
  const outputKey = ensureSafeOutputKey(params.outputKey);
  const basePolicy = params.basePolicy ?? 'branched_from_or_default_if_merged';
  if (basePolicy !== 'branched_from_or_default_if_merged') {
    throw new Error(`Unsupported codexReview basePolicy "${basePolicy}".`);
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
    'Unable to determine the current branch for codexReview.',
    params.signal,
  );
  const branchStoryNumber = deriveBranchStoryNumber(currentBranch);
  if (branchStoryNumber !== storyNumber) {
    throw new Error(
      `Current branch "${currentBranch}" does not match plan story ${storyNumber}.`,
    );
  }
  const headCommit = await gitStdoutOrThrow(
    repoRoot,
    ['rev-parse', 'HEAD^{commit}'],
    resolvedDeps,
    'Unable to resolve HEAD for codexReview.',
    params.signal,
  );

  const preparedBase = await loadOrPrepareReviewBase(
    repoRoot,
    storyNumber,
    currentBranch,
    headCommit,
    basePolicy,
    resolvedDeps,
    params.signal,
  );
  if (preparedBase.artifact.branch !== currentBranch) {
    throw new Error(
      `Prepared review base branch "${preparedBase.artifact.branch}" no longer matches current branch "${currentBranch}".`,
    );
  }

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
    readJsonIfExists<ReviewDispositionStatePayload>(
      reviewStatePath,
      resolvedDeps,
    ),
  ]);

  const canonicalReviewPassId = normalizeOptionalString(
    currentReview?.review_pass_id,
  );
  const reviewCycleId = resolveApplicableReviewCycleId({
    storyNumber,
    reviewState,
  });
  const shortHead = await gitStdoutOrThrow(
    repoRoot,
    ['rev-parse', '--short', 'HEAD^{commit}'],
    resolvedDeps,
    'Unable to resolve short HEAD for codexReview.',
    params.signal,
  );
  const passTimestamp = formatUtcTimestamp(startedAt);
  const passSeed = sanitizePassSeed(
    canonicalReviewPassId ?? reviewCycleId ?? `${storyNumber}-codex-review`,
  );
  const codexReviewPassId = `${passSeed}-codex-${passTimestamp}-${shortHead}-${resolvedDeps.randomHex(
    4,
  )}`;
  const pinnedBaseRef = await createPinnedReviewBaseRef({
    repoRoot,
    storyNumber,
    comparisonBaseCommit: preparedBase.artifact.comparison_base_commit,
    passTimestamp,
    deps: resolvedDeps,
    signal: params.signal,
  });

  const reviewDir = path.join(repoRoot, 'codeInfoTmp', 'reviews');
  await resolvedDeps.mkdir(reviewDir, { recursive: true });

  const reviewOutputPath = path.join(
    reviewDir,
    `${codexReviewPassId}-codex-review.md`,
  );
  const pointerPath = path.join(reviewDir, `${storyNumber}-${outputKey}.json`);

  const configOverrides = [`review_model=${JSON.stringify(params.modelId)}`];
  if (params.reasoningEffort) {
    configOverrides.push(
      `model_reasoning_effort=${JSON.stringify(params.reasoningEffort)}`,
    );
  }
  const codexArgs = [
    'exec',
    '-C',
    repoRoot,
    'review',
    '--base',
    pinnedBaseRef.refName,
    '-m',
    params.modelId,
    '-o',
    reviewOutputPath,
  ];
  for (const configOverride of configOverrides) {
    codexArgs.push('-c', configOverride);
  }
  let codexFailure: unknown = null;
  try {
    await resolvedDeps.execFile('codex', codexArgs, {
      signal: params.signal,
      timeout: CODEX_REVIEW_TIMEOUT_MS,
      killSignal: PROCESS_KILL_SIGNAL,
      maxBuffer: CODEX_REVIEW_MAX_BUFFER_BYTES,
      env: {
        ...process.env,
        CODEX_HOME: resolveCodexHome(),
      },
    });
  } catch (error) {
    codexFailure = error;
    throw error;
  } finally {
    try {
      await pinnedBaseRef.cleanup();
    } catch (cleanupError) {
      if (!codexFailure) {
        throw cleanupError;
      }
    }
  }

  const completedAtIso = resolvedDeps.now().toISOString();
  const pointer = buildPointer({
    preparedBase: preparedBase.artifact,
    currentBranch,
    headCommit,
    modelId: params.modelId,
    reasoningEffort: params.reasoningEffort ?? null,
    reviewCycleId,
    canonicalReviewPassId: canonicalReviewPassId ?? null,
    codexReviewPassId,
    reviewOutputPath,
    repoRoot,
    startedAtIso,
    completedAtIso,
  });

  await resolvedDeps.writeFile(
    pointerPath,
    `${JSON.stringify(pointer, null, 2)}\n`,
  );

  return {
    modelId: params.modelId,
    reasoningEffort: params.reasoningEffort ?? null,
    pointerPath,
    reviewOutputPath,
    pointer,
  };
}

const buildPointer = (params: {
  preparedBase: PreparedReviewBase;
  currentBranch: string;
  headCommit: string;
  modelId: string;
  reasoningEffort: CodexReviewReasoningEffort | null;
  reviewCycleId: string | null;
  canonicalReviewPassId: string | null;
  codexReviewPassId: string;
  reviewOutputPath: string;
  repoRoot: string;
  startedAtIso: string;
  completedAtIso: string;
}): CodexReviewPointer => ({
  story_id: params.preparedBase.story_id,
  plan_path: params.preparedBase.plan_path,
  review_cycle_id: params.reviewCycleId,
  canonical_review_pass_id: params.canonicalReviewPassId,
  codex_review_pass_id: params.codexReviewPassId,
  repo_alias: 'current_repository',
  repo_root: params.repoRoot,
  branch: params.currentBranch,
  head_commit: params.headCommit,
  model: params.modelId,
  reasoning_effort: params.reasoningEffort,
  logical_base_branch: params.preparedBase.logical_base_branch,
  resolved_base_branch: params.preparedBase.resolved_base_branch,
  resolved_base_source: params.preparedBase.resolved_base_source,
  remote_name: params.preparedBase.remote_name,
  remote_fetch_status: params.preparedBase.remote_fetch_status,
  ...(params.preparedBase.remote_fetch_error
    ? { remote_fetch_error: params.preparedBase.remote_fetch_error }
    : {}),
  ...(params.preparedBase.remote_fetch_exit_code !== undefined
    ? { remote_fetch_exit_code: params.preparedBase.remote_fetch_exit_code }
    : {}),
  local_fallback_reason: params.preparedBase.local_fallback_reason,
  comparison_base_ref: params.preparedBase.comparison_base_ref,
  comparison_base_commit: params.preparedBase.comparison_base_commit,
  comparison_head_ref: 'HEAD',
  comparison_rule: 'local_head_vs_resolved_base',
  review_output_file: toPosixRelative(params.repoRoot, params.reviewOutputPath),
  merge_output_file: null,
  merged_into_canonical_findings: false,
  merged_findings_file: null,
  status: 'completed',
  started_at: params.startedAtIso,
  completed_at: params.completedAtIso,
});
