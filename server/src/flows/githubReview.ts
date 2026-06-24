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
        | 'MALFORMED_ENV_LOCAL'
        | 'MISSING_TOKEN'
        | 'BLANK_TOKEN'
        | 'UPSTREAM_MISSING'
        | 'BASE_BRANCH_MISSING'
        | 'PUSH_FAILED'
        | 'PR_CREATE_FAILED';
      message: string;
      stderr?: string;
      exitCode?: number | null;
    }
  | {
      kind: 'error';
      reason:
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
  plan_path: string;
  story_number: string;
  repository_root: string;
  branch_name: string;
  head_sha: string;
  pull_request: GitHubPullRequestIdentity;
  raw_review_artifact_path: string;
  repository_alias?: string;
  skip_reason?: string;
  failure_reason?: string;
};

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
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

const buildTempPath = (targetPath: string) =>
  `${targetPath}.${process.pid}.${Date.now().toString(36)}.tmp`;

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
): Promise<
  GitHubStepOutcome<{
    planPath: string;
    storyNumber: string;
  }>
> => {
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
  const match = path.basename(planPath).match(/^(\d+)/u);
  if (!match) {
    return {
      kind: 'error',
      reason: 'SCRATCH_INVALID',
      message: 'current-plan handoff plan_path does not expose a story number.',
    };
  }
  return {
    kind: 'ok',
    value: { planPath, storyNumber: match[1] },
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
      kind: 'skip',
      reason: 'MALFORMED_ENV_LOCAL',
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
          'The worked repository does not provide a .env.local file for CODEINFO_PR_TOKEN.',
      };
    }
    return {
      kind: 'skip',
      reason: 'MALFORMED_ENV_LOCAL',
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

  let baseBranch: string | undefined;
  const symbolicHeadResult = await runGitCommand({
    workingRepositoryRoot: params.workingRepositoryRoot,
    args: ['symbolic-ref', `refs/remotes/${upstreamRemote}/HEAD`],
  });
  if (symbolicHeadResult.kind === 'ok') {
    const remoteHead = symbolicHeadResult.value.stdout.trim();
    const baseCandidate = remoteHead.split('/').pop()?.trim();
    if (baseCandidate) {
      baseBranch = baseCandidate;
    }
  }
  if (!baseBranch) {
    const remoteShowResult = await runGitCommand({
      workingRepositoryRoot: params.workingRepositoryRoot,
      args: ['remote', 'show', upstreamRemote],
    });
    if (remoteShowResult.kind === 'ok') {
      const match = remoteShowResult.value.stdout.match(
        /HEAD branch:\s+([^\s]+)/u,
      );
      if (match?.[1]) {
        baseBranch = match[1].trim();
      }
    }
  }
  if (!baseBranch) {
    return {
      kind: 'skip',
      reason: 'BASE_BRANCH_MISSING',
      message:
        'A trustworthy base branch could not be determined from the current upstream remote.',
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
    return {
      kind: 'skip',
      reason: 'PR_CREATE_FAILED',
      message: 'GitHub pull request creation failed for the current branch.',
      stderr: createResult.stderr,
      exitCode: createResult.exitCode,
    };
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

export const writeGitHubReviewScratch = async (params: {
  repository: GitHubRepositoryState;
  pullRequest: GitHubPullRequestIdentity;
  artifact: GitHubReviewArtifact;
}): Promise<GitHubStepOutcome<GitHubCurrentReviewHandoff>> => {
  const planContext = await readCurrentPlanContext(
    params.repository.workingRepositoryRoot,
  );
  if (planContext.kind !== 'ok') return planContext;
  const reviewsRoot = path.join(
    params.repository.workingRepositoryRoot,
    'codeInfoTmp/reviews',
  );
  const rawArtifactPath = path.join(
    reviewsRoot,
    `${planContext.value.storyNumber}-github-review-pr-${params.pullRequest.number}.json`,
  );
  const handoffPath = path.join(
    reviewsRoot,
    `${planContext.value.storyNumber}-current-review.json`,
  );
  try {
    await writeJsonAtomically({
      targetPath: rawArtifactPath,
      value: params.artifact,
    });
    const handoff: GitHubCurrentReviewHandoff = {
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
  const record = parsed as Record<string, unknown>;
  const planPath = normalizeTrimmedString(record.plan_path);
  const storyNumber = normalizeTrimmedString(record.story_number);
  const repositoryRoot = normalizeTrimmedString(record.repository_root);
  const branchName = normalizeTrimmedString(record.branch_name);
  const headSha = normalizeTrimmedString(record.head_sha);
  const rawReviewArtifactPath = normalizeTrimmedString(
    record.raw_review_artifact_path,
  );
  const pullRequest = normalizePullRequestIdentity(record.pull_request);
  if (
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
        'GitHub review handoff is missing required plan, repository, branch, pull request, or artifact fields.',
    };
  }
  return {
    kind: 'ok',
    value: {
      plan_path: planPath,
      story_number: storyNumber,
      repository_root: repositoryRoot,
      branch_name: branchName,
      head_sha: headSha,
      pull_request: pullRequest,
      raw_review_artifact_path: rawReviewArtifactPath,
      ...(normalizeTrimmedString(record.repository_alias)
        ? { repository_alias: normalizeTrimmedString(record.repository_alias) }
        : {}),
      ...(normalizeTrimmedString(record.skip_reason)
        ? { skip_reason: normalizeTrimmedString(record.skip_reason) }
        : {}),
      ...(normalizeTrimmedString(record.failure_reason)
        ? { failure_reason: normalizeTrimmedString(record.failure_reason) }
        : {}),
    },
  };
};
