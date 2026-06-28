import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  __resetGitHubReviewDepsForTests,
  __setGitHubReviewDepsForTests,
  buildGitHubChildProcessEnv,
  createPullRequest,
  fetchPullRequestReviews,
  lookupLatestOpenPullRequest,
  MAX_GITHUB_INLINE_REVIEW_COMMENTS,
  MAX_GITHUB_REVIEW_SUBMISSIONS,
  pushBranchToExistingUpstream,
  readWorkedRepositoryGitHubToken,
  resolveGitHubRepositoryState,
  type GitHubRepositoryState,
} from '../../flows/githubReview.js';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows/github-review',
);

afterEach(() => {
  __resetGitHubReviewDepsForTests();
});

const createTempRepo = async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'github-review-'));
  await fs.mkdir(path.join(repoRoot, 'codeInfoStatus/flow-state'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(repoRoot, 'codeInfoStatus/flow-state/current-plan.json'),
    JSON.stringify(
      {
        plan_path:
          'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
        branched_from: 'main',
      },
      null,
      2,
    ),
    'utf8',
  );
  return {
    repoRoot,
    cleanup: async () => {
      await fs.rm(repoRoot, { recursive: true, force: true });
    },
  };
};

const baseRepositoryState = (
  workingRepositoryRoot: string,
): GitHubRepositoryState => ({
  workingRepositoryRoot,
  repositoryOwner: 'example',
  repositoryName: 'repo',
  repositoryFullName: 'example/repo',
  currentBranch:
    'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
  headSha: 'abc123',
  upstreamRemote: 'origin',
  upstreamBranch:
    'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
  baseBranch: 'main',
  remoteUrl: 'https://github.com/example/repo.git',
});

