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

test('repo-local token reader distinguishes missing file, missing key, blank token, and malformed .env.local', async () => {
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
    assert.equal(malformed.kind, 'skip');
    assert.equal(malformed.reason, 'MALFORMED_ENV_LOCAL');
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

test('raw gh transport failures are normalized before later consumers rely on them', async () => {
  const tempRepo = await createTempRepo();
  try {
    __setGitHubReviewDepsForTests({
      runCommand: async () => {
        const error = new Error('gh not found') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      },
    });
    const missingBinary = await lookupLatestOpenPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
    });
    assert.equal(missingBinary.kind, 'error');
    assert.equal(missingBinary.reason, 'GITHUB_CLI_MISSING');

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
    assert.equal(nonZeroExit.kind, 'skip');
    assert.equal(nonZeroExit.reason, 'PR_CREATE_FAILED');
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
