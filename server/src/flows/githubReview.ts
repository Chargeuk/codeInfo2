import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { parse as parseDotenv } from 'dotenv';

export type GitHubStepOutcome<T> =
  | { kind: 'ok'; value: T }
  | {
      kind: 'skip';
      reason:
        | 'MISSING_ENV_LOCAL'
        | 'MISSING_TOKEN'
        | 'BLANK_TOKEN'
        | 'UPSTREAM_MISSING'
        | 'BASE_BRANCH_MISSING'
        | 'PUSH_FAILED';
      message: string;
      stderr?: string;
      exitCode?: number | null;
    }
  | {
      kind: 'error';
      reason:
        | 'ENV_LOCAL_INVALID'
        | 'ENV_LOCAL_READ_FAILED'
        | 'GIT_COMMAND_FAILED'
        | 'GIT_REMOTE_INVALID'
        | 'GITHUB_CLI_MISSING'
        | 'GITHUB_CLI_SPAWN_FAILED'
        | 'GITHUB_CLI_FAILED'
        | 'INVALID_GITHUB_RESPONSE'
        | 'SCRATCH_INVALID';
      message: string;
      stderr?: string;
      exitCode?: number | null;
    };

export type GitHubRepoToken = {
  token: string;
};

export type GitHubRepositoryState = {
  workingRepositoryRoot: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryFullName: string;
  currentBranch: string;
  headSha: string;
  upstreamRemote: string;
  upstreamBranch: string;
  baseBranch: string;
  remoteUrl: string;
};

export type GitHubPullRequestIdentity = {
  number: number;
  url: string;
  headRefName: string;
  baseRefName: string;
  authorLogin?: string;
  createdAt?: string;
  title?: string;
};

export type GitHubReviewSubmission = {
  id: number;
  user: { login: string };
  body: string;
  state: string;
  submitted_at?: string;
  commit_id?: string;
  html_url?: string;
  author_association?: string;
};

export type GitHubInlineReviewComment = {
  id: number;
  pull_request_review_id?: number;
  user: { login: string };
  body: string;
  path: string;
  line?: number;
  start_line?: number;
  side?: string;
  commit_id?: string;
  in_reply_to_id?: number;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  author_association?: string;
};

export type GitHubReviewArtifact = {
  repository: {
    owner: string;
    name: string;
  };
  pullRequest: GitHubPullRequestIdentity;
  fetchedAt: string;
  reviews: GitHubReviewSubmission[];
  reviewComments: GitHubInlineReviewComment[];
};

export type GitHubCurrentReviewHandoff = {
  handoff_kind: string;
  execution_id: string;
  plan_path: string;
  story_number: string;
  repository_root: string;
  branch_name: string;
  head_sha: string;
  pull_request: GitHubPullRequestIdentity;
  raw_review_artifact_path: string;
  external_review_input_file?: string;
  filtered_review_count?: number;
  filtered_review_comment_count?: number;
  repository_alias?: string;
  skip_reason?: string;
  failure_reason?: string;
};

export type GitHubReviewScratchSelector = {
  selector_kind: string;
  execution_id: string;
  plan_path: string;
  story_number: string;
  repository_root: string;
  branch_name: string;
  handoff_path: string;
};

export type GitHubReviewFeedbackEntry =
  | {
      kind: 'review';
      reviewer: string;
      body: string;
      state: string;
      url?: string;
      submittedAt?: string;
    }
  | {
      kind: 'inline_comment';
      reviewer: string;
      body: string;
      path: string;
      line?: number;
      url?: string;
      createdAt?: string;
    };

export type GitHubCommandFailureDetail = {
  reason: string;
  message: string;
  stderr?: string;
  exitCode?: number | null;
};

export type GitHubLookupRetryDiagnostic = GitHubCommandFailureDetail & {
  attemptNumber: number;
  waitMs: number;
};

export type GitHubCreatePullRequestResult =
  | {
      kind: 'ok';
      value: GitHubPullRequestIdentity;
      lookupDiagnostics: GitHubLookupRetryDiagnostic[];
      createFailure?: GitHubCommandFailureDetail;
    }
  | {
      kind: 'skip';
      reason: string;
      message: string;
      stderr?: string;
      exitCode?: number | null;
      lookupDiagnostics: GitHubLookupRetryDiagnostic[];
      createFailure?: GitHubCommandFailureDetail;
    }
  | {
      kind: 'error';
      reason: string;
      message: string;
      stderr?: string;
      exitCode?: number | null;
      lookupDiagnostics: GitHubLookupRetryDiagnostic[];
      createFailure?: GitHubCommandFailureDetail;
    };

export type GitHubResumedPullRequestResolution =
  | {
      kind: 'ok';
      value: GitHubPullRequestIdentity;
      warnings: string[];
      source: 'persisted_handoff' | 'resumed_context';
    }
  | {
      kind: 'error';
      reason: string;
      message: string;
      stderr?: string;
      exitCode?: number | null;
      warnings: string[];
    };

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type CurrentPlanContext = {
  planPath: string;
  storyNumber: string;
  branchedFrom?: string;
};

type GitHubReviewDeps = {
  mkdir: (
    targetPath: string,
    options?: { recursive?: boolean },
  ) => Promise<void>;
  readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  rename: (fromPath: string, toPath: string) => Promise<void>;
  rm: (
    targetPath: string,
    options?: { force?: boolean; recursive?: boolean },
  ) => Promise<void>;
  runCommand: (params: {
    cwd: string;
    command: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
  }) => Promise<CommandResult>;
  stat: (targetPath: string) => Promise<{ isDirectory: () => boolean }>;
  nowIso: () => string;
  sleep: (ms: number) => Promise<void>;
  writeFile: (
    filePath: string,
    contents: string,
    options?: { encoding?: BufferEncoding; flag?: string },
  ) => Promise<void>;
};

const defaultGitHubReviewDeps: GitHubReviewDeps = {
  mkdir: async (targetPath, options) => {
    await fs.mkdir(targetPath, options);
  },
  readFile: async (filePath, encoding) => await fs.readFile(filePath, encoding),
  rename: async (fromPath, toPath) => {
    await fs.rename(fromPath, toPath);
  },
  rm: async (targetPath, options) => {
    await fs.rm(targetPath, options);
  },
  runCommand: async (params) =>
    await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(params.command, params.args, {
        cwd: params.cwd,
        env: params.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdoutChunks.push(chunk);
      });
      child.stderr?.on('data', (chunk: string) => {
        stderrChunks.push(chunk);
      });
      child.on('error', reject);
      child.on('close', (exitCode) => {
        resolve({
          exitCode,
          stdout: stdoutChunks.join(''),
          stderr: stderrChunks.join(''),
        });
      });
    }),
  stat: async (targetPath) => await fs.stat(targetPath),
  nowIso: () => new Date().toISOString(),
  sleep: async (ms) => await sleep(ms),
  writeFile: async (filePath, contents, options) => {
    await fs.writeFile(filePath, contents, options);
  },
};

const githubReviewDeps: GitHubReviewDeps = {
  ...defaultGitHubReviewDeps,
};

export function __setGitHubReviewDepsForTests(
  overrides: Partial<GitHubReviewDeps>,
) {
  Object.assign(githubReviewDeps, overrides);
}

export function __resetGitHubReviewDepsForTests() {
  Object.assign(githubReviewDeps, defaultGitHubReviewDeps);
}

const normalizeTrimmedString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;

export const GITHUB_REVIEW_HANDOFF_KIND = 'github-review-handoff-v1';
export const GITHUB_REVIEW_SELECTOR_KIND = 'github-review-selector-v1';
export const MAX_GITHUB_REVIEW_SUBMISSIONS = 200;
export const MAX_GITHUB_INLINE_REVIEW_COMMENTS = 200;
const GITHUB_OPEN_PR_LOOKUP_RETRY_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000] as const;
const GITHUB_FILE_LOCK_TIMEOUT_MS = 30_000;
const GITHUB_FILE_LOCK_STALE_MS = 5 * 60_000;

const buildTempPath = (targetPath: string) =>
  `${targetPath}.${process.pid}.${Date.now().toString(36)}.tmp`;

const buildLockPath = (targetPath: string) => `${targetPath}.lock`;

const sleep = async (delayMs: number) =>
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

const toExecutionScopedFileToken = (executionId: string) =>
  executionId.replace(/[^A-Za-z0-9._-]+/gu, '-');