test('repo-local token reader keeps missing opt-in cases on skip and surfaces malformed or unreadable .env.local faults as errors', async () => {
  const tempRepo = await createTempRepo();
  try {
    const missingFile = await readWorkedRepositoryGitHubToken({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(missingFile.kind, 'skip');
    assert.equal(missingFile.reason, 'MISSING_ENV_LOCAL');

    await fs.writeFile(path.join(tempRepo.repoRoot, '.env.local'), 'FOO=bar\n');
    const missingKey = await readWorkedRepositoryGitHubToken({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(missingKey.kind, 'skip');
    assert.equal(missingKey.reason, 'MISSING_TOKEN');

    await fs.writeFile(
      path.join(tempRepo.repoRoot, '.env.local'),
      'CODEINFO_PR_TOKEN=   \n',
    );
    const blankToken = await readWorkedRepositoryGitHubToken({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(blankToken.kind, 'skip');
    assert.equal(blankToken.reason, 'BLANK_TOKEN');

    await fs.writeFile(path.join(tempRepo.repoRoot, '.env.local'), 'BROKEN\n');
    const malformed = await readWorkedRepositoryGitHubToken({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(malformed.kind, 'error');
    assert.equal(malformed.reason, 'ENV_LOCAL_INVALID');

    await fs.rm(path.join(tempRepo.repoRoot, '.env.local'), { force: true });
    await fs.mkdir(path.join(tempRepo.repoRoot, '.env.local'));
    const directoryShaped = await readWorkedRepositoryGitHubToken({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(directoryShaped.kind, 'error');
    assert.equal(directoryShaped.reason, 'ENV_LOCAL_READ_FAILED');

    __setGitHubReviewDepsForTests({
      readFile: async () => {
        const error = new Error('permission denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      },
    });
    const permissionDenied = await readWorkedRepositoryGitHubToken({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(permissionDenied.kind, 'error');
    assert.equal(permissionDenied.reason, 'ENV_LOCAL_READ_FAILED');
  } finally {
    await tempRepo.cleanup();
  }
});

test('GitHub child-process env is scoped and does not mutate the base environment', () => {
  const baseEnv = { EXISTING: '1' } as NodeJS.ProcessEnv;
  const childEnv = buildGitHubChildProcessEnv({
    token: 'secret-token',
    baseEnv,
  });

  assert.equal(baseEnv.GH_TOKEN, undefined);
  assert.equal(childEnv.EXISTING, '1');
  assert.equal(childEnv.GH_TOKEN, 'secret-token');
  assert.notEqual(childEnv, baseEnv);
});

test('repository-state resolution reads current branch, upstream remote, and story-owned base branch from the plan handoff', async () => {
  const tempRepo = await createTempRepo();
  try {
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        const joined = params.args.join(' ');
        if (joined === 'branch --show-current') {
          return { exitCode: 0, stdout: 'feature/0000060-demo\n', stderr: '' };
        }
        if (joined === 'rev-parse HEAD') {
          return { exitCode: 0, stdout: 'deadbeef\n', stderr: '' };
        }
        if (joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') {
          return {
            exitCode: 0,
            stdout: 'origin/feature/0000060-demo\n',
            stderr: '',
          };
        }
        if (joined === 'remote get-url origin') {
          return {
            exitCode: 0,
            stdout: 'git@github.com:example/repo.git\n',
            stderr: '',
          };
        }
        throw new Error(`Unexpected command: ${joined}`);
      },
    });

    const resolved = await resolveGitHubRepositoryState({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(resolved.kind, 'ok');
    assert.equal(resolved.value.repositoryFullName, 'example/repo');
    assert.equal(resolved.value.currentBranch, 'feature/0000060-demo');
    assert.equal(resolved.value.baseBranch, 'main');
    assert.equal(resolved.value.upstreamRemote, 'origin');
  } finally {
    await tempRepo.cleanup();
  }
});

test('repository-state resolution reports missing story-owned base branch and upstream push failures explicitly', async () => {
  const tempRepo = await createTempRepo();
  try {
    await fs.writeFile(
      path.join(tempRepo.repoRoot, 'codeInfoStatus/flow-state/current-plan.json'),
      JSON.stringify(
        {
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
        },
        null,
        2,
      ),
      'utf8',
    );
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        const joined = params.args.join(' ');
        if (joined === 'branch --show-current') {
          return { exitCode: 0, stdout: 'feature/0000060-demo\n', stderr: '' };
        }
        if (joined === 'rev-parse HEAD') {
          return { exitCode: 0, stdout: 'deadbeef\n', stderr: '' };
        }
        if (joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') {
          return {
            exitCode: 0,
            stdout: 'origin/feature/0000060-demo\n',
            stderr: '',
          };
        }
        if (joined === 'remote get-url origin') {
          return {
            exitCode: 0,
            stdout: 'https://github.com/example/repo.git\n',
            stderr: '',
          };
        }
        throw new Error(`Unexpected command: ${joined}`);
      },
    });

    const noBase = await resolveGitHubRepositoryState({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(noBase.kind, 'skip');
    assert.equal(noBase.reason, 'BASE_BRANCH_MISSING');

    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        const joined = params.args.join(' ');
        if (joined === 'git push') {
          throw new Error('unexpected');
        }
        if (joined.startsWith('push ')) {
          return { exitCode: 1, stdout: '', stderr: 'permission denied' };
        }
        throw new Error(`Unexpected command: ${joined}`);
      },
    });
    const pushFailure = await pushBranchToExistingUpstream({
      repository: baseRepositoryState(tempRepo.repoRoot),
    });
    assert.equal(pushFailure.kind, 'skip');
    assert.equal(pushFailure.reason, 'PUSH_FAILED');
  } finally {
    await tempRepo.cleanup();
  }
});

test('GitHub PR creation keeps lower-layer runtime failures as errors unless replay reconciliation proves the PR already exists', async () => {
  const tempRepo = await createTempRepo();
  try {
    __setGitHubReviewDepsForTests({
      runCommand: async () => {
        const error = new Error('gh not found') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      },
    });
    const missingBinary = await createPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      title: 'title',
      body: 'body',
    });
    assert.equal(missingBinary.kind, 'error');
    assert.equal(missingBinary.reason, 'GITHUB_CLI_MISSING');

    __setGitHubReviewDepsForTests({
      runCommand: async () => {
        throw new Error('spawn EPERM');
      },
    });
    const spawnFailure = await createPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      title: 'title',
      body: 'body',
    });
    assert.equal(spawnFailure.kind, 'error');
    assert.equal(spawnFailure.reason, 'GITHUB_CLI_SPAWN_FAILED');

    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        if (params.args[0] === 'pr' && params.args[1] === 'create') {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'gh api failed',
          };
        }
        return {
          exitCode: 0,
          stdout: '[]',
          stderr: '',
        };
      },
    });
    const nonZeroExit = await createPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      title: 'title',
      body: 'body',
    });
    assert.equal(nonZeroExit.kind, 'error');
    assert.equal(nonZeroExit.reason, 'GITHUB_CLI_FAILED');
  } finally {
    await tempRepo.cleanup();
  }
});

