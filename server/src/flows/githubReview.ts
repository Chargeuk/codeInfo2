import { spawn } from 'node:child_process';
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

const buildTempPath = (targetPath: string) =>
  `${targetPath}.${process.pid}.${Date.now().toString(36)}.tmp`;

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
    handoffPath: path.join(
      reviewsRoot,
      `${storyNumber}-github-review-current.json`,
    ),
    externalReviewInputPath: path.join(
      reviewsRoot,
      `${storyNumber}-external-review-input.md`,
    ),
    buildRawArtifactPath: (pullRequestNumber: number) =>
      path.join(
        reviewsRoot,
        `${storyNumber}-github-review-pr-${String(pullRequestNumber)}.json`,
      ),
  };
};

const flattenPaginatedSlurpPayload = (parsed: unknown): unknown[] => {
  if (!Array.isArray(parsed)) {
    return [parsed];
  }
  return parsed.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
};

const parseRepoFromRemoteUrl = (
  remoteUrl: string,
): { owner: string; name: string } | null => {
  const trimmed = remoteUrl.trim();
  const sshMatch = trimmed.match(
    /^(?:ssh:\/\/)?git@[^:/]+[:/]([^/]+)\/([^/]+?)(?:\.git)?$/u,
  );
  if (sshMatch) {
    return { owner: sshMatch[1], name: sshMatch[2] };
  }
  const httpsMatch = trimmed.match(
    /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/u,
  );
  if (httpsMatch) {
    return { owner: httpsMatch[1], name: httpsMatch[2] };
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
  const malformedLine = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(
      (line) =>
        line.length > 0 &&
        !line.startsWith('#') &&
        !/^[A-Za-z_][A-Za-z0-9_]*\s*=.*$/u.test(line),
    );
  if (malformedLine) {
    return {
      kind: 'error',
      reason: 'ENV_LOCAL_INVALID',
      message: `.env.local contains an invalid line: ${malformedLine}`,
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

const parsePaginatedArray = (stdout: string): GitHubStepOutcome<unknown[]> => {
  const parsed = parseJson<unknown>(stdout, 'GitHub API returned invalid JSON');
  if (parsed.kind !== 'ok') return parsed;
  return {
    kind: 'ok',
    value: flattenPaginatedSlurpPayload(parsed.value),
  };
};

export const lookupLatestOpenPullRequest = async (params: {
  repository: GitHubRepositoryState;
  token: string;
}): Promise<GitHubStepOutcome<GitHubPullRequestIdentity | null>> => {
  const endpoint = `repos/${params.repository.repositoryFullName}/pulls?state=open&head=${params.repository.repositoryOwner}:${encodeURIComponent(params.repository.currentBranch)}&sort=created&direction=desc&per_page=100`;
  const result = await runGitHubCli({
    workingRepositoryRoot: params.repository.workingRepositoryRoot,
    token: params.token,
    args: ['api', '--paginate', '--slurp', endpoint],
  });
  if (result.kind !== 'ok') return result;
  const parsed = parsePaginatedArray(result.value.stdout);
  if (parsed.kind !== 'ok') return parsed;
  const pulls = parsed.value
    .map((item) => normalizePullRequestIdentity(item))
    .filter((item): item is GitHubPullRequestIdentity => Boolean(item))
    .sort((first, second) => {
      const firstTs = first.createdAt ? Date.parse(first.createdAt) : 0;
      const secondTs = second.createdAt ? Date.parse(second.createdAt) : 0;
      return secondTs - firstTs;
    });
  return { kind: 'ok', value: pulls[0] ?? null };
};

export const createPullRequest = async (params: {
  repository: GitHubRepositoryState;
  token: string;
  title: string;
  body: string;
}): Promise<GitHubStepOutcome<GitHubPullRequestIdentity>> => {
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
      params.repository.currentBranch,
      '--base',
      params.repository.baseBranch,
    ],
  });
  if (createResult.kind !== 'ok') {
    if (createResult.reason === 'GITHUB_CLI_FAILED') {
      const reconciled = await lookupLatestOpenPullRequest({
        repository: params.repository,
        token: params.token,
      });
      if (reconciled.kind === 'ok' && reconciled.value) {
        return { kind: 'ok', value: reconciled.value };
      }
    }
    return createResult;
  }
  const lookedUp = await lookupLatestOpenPullRequest({
    repository: params.repository,
    token: params.token,
  });
  if (lookedUp.kind !== 'ok')
    return lookedUp as GitHubStepOutcome<GitHubPullRequestIdentity>;
  if (!lookedUp.value) {
    return {
      kind: 'error',
      reason: 'INVALID_GITHUB_RESPONSE',
      message:
        'GitHub pull request creation completed but no latest open pull request could be resolved for the current branch.',
    };
  }
  return { kind: 'ok', value: lookedUp.value };
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
  const reviewsEndpoint = `repos/${params.repository.repositoryFullName}/pulls/${params.pullRequest.number}/reviews?per_page=100`;
  const reviewCommentsEndpoint = `repos/${params.repository.repositoryFullName}/pulls/${params.pullRequest.number}/comments?per_page=100`;
  const [reviewsResult, commentsResult] = await Promise.all([
    runGitHubCli({
      workingRepositoryRoot: params.repository.workingRepositoryRoot,
      token: params.token,
      args: ['api', '--paginate', '--slurp', reviewsEndpoint],
    }),
    runGitHubCli({
      workingRepositoryRoot: params.repository.workingRepositoryRoot,
      token: params.token,
      args: ['api', '--paginate', '--slurp', reviewCommentsEndpoint],
    }),
  ]);
  if (reviewsResult.kind !== 'ok') return reviewsResult;
  if (commentsResult.kind !== 'ok') return commentsResult;
  const parsedReviews = parsePaginatedArray(reviewsResult.value.stdout);
  if (parsedReviews.kind !== 'ok') return parsedReviews;
  const parsedComments = parsePaginatedArray(commentsResult.value.stdout);
  if (parsedComments.kind !== 'ok') return parsedComments;
  return {
    kind: 'ok',
    value: {
      repository: {
        owner: params.repository.repositoryOwner,
        name: params.repository.repositoryName,
      },
      pullRequest: params.pullRequest,
      fetchedAt: githubReviewDeps.nowIso(),
      reviews: parsedReviews.value
        .map((item) => normalizeReviewSubmission(item))
        .filter((item): item is GitHubReviewSubmission => Boolean(item)),
      reviewComments: parsedComments.value
        .map((item) => normalizeInlineReviewComment(item))
        .filter((item): item is GitHubInlineReviewComment => Boolean(item)),
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
    path.resolve(params.handoffPath) !== path.resolve(scratchPaths.handoffPath)
  ) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'GitHub review handoff was not loaded from the authoritative Story 60 GitHub-review scratch path.',
    };
  }

  if (
    !isPathContainedWithinRoot(repositoryRoot, rawReviewArtifactPath) ||
    path.dirname(path.resolve(rawReviewArtifactPath)) !==
      path.resolve(scratchPaths.reviewsRoot) ||
    !new RegExp(
      `^${storyNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-github-review-pr-\\d+\\.json$`,
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
        path.resolve(scratchPaths.externalReviewInputPath))
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

const updateJsonAtomically = async <T extends Record<string, unknown>>(params: {
  targetPath: string;
  update: (current: T) => T;
}): Promise<GitHubStepOutcome<T>> => {
  const current = await readJsonFile<T>(params.targetPath);
  if (current.kind !== 'ok') return current;
  try {
    const next = params.update(current.value);
    await writeJsonAtomically({ targetPath: params.targetPath, value: next });
    return { kind: 'ok', value: next };
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
  let planRaw: string;
  try {
    planRaw = await githubReviewDeps.readFile(planFullPath, 'utf8');
  } catch (error) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to read active plan for GitHub review note append.',
    };
  }

  const taskNumber = await readCurrentTaskNumber(params.workingRepositoryRoot);
  const taskHeading = taskNumber
    ? new RegExp(
        String.raw`((?:^|\n)### Task ${taskNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\.[\s\S]*?)(?=\n### Task \d+\.|$)`,
      )
    : null;
  const taskMatch = taskHeading ? planRaw.match(taskHeading) : null;
  const targetBlock = taskMatch?.[1]?.replace(/^\n/, '');
  if (!targetBlock) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'The active plan task could not be resolved for GitHub review note append.',
    };
  }
  const implHeading = '#### Implementation notes';
  const implIndex = targetBlock.indexOf(implHeading);
  if (implIndex === -1) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message:
        'The active task does not expose an Implementation notes section for GitHub review note append.',
    };
  }
  const blockPrefix = targetBlock.slice(0, implIndex + implHeading.length);
  const blockSuffix = targetBlock.slice(implIndex + implHeading.length);
  const bullet = `- ${params.note}`;
  const nextBlock = blockSuffix.includes(bullet)
    ? targetBlock
    : `${blockPrefix}${blockSuffix.endsWith('\n') ? '' : '\n'}\n${bullet}\n`;
  const taskMatchIndex = taskMatch?.index ?? 0;
  const nextPlan = `${planRaw.slice(0, taskMatchIndex)}${nextBlock}${planRaw.slice(taskMatchIndex + targetBlock.length)}`;
  try {
    await writeTextAtomically({ targetPath: planFullPath, value: nextPlan });
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
  const externalReviewInputPath = scratchPaths.externalReviewInputPath;
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
      targetPath: scratchPaths.handoffPath,
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

export const writeGitHubReviewScratch = async (params: {
  repository: GitHubRepositoryState;
  pullRequest: GitHubPullRequestIdentity;
  artifact: GitHubReviewArtifact;
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
    params.pullRequest.number,
  );
  const handoffPath = scratchPaths.handoffPath;
  try {
    await writeJsonAtomically({
      targetPath: rawArtifactPath,
      value: params.artifact,
    });
    const handoff: GitHubCurrentReviewHandoff = {
      handoff_kind: GITHUB_REVIEW_HANDOFF_KIND,
      plan_path: planContext.value.planPath,
      story_number: planContext.value.storyNumber,
      repository_root: params.repository.workingRepositoryRoot,
      branch_name: params.repository.currentBranch,
      head_sha: params.repository.headSha,
      pull_request: params.pullRequest,
      raw_review_artifact_path: rawArtifactPath,
    };
    await writeJsonAtomically({
      targetPath: handoffPath,
      value: handoff,
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

export const readGitHubReviewScratch = async (params: {
  handoffPath: string;
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
  return validateGitHubReviewScratchRecord({
    handoffPath: params.handoffPath,
    record: parsed as Record<string, unknown>,
  });
};