const isPathContainedWithinRoot = (rootPath: string, targetPath: string) => {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return (
    relative.length === 0 ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

const isContainedRelativePath = (rootPath: string, relativePath: string) =>
  !path.isAbsolute(relativePath) &&
  isPathContainedWithinRoot(rootPath, path.resolve(rootPath, relativePath));

export const buildGitHubReviewScratchPaths = (
  workingRepositoryRoot: string,
  storyNumber: string,
) => {
  const reviewsRoot = path.join(workingRepositoryRoot, 'codeInfoTmp/reviews');
  return {
    reviewsRoot,
    selectorPath: path.join(
      reviewsRoot,
      `${storyNumber}-github-review-current.json`,
    ),
    handoffPath: path.join(
      reviewsRoot,
      `${storyNumber}-github-review-current.json`,
    ),
    buildExecutionScopedHandoffPath: (executionId: string) =>
      path.join(
        reviewsRoot,
        `${storyNumber}-github-review-${toExecutionScopedFileToken(executionId)}-current.json`,
      ),
    buildExternalReviewInputPath: (executionId: string) =>
      path.join(
        reviewsRoot,
        `${storyNumber}-github-review-${toExecutionScopedFileToken(executionId)}-external-review-input.md`,
      ),
    buildRawArtifactPath: (executionId: string, pullRequestNumber: number) =>
      path.join(
        reviewsRoot,
        `${storyNumber}-github-review-${toExecutionScopedFileToken(executionId)}-pr-${String(pullRequestNumber)}.json`,
      ),
  };
};

export const resolveCanonicalGitHubReviewScratchPaths = (params: {
  workingRepositoryRoot: string;
  storyNumber: string;
  executionId: string;
  selectorPath?: string;
  handoffPath?: string;
}): GitHubStepOutcome<{
  selectorPath: string;
  handoffPath: string;
}> => {
  const scratchPaths = buildGitHubReviewScratchPaths(
    params.workingRepositoryRoot,
    params.storyNumber,
  );
  const canonicalSelectorPath = scratchPaths.selectorPath;
  const canonicalHandoffPath = scratchPaths.buildExecutionScopedHandoffPath(
    params.executionId,
  );

  if (
    params.selectorPath &&
    (!isPathContainedWithinRoot(
      params.workingRepositoryRoot,
      params.selectorPath,
    ) ||
      path.resolve(params.selectorPath) !== path.resolve(canonicalSelectorPath))
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review selectorPath must stay inside the authoritative execution-scoped scratch root before any resumed filesystem read.',
    };
  }

  if (
    params.handoffPath &&
    (!isPathContainedWithinRoot(
      params.workingRepositoryRoot,
      params.handoffPath,
    ) ||
      path.resolve(params.handoffPath) !== path.resolve(canonicalHandoffPath))
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review handoffPath must stay inside the authoritative execution-scoped scratch root before any resumed filesystem read.',
    };
  }

  return {
    kind: 'ok',
    value: {
      selectorPath: canonicalSelectorPath,
      handoffPath: canonicalHandoffPath,
    },
  };
};

const flattenPaginatedSlurpPayload = (parsed: unknown): unknown[] => {
  if (!Array.isArray(parsed)) {
    return [parsed];
  }
  return parsed.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
};

const buildPagedGitHubApiEndpoint = (params: {
  endpoint: string;
  page: number;
  perPage: number;
}) => {
  const [basePath, rawQuery = ''] = params.endpoint.split('?', 2);
  const searchParams = new URLSearchParams(rawQuery);
  searchParams.set('page', String(params.page));
  searchParams.set('per_page', String(params.perPage));
  return `${basePath}?${searchParams.toString()}`;
};

const parseIsoTimestamp = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const takeMostRecentEntries = <T>(params: {
  entries: readonly T[];
  limit: number;
  getTimestamp: (entry: T) => string | undefined;
  getStableNumericId: (entry: T) => number;
}): T[] => {
  if (params.entries.length <= params.limit) {
    return [...params.entries];
  }
  const rankedEntries = params.entries.map((entry, index) => ({
    entry,
    index,
    timestamp: parseIsoTimestamp(params.getTimestamp(entry)),
    stableNumericId: params.getStableNumericId(entry),
  }));
  rankedEntries.sort((left, right) => {
    const leftTimestamp = left.timestamp;
    const rightTimestamp = right.timestamp;
    if (leftTimestamp !== undefined && rightTimestamp !== undefined) {
      if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
      }
    } else if (leftTimestamp !== undefined) {
      return 1;
    } else if (rightTimestamp !== undefined) {
      return -1;
    }
    if (left.stableNumericId !== right.stableNumericId) {
      return left.stableNumericId - right.stableNumericId;
    }
    return left.index - right.index;
  });
  const selectedIndexes = new Set(
    rankedEntries.slice(-params.limit).map((entry) => entry.index),
  );
  return params.entries.filter((_, index) => selectedIndexes.has(index));
};

const fetchBoundedPaginatedEntries = async <T>(params: {
  workingRepositoryRoot: string;
  token: string;
  endpoint: string;
  limit: number;
  normalize: (entry: unknown) => T | null;
  getTimestamp: (entry: T) => string | undefined;
  getStableNumericId: (entry: T) => number;
}): Promise<GitHubStepOutcome<T[]>> => {
  const perPage = 100;
  let page = 1;
  let acceptedEntries: T[] = [];

  while (true) {
    const endpoint = buildPagedGitHubApiEndpoint({
      endpoint: params.endpoint,
      page,
      perPage,
    });
    const result = await runGitHubCli({
      workingRepositoryRoot: params.workingRepositoryRoot,
      token: params.token,
      args: ['api', endpoint],
    });
    if (result.kind !== 'ok') return result as GitHubStepOutcome<T[]>;
    const parsedPage = parseJson<unknown>(
      result.value.stdout,
      'GitHub API returned invalid JSON',
    );
    if (parsedPage.kind !== 'ok') {
      return parsedPage as GitHubStepOutcome<T[]>;
    }
    const pageEntries = flattenPaginatedSlurpPayload(parsedPage.value);
    const normalizedEntries = pageEntries
      .map((entry) => params.normalize(entry))
      .filter((entry): entry is T => Boolean(entry));
    acceptedEntries = takeMostRecentEntries({
      entries: [...acceptedEntries, ...normalizedEntries],
      limit: params.limit,
      getTimestamp: params.getTimestamp,
      getStableNumericId: params.getStableNumericId,
    });
    if (pageEntries.length < perPage) {
      return { kind: 'ok', value: acceptedEntries };
    }
    page += 1;
  }
};

const parseRepoFromRemoteUrl = (
  remoteUrl: string,
): { host: string; owner: string; name: string } | null => {
  const normalizeGitHubHost = (host: string) => {
    const normalized = host.toLowerCase();
    if (normalized === 'github.com' || normalized === 'ssh.github.com') {
      return 'github.com';
    }
    if (normalized === 'ghe.com') return normalized;
    return null;
  };
  const trimmed = remoteUrl.trim();
  const sshMatch = trimmed.match(
    /^(?:ssh:\/\/)?git@([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/u,
  );
  if (sshMatch) {
    const host = normalizeGitHubHost(sshMatch[1]);
    if (!host) return null;
    return { host, owner: sshMatch[2], name: sshMatch[3] };
  }
  const httpsMatch = trimmed.match(
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/u,
  );
  if (httpsMatch) {
    const host = normalizeGitHubHost(httpsMatch[1]);
    if (!host) return null;
    return { host, owner: httpsMatch[2], name: httpsMatch[3] };
  }
  return null;
};

const readCurrentPlanContext = async (
  workingRepositoryRoot: string,
): Promise<GitHubStepOutcome<CurrentPlanContext>> => {
  const currentPlanPath = path.join(
    workingRepositoryRoot,
    'codeInfoStatus/flow-state/current-plan.json',
  );
  let raw: string;
  try {
    raw = await githubReviewDeps.readFile(currentPlanPath, 'utf8');
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to read current-plan handoff from worked repository.',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : 'current-plan handoff is not valid JSON.',
    };
  }
  const planPath =
    parsed && typeof parsed === 'object'
      ? normalizeTrimmedString((parsed as { plan_path?: unknown }).plan_path)
      : undefined;
  if (!planPath) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message: 'current-plan handoff does not include a usable plan_path.',
    };
  }
  if (!isContainedRelativePath(workingRepositoryRoot, planPath)) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'current-plan handoff plan_path must remain repository-root contained before filesystem access.',
    };
  }
  const match = path.basename(planPath).match(/^(\d+)/u);
  if (!match) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message: 'current-plan handoff plan_path does not expose a story number.',
    };
  }
  const branchedFrom =
    parsed && typeof parsed === 'object'
      ? normalizeTrimmedString(
          (parsed as { branched_from?: unknown }).branched_from,
        )
      : undefined;
  return {
    kind: 'ok',
    value: { planPath, storyNumber: match[1], branchedFrom },
  };
};