test('latest-open PR lookup uses explicit repository-plus-branch filtering and ambiguous post-create replay reconciles to the existing PR', async () => {
  const tempRepo = await createTempRepo();
  try {
    const pullsSlurp = await fs.readFile(
      path.join(fixturesDir, 'pulls-slurp.json'),
      'utf8',
    );
    const seenArgs: string[][] = [];
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        seenArgs.push(params.args);
        if (params.args[0] === 'pr' && params.args[1] === 'create') {
          return {
            exitCode: 0,
            stdout: 'https://github.com/example/repo/pull/45\n',
            stderr: '',
          };
        }
        return {
          exitCode: 0,
          stdout: pullsSlurp,
          stderr: '',
        };
      },
    });

    const latest = await lookupLatestOpenPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
    });
    assert.equal(latest.kind, 'ok');
    assert.equal(latest.value?.number, 45);

    const created = await createPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      title: 'Story review',
      body: 'body',
    });
    assert.equal(created.kind, 'ok');
    assert.equal(created.value.number, 45);
    assert.ok(
      seenArgs.some((args) =>
        args
          .join(' ')
          .includes(
            'repos/example/repo/pulls?state=open&head=example:feature%2F0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
        ),
      ),
    );

    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        if (params.args[0] === 'pr' && params.args[1] === 'create') {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'connection dropped after create',
          };
        }
        return {
          exitCode: 0,
          stdout: pullsSlurp,
          stderr: '',
        };
      },
    });

    const replayResolved = await createPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      title: 'Story review',
      body: 'body',
    });
    assert.equal(replayResolved.kind, 'ok');
    assert.equal(replayResolved.value.number, 45);
  } finally {
    await tempRepo.cleanup();
  }
});

test('review fetch preserves paginated review submissions and inline review comments', async () => {
  const tempRepo = await createTempRepo();
  try {
    const reviewsSlurp = await fs.readFile(
      path.join(fixturesDir, 'reviews-slurp.json'),
      'utf8',
    );
    const commentsSlurp = await fs.readFile(
      path.join(fixturesDir, 'comments-slurp.json'),
      'utf8',
    );
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        const endpoint = params.args.at(-1) ?? '';
        if (endpoint.includes('/reviews?')) {
          return { exitCode: 0, stdout: reviewsSlurp, stderr: '' };
        }
        if (endpoint.includes('/comments?')) {
          return { exitCode: 0, stdout: commentsSlurp, stderr: '' };
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      },
    });

    const fetched = await fetchPullRequestReviews({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      pullRequest: {
        number: 45,
        url: 'https://github.com/example/repo/pull/45',
        headRefName: baseRepositoryState(tempRepo.repoRoot).currentBranch,
        baseRefName: 'main',
      },
    });
    assert.equal(fetched.kind, 'ok');
    assert.equal(fetched.value.reviews.length, 2);
    assert.equal(fetched.value.reviewComments.length, 2);
    assert.equal(fetched.value.reviewComments[1].in_reply_to_id, 2001);
  } finally {
    await tempRepo.cleanup();
  }
});