const parseEnvLocalForGitHubToken = (
  raw: string,
): GitHubStepOutcome<GitHubRepoToken> => {
  const tokenLines = raw.split(/\r?\n/u);
  const malformedTokenLineIndex = tokenLines.findIndex(
    (line) =>
      /^\s*(?:export\s+)?CODEINFO_PR_TOKEN\b/u.test(line) &&
      !/^\s*(?:export\s+)?CODEINFO_PR_TOKEN\s*=/u.test(line),
  );
  if (malformedTokenLineIndex >= 0) {
    return {
      kind: 'error',
      reason: 'ENV_LOCAL_INVALID',
      message: `.env.local contains an invalid CODEINFO_PR_TOKEN assignment on line ${String(malformedTokenLineIndex + 1)}.`,
    };
  }

  const parsed = parseDotenv(raw);
  if (!Object.prototype.hasOwnProperty.call(parsed, 'CODEINFO_PR_TOKEN')) {
    return {
      kind: 'skip',
      reason: 'MISSING_TOKEN',
      message:
        'CODEINFO_PR_TOKEN is not configured in the worked repository .env.local.',
    };
  }
  const rawToken = parsed.CODEINFO_PR_TOKEN;
  if (typeof rawToken !== 'string') {
    return {
      kind: 'skip',
      reason: 'MISSING_TOKEN',
      message:
        'CODEINFO_PR_TOKEN is not configured in the worked repository .env.local.',
    };
  }
  if (rawToken.trim().length === 0) {
    return {
      kind: 'skip',
      reason: 'BLANK_TOKEN',
      message:
        'CODEINFO_PR_TOKEN is blank in the worked repository .env.local.',
    };
  }
  return {
    kind: 'ok',
    value: { token: rawToken.trim() },
  };
};

export const readWorkedRepositoryGitHubToken = async (params: {
  workingRepositoryRoot: string;
}): Promise<GitHubStepOutcome<GitHubRepoToken>> => {
  const envLocalPath = path.join(params.workingRepositoryRoot, '.env.local');
  let raw: string;
  try {
    raw = await githubReviewDeps.readFile(envLocalPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return {
        kind: 'skip',
        reason: 'MISSING_ENV_LOCAL',
        message:
          'The repository-local GitHub token file `.env.local` is missing.',
      };
    }
    return {
      kind: 'error',
      reason: 'ENV_LOCAL_READ_FAILED',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to read the worked repository .env.local file.',
    };
  }
  return parseEnvLocalForGitHubToken(raw);
};

export const buildGitHubChildProcessEnv = (params: {
  token: string;
  baseEnv?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv => ({
  ...(params.baseEnv ?? process.env),
  GH_TOKEN: params.token,
});

const runGitCommand = async (params: {
  workingRepositoryRoot: string;
  args: string[];
}): Promise<GitHubStepOutcome<CommandResult>> => {
  try {
    const result = await githubReviewDeps.runCommand({
      cwd: params.workingRepositoryRoot,
      command: 'git',
      args: params.args,
    });
    if (result.exitCode !== 0) {
      return {
        kind: 'error',
        reason: 'GIT_COMMAND_FAILED',
        message: `git ${params.args.join(' ')} failed`,
        stderr: result.stderr.trim() || undefined,
        exitCode: result.exitCode,
      };
    }
    return { kind: 'ok', value: result };
  } catch (error) {
    return {
      kind: 'error',
      reason: 'GIT_COMMAND_FAILED',
      message:
        error instanceof Error ? error.message : 'git command execution failed',
    };
  }
};

const runGitHubCli = async (params: {
  workingRepositoryRoot: string;
  args: string[];
  token: string;
}): Promise<GitHubStepOutcome<CommandResult>> => {
  try {
    const result = await githubReviewDeps.runCommand({
      cwd: params.workingRepositoryRoot,
      command: 'gh',
      args: params.args,
      env: buildGitHubChildProcessEnv({ token: params.token }),
    });
    if (result.exitCode !== 0) {
      return {
        kind: 'error',
        reason: 'GITHUB_CLI_FAILED',
        message: `gh ${params.args.join(' ')} failed`,
        stderr: result.stderr.trim() || undefined,
        exitCode: result.exitCode,
      };
    }
    return { kind: 'ok', value: result };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return {
        kind: 'error',
        reason: 'GITHUB_CLI_MISSING',
        message: 'gh is not installed in the supported server runtime.',
      };
    }
    return {
      kind: 'error',
      reason: 'GITHUB_CLI_SPAWN_FAILED',
      message:
        error instanceof Error
          ? error.message
          : 'gh command could not be launched.',
    };
  }
};

export const resolveGitHubRepositoryState = async (params: {
  workingRepositoryRoot: string;
}): Promise<GitHubStepOutcome<GitHubRepositoryState>> => {
  const planContextResult = await readCurrentPlanContext(
    params.workingRepositoryRoot,
  );
  if (planContextResult.kind !== 'ok') {
    return {
      kind: 'skip',
      reason: 'BASE_BRANCH_MISSING',
      message:
        'A trustworthy story-owned base branch could not be resolved from the current-plan handoff.',
    };
  }

  const branchResult = await runGitCommand({
    workingRepositoryRoot: params.workingRepositoryRoot,
    args: ['branch', '--show-current'],
  });
  if (branchResult.kind !== 'ok') return branchResult;
  const currentBranch = branchResult.value.stdout.trim();
  if (!currentBranch) {
    return {
      kind: 'error',
      reason: 'GIT_COMMAND_FAILED',
      message: 'Current branch could not be determined from git state.',
    };
  }

  const headResult = await runGitCommand({
    workingRepositoryRoot: params.workingRepositoryRoot,
    args: ['rev-parse', 'HEAD'],
  });
  if (headResult.kind !== 'ok') return headResult;

  const upstreamResult = await runGitCommand({
    workingRepositoryRoot: params.workingRepositoryRoot,
    args: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
  });
  if (upstreamResult.kind !== 'ok') {
    return {
      kind: 'skip',
      reason: 'UPSTREAM_MISSING',
      message:
        'The current branch does not have an existing upstream remote to use for GitHub review.',
      stderr: upstreamResult.stderr,
      exitCode: upstreamResult.exitCode,
    };
  }
  const upstreamRef = upstreamResult.value.stdout.trim();
  const slashIndex = upstreamRef.indexOf('/');
  if (slashIndex <= 0 || slashIndex === upstreamRef.length - 1) {
    return {
      kind: 'skip',
      reason: 'UPSTREAM_MISSING',
      message:
        'The current branch upstream remote could not be parsed into remote and branch names.',
    };
  }
  const upstreamRemote = upstreamRef.slice(0, slashIndex);
  const upstreamBranch = upstreamRef.slice(slashIndex + 1);

  const remoteUrlResult = await runGitCommand({
    workingRepositoryRoot: params.workingRepositoryRoot,
    args: ['remote', 'get-url', upstreamRemote],
  });
  if (remoteUrlResult.kind !== 'ok') return remoteUrlResult;
  const remoteUrl = remoteUrlResult.value.stdout.trim();
  const parsedRemote = parseRepoFromRemoteUrl(remoteUrl);
  if (!parsedRemote) {
    return {
      kind: 'error',
      reason: 'GIT_REMOTE_INVALID',
      message:
        'The upstream remote URL could not be resolved to a GitHub owner/name repository.',
    };
  }

  const baseBranch = planContextResult.value.branchedFrom;
  if (!baseBranch) {
    return {
      kind: 'skip',
      reason: 'BASE_BRANCH_MISSING',
      message:
        'A trustworthy story-owned base branch could not be determined from the current-plan handoff.',
    };
  }

  return {
    kind: 'ok',
    value: {
      workingRepositoryRoot: params.workingRepositoryRoot,
      repositoryHost: parsedRemote.host,
      repositoryOwner: parsedRemote.owner,
      repositoryName: parsedRemote.name,
      repositoryFullName: `${parsedRemote.owner}/${parsedRemote.name}`,
      currentBranch,
      headSha: headResult.value.stdout.trim(),
      upstreamRemote,
      upstreamBranch,
      baseBranch,
      remoteUrl,
    },
  };
};

export const pushBranchToExistingUpstream = async (params: {
  repository: GitHubRepositoryState;
}): Promise<GitHubStepOutcome<null>> => {
  const result = await runGitCommand({
    workingRepositoryRoot: params.repository.workingRepositoryRoot,
    args: [
      'push',
      params.repository.upstreamRemote,
      `HEAD:${params.repository.upstreamBranch}`,
    ],
  });
  if (result.kind !== 'ok') {
    return {
      kind: 'skip',
      reason: 'PUSH_FAILED',
      message:
        'The current branch could not be pushed to its existing upstream remote for GitHub review.',
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }
  return { kind: 'ok', value: null };
};

const parseJson = <T>(
  stdout: string,
  invalidMessage: string,
): GitHubStepOutcome<T> => {
  try {
    return { kind: 'ok', value: JSON.parse(stdout) as T };
  } catch (error) {
    return {
      kind: 'error',
      reason: 'INVALID_GITHUB_RESPONSE',
      message:
        error instanceof Error
          ? `${invalidMessage}: ${error.message}`
          : invalidMessage,
    };
  }
};

const normalizePullRequestIdentity = (
  value: unknown,
): GitHubPullRequestIdentity | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const number = record.number;
  const url = normalizeTrimmedString(record.html_url ?? record.url);
  const headRefName = normalizeTrimmedString(
    record.headRefName ??
      (record.head &&
        typeof record.head === 'object' &&
        normalizeTrimmedString((record.head as Record<string, unknown>).ref)),
  );
  const baseRefName = normalizeTrimmedString(
    record.baseRefName ??
      (record.base &&
        typeof record.base === 'object' &&
        normalizeTrimmedString((record.base as Record<string, unknown>).ref)),
  );
  if (
    typeof number !== 'number' ||
    !Number.isFinite(number) ||
    !url ||
    !headRefName ||
    !baseRefName
  ) {
    return null;
  }
  const authorLogin =
    normalizeTrimmedString(record.authorLogin) ??
    (record.user && typeof record.user === 'object'
      ? normalizeTrimmedString((record.user as Record<string, unknown>).login)
      : undefined);
  const createdAt = normalizeTrimmedString(
    record.created_at ?? record.createdAt,
  );
  const title = normalizeTrimmedString(record.title);
  return {
    number,
    url,
    headRefName,
    baseRefName,
    ...(authorLogin ? { authorLogin } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(title ? { title } : {}),
  };
};

export const lookupLatestOpenPullRequest = async (params: {
  repository: GitHubRepositoryState;
  token: string;
}): Promise<GitHubStepOutcome<GitHubPullRequestIdentity | null>> => {
  const endpoint = `repos/${params.repository.repositoryFullName}/pulls?state=open&head=${params.repository.repositoryOwner}:${encodeURIComponent(params.repository.upstreamBranch)}&sort=created&direction=desc`;
  const perPage = 100;
  let page = 1;
  let latestPullRequest: GitHubPullRequestIdentity | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  while (true) {
    const pagedEndpoint = buildPagedGitHubApiEndpoint({
      endpoint,
      page,
      perPage,
    });
    const result = await runGitHubCli({
      workingRepositoryRoot: params.repository.workingRepositoryRoot,
      token: params.token,
      args: ['api', pagedEndpoint],
    });
    if (result.kind !== 'ok') return result;
    const parsed = parseJson<unknown>(
      result.value.stdout,
      'GitHub API returned invalid JSON',
    );
    if (parsed.kind !== 'ok') return parsed;
    const pageEntries = flattenPaginatedSlurpPayload(parsed.value);
    for (const entry of pageEntries) {
      const normalized = normalizePullRequestIdentity(entry);
      if (!normalized) continue;
      const candidateTimestamp = normalized.createdAt
        ? Date.parse(normalized.createdAt)
        : Number.NEGATIVE_INFINITY;
      if (candidateTimestamp > latestTimestamp) {
        latestPullRequest = normalized;
        latestTimestamp = candidateTimestamp;
      }
    }
    if (pageEntries.length < perPage) {
      return { kind: 'ok', value: latestPullRequest };
    }
    page += 1;
  }
};

const buildMissingPullRequestLookupFailure = (): GitHubCommandFailureDetail => ({
  reason: 'INVALID_GITHUB_RESPONSE',
  message:
    'GitHub pull request creation completed but no latest open pull request could be resolved for the current branch.',
});

const buildGitHubFailureDetail = (params: {
  result: GitHubStepOutcome<GitHubPullRequestIdentity | null>;
}): GitHubCommandFailureDetail => {
  if (params.result.kind === 'error' || params.result.kind === 'skip') {
    return {
      reason: params.result.reason,
      message: params.result.message,
      stderr: params.result.stderr,
      exitCode: params.result.exitCode,
    };
  }
  return buildMissingPullRequestLookupFailure();
};

const lookupLatestOpenPullRequestWithRetry = async (params: {
  repository: GitHubRepositoryState;
  token: string;
}): Promise<
  | {
      kind: 'ok';
      value: GitHubPullRequestIdentity;
      diagnostics: GitHubLookupRetryDiagnostic[];
    }
  | {
      kind: 'error';
      failure: GitHubCommandFailureDetail;
      diagnostics: GitHubLookupRetryDiagnostic[];
    }
> => {
  const diagnostics: GitHubLookupRetryDiagnostic[] = [];
  for (const [index, waitMs] of GITHUB_OPEN_PR_LOOKUP_RETRY_DELAYS_MS.entries()) {
    if (waitMs > 0) await githubReviewDeps.sleep(waitMs);
    const lookedUp = await lookupLatestOpenPullRequest({
      repository: params.repository,
      token: params.token,
    });
    if (lookedUp.kind === 'ok' && lookedUp.value) {
      return {
        kind: 'ok',
        value: lookedUp.value,
        diagnostics,
      };
    }
    const failure = buildGitHubFailureDetail({
      result: lookedUp,
    });
    diagnostics.push({
      attemptNumber: index + 1,
      waitMs,
      ...failure,
    });
  }
  const failure =
    diagnostics.at(-1) ?? buildMissingPullRequestLookupFailure();
  return {
    kind: 'error',
    failure: {
      reason: failure.reason,
      message: failure.message,
      stderr: failure.stderr,
      exitCode: failure.exitCode,
    },
    diagnostics,
  };
};

const shouldReconcileFailedPullRequestCreate = (
  failure: GitHubStepOutcome<CommandResult>,
) => {
  if (failure.kind !== 'error' || failure.reason !== 'GITHUB_CLI_FAILED') {
    return false;
  }
  const detail = `${failure.message}\n${failure.stderr ?? ''}`.toLowerCase();
  return /already exists|timed? out|timeout|network|connection|unexpected eof|temporar|\b50[234]\b/u.test(
    detail,
  );
};

export const createPullRequest = async (params: {
  repository: GitHubRepositoryState;
  token: string;
  title: string;
  body: string;
}): Promise<GitHubCreatePullRequestResult> => {
  const createResult = await runGitHubCli({
    workingRepositoryRoot: params.repository.workingRepositoryRoot,
    token: params.token,
    args: [
      'pr',
      'create',
      '--repo',
      params.repository.repositoryFullName,
      '--title',
      params.title,
      '--body',
      params.body,
      '--head',
      params.repository.upstreamBranch,
      '--base',
      params.repository.baseBranch,
    ],
  });
  if (createResult.kind !== 'ok') {
    if (shouldReconcileFailedPullRequestCreate(createResult)) {
      const reconciled = await lookupLatestOpenPullRequestWithRetry({
        repository: params.repository,
        token: params.token,
      });
      if (reconciled.kind === 'ok') {
        return {
          kind: 'ok',
          value: reconciled.value,
          lookupDiagnostics: reconciled.diagnostics,
          createFailure: {
            reason: createResult.reason,
            message: createResult.message,
            stderr: createResult.stderr,
            exitCode: createResult.exitCode,
          },
        };
      }
      return {
        kind: 'error',
        reason: reconciled.failure.reason,
        message: reconciled.failure.message,
        stderr: reconciled.failure.stderr,
        exitCode: reconciled.failure.exitCode,
        lookupDiagnostics: reconciled.diagnostics,
        createFailure: {
          reason: createResult.reason,
          message: createResult.message,
          stderr: createResult.stderr,
          exitCode: createResult.exitCode,
        },
      };
    }
    return {
      ...createResult,
      lookupDiagnostics: [],
    };
  }
  const lookedUp = await lookupLatestOpenPullRequestWithRetry({
    repository: params.repository,
    token: params.token,
  });
  if (lookedUp.kind !== 'ok') {
    return {
      kind: 'error',
      reason: lookedUp.failure.reason,
      message: lookedUp.failure.message,
      stderr: lookedUp.failure.stderr,
      exitCode: lookedUp.failure.exitCode,
      lookupDiagnostics: lookedUp.diagnostics,
    };
  }
  return {
    kind: 'ok',
    value: lookedUp.value,
    lookupDiagnostics: lookedUp.diagnostics,
  };
};

const normalizeReviewSubmission = (
  value: unknown,
): GitHubReviewSubmission | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = record.id;
  const login =
    record.user && typeof record.user === 'object'
      ? normalizeTrimmedString((record.user as Record<string, unknown>).login)
      : undefined;
  const body = typeof record.body === 'string' ? record.body : '';
  const state = normalizeTrimmedString(record.state);
  if (typeof id !== 'number' || !Number.isFinite(id) || !login || !state) {
    return null;
  }
  return {
    id,
    user: { login },
    body,
    state,
    ...(normalizeTrimmedString(record.submitted_at)
      ? { submitted_at: normalizeTrimmedString(record.submitted_at) }
      : {}),
    ...(normalizeTrimmedString(record.commit_id)
      ? { commit_id: normalizeTrimmedString(record.commit_id) }
      : {}),
    ...(normalizeTrimmedString(record.html_url)
      ? { html_url: normalizeTrimmedString(record.html_url) }
      : {}),
    ...(normalizeTrimmedString(record.author_association)
      ? {
          author_association: normalizeTrimmedString(record.author_association),
        }
      : {}),
  };
};

const normalizeInlineReviewComment = (
  value: unknown,
): GitHubInlineReviewComment | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = record.id;
  const login =
    record.user && typeof record.user === 'object'
      ? normalizeTrimmedString((record.user as Record<string, unknown>).login)
      : undefined;
  const body = typeof record.body === 'string' ? record.body : '';
  const reviewPath = normalizeTrimmedString(record.path);
  if (typeof id !== 'number' || !Number.isFinite(id) || !login || !reviewPath) {
    return null;
  }
  const line =
    typeof record.line === 'number' && Number.isFinite(record.line)
      ? record.line
      : undefined;
  return {
    id,
    ...(typeof record.pull_request_review_id === 'number' &&
    Number.isFinite(record.pull_request_review_id)
      ? { pull_request_review_id: record.pull_request_review_id }
      : {}),
    user: { login },
    body,
    path: reviewPath,
    ...(line !== undefined ? { line } : {}),
    ...(typeof record.start_line === 'number' &&
    Number.isFinite(record.start_line)
      ? { start_line: record.start_line }
      : {}),
    ...(normalizeTrimmedString(record.side)
      ? { side: normalizeTrimmedString(record.side) }
      : {}),
    ...(normalizeTrimmedString(record.commit_id)
      ? { commit_id: normalizeTrimmedString(record.commit_id) }
      : {}),
    ...(typeof record.in_reply_to_id === 'number' &&
    Number.isFinite(record.in_reply_to_id)
      ? { in_reply_to_id: record.in_reply_to_id }
      : {}),
    ...(normalizeTrimmedString(record.created_at)
      ? { created_at: normalizeTrimmedString(record.created_at) }
      : {}),
    ...(normalizeTrimmedString(record.updated_at)
      ? { updated_at: normalizeTrimmedString(record.updated_at) }
      : {}),
    ...(normalizeTrimmedString(record.html_url)
      ? { html_url: normalizeTrimmedString(record.html_url) }
      : {}),
    ...(normalizeTrimmedString(record.author_association)
      ? {
          author_association: normalizeTrimmedString(record.author_association),
        }
      : {}),
  };
};