test('review fetch publishes one bounded producer corpus after paginated normalization', async () => {
  const tempRepo = await createTempRepo();
  try {
    const reviewCount = MAX_GITHUB_REVIEW_SUBMISSIONS + 5;
    const commentCount = MAX_GITHUB_INLINE_REVIEW_COMMENTS + 5;
    const reviewPages = [
      Array.from({ length: Math.ceil(reviewCount / 2) }, (_, index) => ({
        id: 1000 + index + 1,
        user: { login: `reviewer-${String(index + 1)}` },
        body: `Review body ${String(index + 1)}`,
        state: 'COMMENTED',
        submitted_at: new Date(
          Date.UTC(2026, 5, 24, 10, 0, index + 1),
        ).toISOString(),
      })),
      Array.from({ length: Math.floor(reviewCount / 2) }, (_, index) => ({
        id: 1000 + Math.ceil(reviewCount / 2) + index + 1,
        user: {
          login: `reviewer-${String(Math.ceil(reviewCount / 2) + index + 1)}`,
        },
        body: `Review body ${String(Math.ceil(reviewCount / 2) + index + 1)}`,
        state: 'COMMENTED',
        submitted_at: new Date(
          Date.UTC(2026, 5, 24, 11, 0, index + 1),
        ).toISOString(),
      })),
    ];
    const commentPages = [
      Array.from({ length: Math.ceil(commentCount / 2) }, (_, index) => ({
        id: 2000 + index + 1,
        pull_request_review_id: 1000 + index + 1,
        user: { login: `commenter-${String(index + 1)}` },
        body: `Inline body ${String(index + 1)}`,
        path: 'server/src/flows/service.ts',
        line: index + 1,
        created_at: new Date(
          Date.UTC(2026, 5, 24, 12, 0, index + 1),
        ).toISOString(),
      })),
      Array.from({ length: Math.floor(commentCount / 2) }, (_, index) => ({
        id: 2000 + Math.ceil(commentCount / 2) + index + 1,
        pull_request_review_id: 1000 + Math.ceil(commentCount / 2) + index + 1,
        user: {
          login: `commenter-${String(
            Math.ceil(commentCount / 2) + index + 1,
          )}`,
        },
        body: `Inline body ${String(Math.ceil(commentCount / 2) + index + 1)}`,
        path: 'server/src/flows/githubReview.ts',
        line: index + 1,
        created_at: new Date(
          Date.UTC(2026, 5, 24, 13, 0, index + 1),
        ).toISOString(),
      })),
    ];
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        const endpoint = params.args.at(-1) ?? '';
        if (endpoint.includes('/reviews?')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify(reviewPages),
            stderr: '',
          };
        }
        if (endpoint.includes('/comments?')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify(commentPages),
            stderr: '',
          };
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      },
    });

    const fetched = await fetchPullRequestReviews({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      pullRequest: {
        number: 45,
        url: 'https://github.com/example/repo/pull/45',
        headRefName: baseRepositoryState(tempRepo.repoRoot).currentBranch,
        baseRefName: 'main',
      },
    });
    assert.equal(fetched.kind, 'ok');
    assert.equal(fetched.value.reviews.length, MAX_GITHUB_REVIEW_SUBMISSIONS);
    assert.equal(
      fetched.value.reviewComments.length,
      MAX_GITHUB_INLINE_REVIEW_COMMENTS,
    );
    assert.equal(fetched.value.reviews[0].id, 1006);
    assert.equal(fetched.value.reviews.at(-1)?.id, 1205);
    assert.equal(fetched.value.reviewComments[0].id, 2006);
    assert.equal(fetched.value.reviewComments.at(-1)?.id, 2205);
  } finally {
    await tempRepo.cleanup();
  }
});