export const fetchPullRequestReviews = async (params: {
  repository: GitHubRepositoryState;
  token: string;
  pullRequest: GitHubPullRequestIdentity;
}): Promise<GitHubStepOutcome<GitHubReviewArtifact>> => {
  const reviewsEndpoint = `repos/${params.repository.repositoryFullName}/pulls/${params.pullRequest.number}/reviews`;
  const reviewCommentsEndpoint = `repos/${params.repository.repositoryFullName}/pulls/${params.pullRequest.number}/comments`;
  const [reviewsResult, commentsResult] = await Promise.all([
    fetchBoundedPaginatedEntries({
      workingRepositoryRoot: params.repository.workingRepositoryRoot,
      token: params.token,
      endpoint: reviewsEndpoint,
      limit: MAX_GITHUB_REVIEW_SUBMISSIONS,
      normalize: normalizeReviewSubmission,
      getTimestamp: (review) => review.submitted_at,
      getStableNumericId: (review) => review.id,
    }),
    fetchBoundedPaginatedEntries({
      workingRepositoryRoot: params.repository.workingRepositoryRoot,
      token: params.token,
      endpoint: reviewCommentsEndpoint,
      limit: MAX_GITHUB_INLINE_REVIEW_COMMENTS,
      normalize: normalizeInlineReviewComment,
      getTimestamp: (comment) => comment.created_at,
      getStableNumericId: (comment) => comment.id,
    }),
  ]);
  if (reviewsResult.kind !== 'ok') return reviewsResult;
  if (commentsResult.kind !== 'ok') return commentsResult;
  return {
    kind: 'ok',
    value: {
      repository: {
        owner: params.repository.repositoryOwner,
        name: params.repository.repositoryName,
      },
      pullRequest: params.pullRequest,
      fetchedAt: githubReviewDeps.nowIso(),
      reviews: reviewsResult.value,
      reviewComments: commentsResult.value,
    },
  };
};

export const closePullRequest = async (params: {
  repository: GitHubRepositoryState;
  token: string;
  pullRequest: GitHubPullRequestIdentity;
}): Promise<GitHubStepOutcome<null>> => {
  const result = await runGitHubCli({
    workingRepositoryRoot: params.repository.workingRepositoryRoot,
    token: params.token,
    args: [
      'pr',
      'close',
      String(params.pullRequest.number),
      '--repo',
      params.repository.repositoryFullName,
    ],
  });
  if (result.kind !== 'ok') return result as GitHubStepOutcome<null>;
  return { kind: 'ok', value: null };
};

const writeJsonAtomically = async (params: {
  targetPath: string;
  value: unknown;
}) => {
  const parentDir = path.dirname(params.targetPath);
  const tempPath = buildTempPath(params.targetPath);
  await githubReviewDeps.mkdir(parentDir, { recursive: true });
  try {
    await githubReviewDeps.writeFile(
      tempPath,
      `${JSON.stringify(params.value, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
    await githubReviewDeps.rename(tempPath, params.targetPath);
  } finally {
    await githubReviewDeps.rm(tempPath, { force: true, recursive: true });
  }
};

const writeTextAtomically = async (params: {
  targetPath: string;
  value: string;
}) => {
  const parentDir = path.dirname(params.targetPath);
  const tempPath = buildTempPath(params.targetPath);
  await githubReviewDeps.mkdir(parentDir, { recursive: true });
  try {
    await githubReviewDeps.writeFile(tempPath, params.value, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await githubReviewDeps.rename(tempPath, params.targetPath);
  } finally {
    await githubReviewDeps.rm(tempPath, { force: true, recursive: true });
  }
};

const withExclusiveFileLock = async <T>(params: {
  targetPath: string;
  action: () => Promise<T>;
}): Promise<T> => {
  const lockPath = buildLockPath(params.targetPath);
  const recoveryLockPath = `${lockPath}.recovery`;
  const token = randomUUID();
  const lockContents = JSON.stringify(
    {
      pid: process.pid,
      token,
      acquired_at: githubReviewDeps.nowIso(),
    },
    null,
    2,
  );
  const startedAt = Date.now();
  let acquired = false;
  await githubReviewDeps.mkdir(path.dirname(lockPath), { recursive: true });
  while (Date.now() - startedAt < GITHUB_FILE_LOCK_TIMEOUT_MS) {
    try {
      await githubReviewDeps.writeFile(lockPath, `${lockContents}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') {
        throw error;
      }
      try {
        await githubReviewDeps.mkdir(recoveryLockPath);
        try {
          const rawOwner = await githubReviewDeps
            .readFile(lockPath, 'utf8')
            .catch(() => '');
          let owner: { pid?: unknown; acquired_at?: unknown } | null = null;
          try {
            owner = JSON.parse(rawOwner) as {
              pid?: unknown;
              acquired_at?: unknown;
            };
          } catch {
            owner = null;
          }
          const ownerPid =
            typeof owner?.pid === 'number' && Number.isInteger(owner.pid)
              ? owner.pid
              : null;
          const acquiredAt =
            typeof owner?.acquired_at === 'string'
              ? Date.parse(owner.acquired_at)
              : Number.NaN;
          let ownerAlive = false;
          if (ownerPid && ownerPid > 0) {
            try {
              process.kill(ownerPid, 0);
              ownerAlive = true;
            } catch (ownerError) {
              ownerAlive =
                (ownerError as NodeJS.ErrnoException | undefined)?.code ===
                'EPERM';
            }
          }
          const staleByAge =
            !Number.isFinite(acquiredAt) ||
            Date.now() - acquiredAt > GITHUB_FILE_LOCK_STALE_MS;
          if (!ownerAlive || staleByAge) {
            await githubReviewDeps.rm(lockPath, { force: true });
          }
        } finally {
          await githubReviewDeps.rm(recoveryLockPath, {
            force: true,
            recursive: true,
          });
        }
      } catch (recoveryError) {
        if (
          (recoveryError as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST'
        ) {
          throw recoveryError;
        }
      }
      await sleep(25);
    }
  }
  if (!acquired) {
    throw new Error(`Timed out waiting for the file lock at ${lockPath}.`);
  }
  try {
    return await params.action();
  } finally {
    const ownerRaw = await githubReviewDeps
      .readFile(lockPath, 'utf8')
      .catch(() => '');
    let ownerToken: string | undefined;
    try {
      const owner = JSON.parse(ownerRaw) as { token?: unknown };
      ownerToken = typeof owner.token === 'string' ? owner.token : undefined;
    } catch {
      ownerToken = undefined;
    }
    if (ownerToken !== token) {
      throw new Error(`File lock ownership changed before release: ${lockPath}.`);
    }
    await githubReviewDeps.rm(lockPath, { force: true });
  }
};

const readJsonFile = async <T>(
  targetPath: string,
): Promise<GitHubStepOutcome<T>> => {
  let raw: string;
  try {
    raw = await githubReviewDeps.readFile(targetPath, 'utf8');
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : `Unable to read ${targetPath}.`,
    };
  }
  return parseJson<T>(raw, `JSON file is invalid: ${targetPath}`);
};

const validateGitHubReviewScratchRecord = (params: {
  handoffPath: string;
  record: Record<string, unknown>;
}): GitHubStepOutcome<GitHubCurrentReviewHandoff> => {
  const handoffKind = normalizeTrimmedString(params.record.handoff_kind);
  const executionId = normalizeTrimmedString(params.record.execution_id);
  const planPath = normalizeTrimmedString(params.record.plan_path);
  const storyNumber = normalizeTrimmedString(params.record.story_number);
  const repositoryRoot = normalizeTrimmedString(params.record.repository_root);
  const branchName = normalizeTrimmedString(params.record.branch_name);
  const headSha = normalizeTrimmedString(params.record.head_sha);
  const rawReviewArtifactPath = normalizeTrimmedString(
    params.record.raw_review_artifact_path,
  );
  const externalReviewInputFile = normalizeTrimmedString(
    params.record.external_review_input_file,
  );
  const pullRequest = normalizePullRequestIdentity(params.record.pull_request);
  if (
    handoffKind !== GITHUB_REVIEW_HANDOFF_KIND ||
    !executionId ||
    !planPath ||
    !storyNumber ||
    !repositoryRoot ||
    !branchName ||
    !headSha ||
    !rawReviewArtifactPath ||
    !pullRequest
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review handoff is missing the explicit Task 7 contract marker or required plan, repository, branch, pull request, or artifact fields.',
    };
  }

  if (!path.isAbsolute(repositoryRoot)) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review handoff repository_root must be an absolute path.',
    };
  }

  if (!isContainedRelativePath(repositoryRoot, planPath)) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review handoff plan_path must remain repository-root contained before filesystem access.',
    };
  }

  const scratchPaths = buildGitHubReviewScratchPaths(
    repositoryRoot,
    storyNumber,
  );
  if (
    path.resolve(params.handoffPath) !==
    path.resolve(scratchPaths.buildExecutionScopedHandoffPath(executionId))
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review handoff was not loaded from the authoritative execution-scoped Story 60 GitHub-review scratch path.',
    };
  }

  if (
    !isPathContainedWithinRoot(repositoryRoot, rawReviewArtifactPath) ||
    path.dirname(path.resolve(rawReviewArtifactPath)) !==
      path.resolve(scratchPaths.reviewsRoot) ||
    !new RegExp(
      `^${storyNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-github-review-${toExecutionScopedFileToken(executionId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-pr-\\d+\\.json$`,
      'u',
    ).test(path.basename(rawReviewArtifactPath))
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review handoff raw_review_artifact_path must stay inside the authoritative Story 60 reviews scratch root.',
    };
  }

  if (
    externalReviewInputFile &&
    (!isPathContainedWithinRoot(repositoryRoot, externalReviewInputFile) ||
      path.resolve(externalReviewInputFile) !==
        path.resolve(scratchPaths.buildExternalReviewInputPath(executionId)))
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review handoff external_review_input_file must stay inside the authoritative Story 60 reviews scratch root.',
    };
  }

  return {
    kind: 'ok',
    value: {
      handoff_kind: handoffKind,
      execution_id: executionId,
      plan_path: planPath,
      story_number: storyNumber,
      repository_root: repositoryRoot,
      branch_name: branchName,
      head_sha: headSha,
      pull_request: pullRequest,
      raw_review_artifact_path: rawReviewArtifactPath,
      ...(externalReviewInputFile
        ? { external_review_input_file: externalReviewInputFile }
        : {}),
      ...(typeof params.record.filtered_review_count === 'number' &&
      Number.isFinite(params.record.filtered_review_count)
        ? { filtered_review_count: params.record.filtered_review_count }
        : {}),
      ...(typeof params.record.filtered_review_comment_count === 'number' &&
      Number.isFinite(params.record.filtered_review_comment_count)
        ? {
            filtered_review_comment_count:
              params.record.filtered_review_comment_count,
          }
        : {}),
      ...(normalizeTrimmedString(params.record.repository_alias)
        ? {
            repository_alias: normalizeTrimmedString(
              params.record.repository_alias,
            ),
          }
        : {}),
      ...(normalizeTrimmedString(params.record.skip_reason)
        ? { skip_reason: normalizeTrimmedString(params.record.skip_reason) }
        : {}),
      ...(normalizeTrimmedString(params.record.failure_reason)
        ? {
            failure_reason: normalizeTrimmedString(
              params.record.failure_reason,
            ),
          }
        : {}),
    },
  };
};

const validateGitHubReviewScratchSelectorRecord = (params: {
  selectorPath: string;
  record: Record<string, unknown>;
  expectedExecutionId?: string;
}): GitHubStepOutcome<GitHubReviewScratchSelector> => {
  const selectorKind = normalizeTrimmedString(params.record.selector_kind);
  const executionId = normalizeTrimmedString(params.record.execution_id);
  const planPath = normalizeTrimmedString(params.record.plan_path);
  const storyNumber = normalizeTrimmedString(params.record.story_number);
  const repositoryRoot = normalizeTrimmedString(params.record.repository_root);
  const branchName = normalizeTrimmedString(params.record.branch_name);
  const handoffPath = normalizeTrimmedString(params.record.handoff_path);
  if (
    selectorKind !== GITHUB_REVIEW_SELECTOR_KIND ||
    !executionId ||
    !planPath ||
    !storyNumber ||
    !repositoryRoot ||
    !branchName ||
    !handoffPath
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review selector is missing the explicit Task 12 ownership marker or required plan, repository, branch, execution, or handoff fields.',
    };
  }
  if (
    params.expectedExecutionId &&
    executionId.trim() !== params.expectedExecutionId.trim()
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review selector no longer belongs to the resumed flow execution.',
    };
  }
  if (!path.isAbsolute(repositoryRoot)) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review selector repository_root must be an absolute path.',
    };
  }
  if (!isContainedRelativePath(repositoryRoot, planPath)) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review selector plan_path must remain repository-root contained before filesystem access.',
    };
  }
  const scratchPaths = buildGitHubReviewScratchPaths(repositoryRoot, storyNumber);
  if (
    path.resolve(params.selectorPath) !== path.resolve(scratchPaths.selectorPath)
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review selector was not loaded from the authoritative Story 60 default GitHub-review scratch path.',
    };
  }
  if (
    !isPathContainedWithinRoot(repositoryRoot, handoffPath) ||
    path.resolve(handoffPath) !==
      path.resolve(scratchPaths.buildExecutionScopedHandoffPath(executionId))
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review selector handoff_path must stay inside the authoritative execution-scoped Story 60 reviews scratch root.',
    };
  }
  return {
    kind: 'ok',
    value: {
      selector_kind: selectorKind,
      execution_id: executionId,
      plan_path: planPath,
      story_number: storyNumber,
      repository_root: repositoryRoot,
      branch_name: branchName,
      handoff_path: handoffPath,
    },
  };
};

const updateJsonAtomically = async <T extends Record<string, unknown>>(params: {
  targetPath: string;
  update: (current: T) => T;
}): Promise<GitHubStepOutcome<T>> => {
  try {
    return await withExclusiveFileLock({
      targetPath: params.targetPath,
      action: async () => {
        const current = await readJsonFile<T>(params.targetPath);
        if (current.kind !== 'ok') return current;
        const next = params.update(current.value);
        await writeJsonAtomically({ targetPath: params.targetPath, value: next });
        return { kind: 'ok', value: next };
      },
    });
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : `Unable to update JSON file: ${params.targetPath}`,
    };
  }
};

const appendUniqueImplementationNoteToTaskBlock = (params: {
  targetBlock: string;
  note: string;
}): string => {
  const implHeading = '#### Implementation notes';
  const implIndex = params.targetBlock.indexOf(implHeading);
  if (implIndex === -1) {
    throw new Error(
      'The active task does not expose an Implementation notes section for GitHub review note append.',
    );
  }
  const blockPrefix = params.targetBlock.slice(
    0,
    implIndex + implHeading.length,
  );
  const blockSuffix = params.targetBlock.slice(implIndex + implHeading.length);
  const bullet = `- ${params.note}`;
  const existingBullets = blockSuffix
    .split('\n')
    .map((line) => line.trimEnd());
  if (existingBullets.includes(bullet)) {
    return params.targetBlock;
  }
  const normalizedSuffix =
    blockSuffix.length === 0
      ? '\n'
      : `${blockSuffix}${blockSuffix.endsWith('\n') ? '' : '\n'}`;
  return `${blockPrefix}${normalizedSuffix}${bullet}\n`;
};

const readCurrentTaskNumber = async (
  workingRepositoryRoot: string,
): Promise<string | undefined> => {
  const currentTaskPath = path.join(
    workingRepositoryRoot,
    'codeInfoStatus/flow-state/current-task.json',
  );
  let raw: string;
  try {
    raw = await githubReviewDeps.readFile(currentTaskPath, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const direct =
    typeof (parsed as { task_number?: unknown }).task_number === 'number'
      ? String((parsed as { task_number: number }).task_number)
      : normalizeTrimmedString(
          (parsed as { task_number?: unknown }).task_number,
        );
  if (direct) return direct;
  const selectedTask = (parsed as { selected_task?: { number?: unknown } })
    .selected_task;
  if (
    selectedTask &&
    typeof selectedTask === 'object' &&
    selectedTask.number !== undefined
  ) {
    const number =
      typeof selectedTask.number === 'number'
        ? String(selectedTask.number)
        : normalizeTrimmedString(selectedTask.number);
    if (number) return number;
  }
  return undefined;
};

const appendImplementationNoteToPlan = async (params: {
  workingRepositoryRoot: string;
  note: string;
}): Promise<GitHubStepOutcome<null>> => {
  const planContext = await readCurrentPlanContext(
    params.workingRepositoryRoot,
  );
  if (planContext.kind !== 'ok') return planContext as GitHubStepOutcome<null>;
  const planFullPath = path.join(
    params.workingRepositoryRoot,
    planContext.value.planPath,
  );
  const taskNumber = await readCurrentTaskNumber(params.workingRepositoryRoot);
  try {
    await withExclusiveFileLock({
      targetPath: planFullPath,
      action: async () => {
        const planRaw = await githubReviewDeps.readFile(planFullPath, 'utf8');
        const taskHeading = taskNumber
          ? new RegExp(
              String.raw`((?:^|\n)### Task ${taskNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\.[\s\S]*?)(?=\n### Task \d+\.|$)`,
            )
          : null;
        const taskMatch = taskHeading ? planRaw.match(taskHeading) : null;
        const matchedBlock = taskMatch?.[1];
        const targetBlock = matchedBlock?.replace(/^\n/, '');
        if (!targetBlock) {
          throw new Error(
            'The active plan task could not be resolved for GitHub review note append.',
          );
        }
        const nextBlock = appendUniqueImplementationNoteToTaskBlock({
          targetBlock,
          note: params.note,
        });
        const taskMatchIndex = taskMatch?.index ?? 0;
        const leadingMatchOffset = (matchedBlock?.length ?? 0) - targetBlock.length;
        const targetStart = taskMatchIndex + leadingMatchOffset;
        const nextPlan = `${planRaw.slice(0, targetStart)}${nextBlock}${planRaw.slice(targetStart + targetBlock.length)}`;
        await writeTextAtomically({ targetPath: planFullPath, value: nextPlan });
      },
    });
    return { kind: 'ok', value: null };
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to append GitHub review note to active plan.',
    };
  }
};

export const filterGitHubReviewFeedback = (params: {
  artifact: GitHubReviewArtifact;
}): GitHubReviewFeedbackEntry[] => {
  const prAuthor = normalizeTrimmedString(
    params.artifact.pullRequest.authorLogin,
  );
  const isReviewerAuthored = (login: string) =>
    !prAuthor || login.trim().toLowerCase() !== prAuthor.toLowerCase();

  const submissions: GitHubReviewFeedbackEntry[] = params.artifact.reviews
    .filter(
      (review) =>
        isReviewerAuthored(review.user.login) && review.body.trim().length > 0,
    )
    .map((review) => ({
      kind: 'review' as const,
      reviewer: review.user.login,
      body: review.body.trim(),
      state: review.state,
      ...(review.html_url ? { url: review.html_url } : {}),
      ...(review.submitted_at ? { submittedAt: review.submitted_at } : {}),
    }));

  const inlineComments: GitHubReviewFeedbackEntry[] =
    params.artifact.reviewComments
      .filter(
        (comment) =>
          isReviewerAuthored(comment.user.login) &&
          comment.body.trim().length > 0,
      )
      .map((comment) => ({
        kind: 'inline_comment' as const,
        reviewer: comment.user.login,
        body: comment.body.trim(),
        path: comment.path,
        ...(comment.line !== undefined ? { line: comment.line } : {}),
        ...(comment.html_url ? { url: comment.html_url } : {}),
        ...(comment.created_at ? { createdAt: comment.created_at } : {}),
      }));

  return [...submissions, ...inlineComments];
};

export const buildGitHubExternalReviewInputMarkdown = (params: {
  artifact: GitHubReviewArtifact;
  feedback: GitHubReviewFeedbackEntry[];
}): string => {
  const lines = [
    '# GitHub External Review Input',
    '',
    `Repository: ${params.artifact.repository.owner}/${params.artifact.repository.name}`,
    `Pull Request: #${String(params.artifact.pullRequest.number)} ${params.artifact.pullRequest.url}`,
    `Branch: ${params.artifact.pullRequest.headRefName}`,
    `Fetched At: ${params.artifact.fetchedAt}`,
    '',
    '## Reviewer Feedback',
  ];

  if (params.feedback.length === 0) {
    lines.push(
      '',
      'No reviewer-authored review submissions or inline comments were found.',
    );
    return `${lines.join('\n')}\n`;
  }

  for (const entry of params.feedback) {
    lines.push('');
    if (entry.kind === 'review') {
      lines.push(`### Review Submission - ${entry.reviewer}`);
      lines.push(`- State: ${entry.state}`);
      if (entry.submittedAt) lines.push(`- Submitted At: ${entry.submittedAt}`);
      if (entry.url) lines.push(`- URL: ${entry.url}`);
      lines.push('- Body:');
      lines.push(entry.body);
      continue;
    }
    lines.push(`### Inline Comment - ${entry.reviewer}`);
    lines.push(`- File: ${entry.path}`);
    if (entry.line !== undefined) lines.push(`- Line: ${String(entry.line)}`);
    if (entry.createdAt) lines.push(`- Created At: ${entry.createdAt}`);
    if (entry.url) lines.push(`- URL: ${entry.url}`);
    lines.push('- Body:');
    lines.push(entry.body);
  }

  return `${lines.join('\n')}\n`;
};

export const materializeGitHubExternalReviewInput = async (params: {
  handoff: GitHubCurrentReviewHandoff;
}): Promise<
  GitHubStepOutcome<{
    externalReviewInputPath: string;
    feedback: GitHubReviewFeedbackEntry[];
  }>
> => {
  const artifactResult = await readJsonFile<GitHubReviewArtifact>(
    params.handoff.raw_review_artifact_path,
  );
  if (artifactResult.kind !== 'ok') {
    return artifactResult as GitHubStepOutcome<{
      externalReviewInputPath: string;
      feedback: GitHubReviewFeedbackEntry[];
    }>;
  }
  const feedback = filterGitHubReviewFeedback({
    artifact: artifactResult.value,
  });
  const scratchPaths = buildGitHubReviewScratchPaths(
    params.handoff.repository_root,
    params.handoff.story_number,
  );
  const externalReviewInputPath = scratchPaths.buildExternalReviewInputPath(
    params.handoff.execution_id,
  );
  try {
    await writeTextAtomically({
      targetPath: externalReviewInputPath,
      value: buildGitHubExternalReviewInputMarkdown({
        artifact: artifactResult.value,
        feedback,
      }),
    });
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to write GitHub external review input.',
    };
  }

  const updatedHandoff = await updateJsonAtomically<GitHubCurrentReviewHandoff>(
    {
      targetPath: scratchPaths.buildExecutionScopedHandoffPath(
        params.handoff.execution_id,
      ),
      update: (current) => ({
        ...current,
        external_review_input_file: externalReviewInputPath,
        filtered_review_count: feedback.filter(
          (entry) => entry.kind === 'review',
        ).length,
        filtered_review_comment_count: feedback.filter(
          (entry) => entry.kind === 'inline_comment',
        ).length,
      }),
    },
  );
  if (updatedHandoff.kind !== 'ok') {
    return updatedHandoff as GitHubStepOutcome<{
      externalReviewInputPath: string;
      feedback: GitHubReviewFeedbackEntry[];
    }>;
  }
  return {
    kind: 'ok',
    value: { externalReviewInputPath, feedback },
  };
};

export const appendGitHubReviewPlanNote = async (params: {
  workingRepositoryRoot: string;
  note: string;
}): Promise<GitHubStepOutcome<null>> =>
  await appendImplementationNoteToPlan(params);

export const claimGitHubReviewScratchOwnership = async (params: {
  repository: GitHubRepositoryState;
  executionId: string;
}): Promise<GitHubStepOutcome<GitHubReviewScratchSelector>> => {
  const planContext = await readCurrentPlanContext(
    params.repository.workingRepositoryRoot,
  );
  if (planContext.kind !== 'ok') return planContext;
  const scratchPaths = buildGitHubReviewScratchPaths(
    params.repository.workingRepositoryRoot,
    planContext.value.storyNumber,
  );
  const selector: GitHubReviewScratchSelector = {
    selector_kind: GITHUB_REVIEW_SELECTOR_KIND,
    execution_id: params.executionId,
    plan_path: planContext.value.planPath,
    story_number: planContext.value.storyNumber,
    repository_root: params.repository.workingRepositoryRoot,
    branch_name: params.repository.upstreamBranch,
    handoff_path: scratchPaths.buildExecutionScopedHandoffPath(
      params.executionId,
    ),
  };
  try {
    await writeJsonAtomically({
      targetPath: scratchPaths.selectorPath,
      value: selector,
    });
    return { kind: 'ok', value: selector };
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : 'GitHub review selector write failed.',
    };
  }
};

export const writeGitHubReviewScratch = async (params: {
  repository: GitHubRepositoryState;
  executionId: string;
  pullRequest: GitHubPullRequestIdentity;
  artifact: GitHubReviewArtifact;
  preserveForeignSelectorOwnership?: boolean;
}): Promise<GitHubStepOutcome<GitHubCurrentReviewHandoff>> => {
  const planContext = await readCurrentPlanContext(
    params.repository.workingRepositoryRoot,
  );
  if (planContext.kind !== 'ok') return planContext;
  const scratchPaths = buildGitHubReviewScratchPaths(
    params.repository.workingRepositoryRoot,
    planContext.value.storyNumber,
  );
  const rawArtifactPath = scratchPaths.buildRawArtifactPath(
    params.executionId,
    params.pullRequest.number,
  );
  const handoffPath = scratchPaths.buildExecutionScopedHandoffPath(
    params.executionId,
  );
  try {
    await writeJsonAtomically({
      targetPath: rawArtifactPath,
      value: params.artifact,
    });
    const handoff: GitHubCurrentReviewHandoff = {
      handoff_kind: GITHUB_REVIEW_HANDOFF_KIND,
      execution_id: params.executionId,
      plan_path: planContext.value.planPath,
      story_number: planContext.value.storyNumber,
      repository_root: params.repository.workingRepositoryRoot,
      branch_name: params.repository.upstreamBranch,
      head_sha: params.repository.headSha,
      pull_request: params.pullRequest,
      raw_review_artifact_path: rawArtifactPath,
    };
    await writeJsonAtomically({
      targetPath: handoffPath,
      value: handoff,
    });
    const selectorResult = await readJsonFile<Record<string, unknown>>(
      scratchPaths.selectorPath,
    );
    if (selectorResult.kind === 'ok') {
      const validatedSelector = validateGitHubReviewScratchSelectorRecord({
        selectorPath: scratchPaths.selectorPath,
        record: selectorResult.value,
      });
      if (
        validatedSelector.kind === 'ok' &&
        validatedSelector.value.execution_id !== params.executionId
      ) {
        if (params.preserveForeignSelectorOwnership) {
          return { kind: 'ok', value: handoff };
        }
        return {
          kind: 'error',
          reason: 'SCRATCH_INVALID',
          message:
            'GitHub review selector already belongs to a newer or foreign flow execution and cannot be reclaimed by this run.',
        };
      }
    }
    await writeJsonAtomically({
      targetPath: scratchPaths.selectorPath,
      value: {
        selector_kind: GITHUB_REVIEW_SELECTOR_KIND,
        execution_id: params.executionId,
        plan_path: planContext.value.planPath,
        story_number: planContext.value.storyNumber,
        repository_root: params.repository.workingRepositoryRoot,
        branch_name: params.repository.upstreamBranch,
        handoff_path: handoffPath,
      } satisfies GitHubReviewScratchSelector,
    });
    return { kind: 'ok', value: handoff };
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : 'GitHub review scratch write failed.',
    };
  }
};

export const lookupPullRequestByNumber = async (params: {
  repository: GitHubRepositoryState;
  token: string;
  pullRequestNumber: number;
}): Promise<GitHubStepOutcome<GitHubPullRequestIdentity>> => {
  const endpoint = `repos/${params.repository.repositoryFullName}/pulls/${String(params.pullRequestNumber)}`;
  const result = await runGitHubCli({
    workingRepositoryRoot: params.repository.workingRepositoryRoot,
    token: params.token,
    args: ['api', endpoint],
  });
  if (result.kind !== 'ok') {
    return result as GitHubStepOutcome<GitHubPullRequestIdentity>;
  }
  const parsed = parseJson<unknown>(
    result.value.stdout,
    'GitHub API returned invalid JSON for the pull request lookup.',
  );
  if (parsed.kind !== 'ok') {
    return parsed as GitHubStepOutcome<GitHubPullRequestIdentity>;
  }
  const pullRequest = normalizePullRequestIdentity(parsed.value);
  if (!pullRequest) {
    return {
      kind: 'error',
      reason: 'INVALID_GITHUB_RESPONSE',
      message:
        'GitHub pull request lookup did not return a usable pull request identity.',
    };
  }
  return { kind: 'ok', value: pullRequest };
};

export const reconcileResumedGitHubReviewPullRequest = async (params: {
  repository: GitHubRepositoryState;
  token: string;
  executionId: string;
  handoffPath: string;
  resumedPullRequestNumber: number;
}): Promise<GitHubResumedPullRequestResolution> => {
  const persistedHandoff = await readGitHubReviewScratch({
    handoffPath: params.handoffPath,
    expectedExecutionId: params.executionId,
  });
  const missingHandoffWarning =
    'Resumed GitHub review execution lost its execution-scoped handoff, so the runtime verified the pull request number preserved in the resumed execution context.';
  if (
    persistedHandoff.kind !== 'ok' &&
    /ENOENT|no such file or directory/i.test(persistedHandoff.message)
  ) {
    const resumedPullRequest = await lookupPullRequestByNumber({
      repository: params.repository,
      token: params.token,
      pullRequestNumber: params.resumedPullRequestNumber,
    });
    if (resumedPullRequest.kind !== 'ok') {
      return {
        kind: 'error',
        reason: resumedPullRequest.reason,
        message: resumedPullRequest.message,
        stderr: resumedPullRequest.stderr,
        exitCode: resumedPullRequest.exitCode,
        warnings: [missingHandoffWarning],
      };
    }
    if (
      resumedPullRequest.value.headRefName.trim() !==
      params.repository.upstreamBranch.trim()
    ) {
      return {
        kind: 'error',
        reason: 'SCRATCH_INVALID',
        message: `Resumed pull request #${String(params.resumedPullRequestNumber)} targets head branch ${resumedPullRequest.value.headRefName}, which does not match the execution upstream branch ${params.repository.upstreamBranch}.`,
        warnings: [missingHandoffWarning],
      };
    }
    return {
      kind: 'ok',
      value: resumedPullRequest.value,
      warnings: [missingHandoffWarning],
      source: 'resumed_context',
    };
  }
  if (persistedHandoff.kind !== 'ok') {
    return {
      kind: 'error',
      reason: persistedHandoff.reason,
      message: persistedHandoff.message,
      stderr: persistedHandoff.stderr,
      exitCode: persistedHandoff.exitCode,
      warnings: [],
    };
  }

  const expectedPullRequest = persistedHandoff.value.pull_request;
  if (
    path.resolve(persistedHandoff.value.repository_root) !==
      path.resolve(params.repository.workingRepositoryRoot) ||
    persistedHandoff.value.branch_name.trim() !==
      params.repository.upstreamBranch.trim() ||
    expectedPullRequest.headRefName.trim() !==
      params.repository.upstreamBranch.trim()
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'Resumed GitHub review handoff does not match the active repository root or upstream branch.',
      warnings: [],
    };
  }
  if (expectedPullRequest.number !== params.resumedPullRequestNumber) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message: `Resumed GitHub review execution owns persisted pull request #${String(expectedPullRequest.number)}, but its resumed execution context carried #${String(params.resumedPullRequestNumber)}. The execution will not adopt another pull request.`,
      warnings: [],
    };
  }
  return {
    kind: 'ok',
    value: expectedPullRequest,
    warnings: [],
    source: 'persisted_handoff',
  };
};

export const readGitHubReviewScratch = async (params: {
  handoffPath: string;
  expectedExecutionId?: string;
}): Promise<GitHubStepOutcome<GitHubCurrentReviewHandoff>> => {
  let raw: string;
  try {
    raw = await githubReviewDeps.readFile(params.handoffPath, 'utf8');
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : 'GitHub review handoff could not be read.',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : 'GitHub review handoff is not valid JSON.',
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message: 'GitHub review handoff must be a JSON object.',
    };
  }
  const record = parsed as Record<string, unknown>;
  const selectorKind = normalizeTrimmedString(record.selector_kind);
  if (selectorKind) {
    const selector = validateGitHubReviewScratchSelectorRecord({
      selectorPath: params.handoffPath,
      record,
      expectedExecutionId: params.expectedExecutionId,
    });
    if (selector.kind !== 'ok') return selector;
    const handoffResult = await readJsonFile<Record<string, unknown>>(
      selector.value.handoff_path,
    );
    if (handoffResult.kind !== 'ok') return handoffResult;
    const validatedHandoff = validateGitHubReviewScratchRecord({
      handoffPath: selector.value.handoff_path,
      record: handoffResult.value,
    });
    if (validatedHandoff.kind !== 'ok') return validatedHandoff;
    if (
      validatedHandoff.value.execution_id.trim() !==
      selector.value.execution_id.trim()
    ) {
      return {
        kind: 'error',
        reason: 'SCRATCH_INVALID',
        message:
          'GitHub review selector execution_id does not match the referenced execution-scoped handoff.',
      };
    }
    return validatedHandoff;
  }
  return validateGitHubReviewScratchRecord({
    handoffPath: params.handoffPath,
    record,
  });
};
