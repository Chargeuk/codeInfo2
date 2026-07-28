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
  buildGitHubExternalReviewInputMarkdown,
  createPullRequest,
  fetchPullRequestReviews,
  filterGitHubReviewFeedback,
  lookupLatestOpenPullRequest,
  pushBranchToExistingUpstream,
  readWorkedRepositoryGitHubToken,
  reconcileResumedGitHubReviewPullRequest,
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
  await fs.mkdir(path.join(repoRoot, 'planning'), { recursive: true });
  await fs.writeFile(
    path.join(
      repoRoot,
      'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
    ),
    '# Story 0000060 - GitHub review fixture\n',
    'utf8',
  );
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
  repositoryHost: 'github.com',
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

    await fs.writeFile(
      path.join(tempRepo.repoRoot, '.env.local'),
      'export OTHER=value\nNOTE="line one\nline two"\nCODEINFO_PR_TOKEN=secret-token\n',
    );
    const supportedDotenvSyntax = await readWorkedRepositoryGitHubToken({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(supportedDotenvSyntax.kind, 'ok');
    assert.equal(supportedDotenvSyntax.value.token, 'secret-token');

    await fs.writeFile(
      path.join(tempRepo.repoRoot, '.env.local'),
      'CODEINFO_PR_TOKEN ghp_supersecret\n',
    );
    const malformed = await readWorkedRepositoryGitHubToken({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(malformed.kind, 'error');
    assert.equal(malformed.reason, 'ENV_LOCAL_INVALID');
    assert.doesNotMatch(malformed.message, /ghp_supersecret/u);
    assert.match(malformed.message, /line 1/u);

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

test('repo-local token reader rejects an .env.local symlink that resolves outside the worked repository', async () => {
  const tempRepo = await createTempRepo();
  const outsideDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'github-review-token-outside-'),
  );
  try {
    const outsideEnvLocal = path.join(outsideDirectory, '.env.local');
    await fs.writeFile(outsideEnvLocal, 'CODEINFO_PR_TOKEN=outside-token\n');
    await fs.symlink(
      outsideEnvLocal,
      path.join(tempRepo.repoRoot, '.env.local'),
    );

    const result = await readWorkedRepositoryGitHubToken({
      workingRepositoryRoot: tempRepo.repoRoot,
    });

    assert.equal(result.kind, 'error');
    assert.equal(result.reason, 'ENV_LOCAL_READ_FAILED');
    assert.doesNotMatch(result.message, /outside-token/u);
  } finally {
    await tempRepo.cleanup();
    await fs.rm(outsideDirectory, { recursive: true, force: true });
  }
});
test('GitHub child-process env is scoped and does not mutate the base environment', () => {
  const baseEnv = {
    CODEINFO_PR_TOKEN: 'server-token',
    EXISTING: '1',
  } as NodeJS.ProcessEnv;
  const childEnv = buildGitHubChildProcessEnv({
    token: 'secret-token',
    baseEnv,
  });

  assert.equal(baseEnv.GH_TOKEN, undefined);
  assert.equal(baseEnv.CODEINFO_PR_TOKEN, 'server-token');
  assert.equal(childEnv.EXISTING, '1');
  assert.equal(childEnv.CODEINFO_PR_TOKEN, undefined);
  assert.equal(childEnv.GH_TOKEN, 'secret-token');
  assert.equal(childEnv.GH_HOST, 'github.com');
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

test('repository-state resolution accepts an SSH-over-443 GitHub upstream', async () => {
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
            stdout: 'ssh://git@ssh.github.com:443/example/repo.git\n',
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
    assert.equal(resolved.value.repositoryHost, 'github.com');
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

test('repository-state resolution rejects non-GitHub upstream hosts', async () => {
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
            stdout: 'https://ghe.com/example/repo.git\n',
            stderr: '',
          };
        }
        throw new Error(`Unexpected command: ${joined}`);
      },
    });

    const resolved = await resolveGitHubRepositoryState({
      workingRepositoryRoot: tempRepo.repoRoot,
    });
    assert.equal(resolved.kind, 'error');
    assert.equal(resolved.reason, 'GIT_REMOTE_INVALID');
  } finally {
    await tempRepo.cleanup();
  }
});

test('GitHub PR creation keeps lower-layer runtime failures as errors and preserves lookup retry diagnostics when reconciliation cannot prove a PR exists', async () => {
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
    assert.deepEqual(missingBinary.lookupDiagnostics, []);

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
    assert.deepEqual(spawnFailure.lookupDiagnostics, []);

    const sleepCalls: number[] = [];
    __setGitHubReviewDepsForTests({
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
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
    assert.equal(nonZeroExit.stderr, 'gh api failed');
    assert.equal(nonZeroExit.lookupDiagnostics.length, 0);
    assert.deepEqual(sleepCalls, []);
  } finally {
    await tempRepo.cleanup();
  }
});

test('GitHub PR creation uses the remote upstream branch when its local name differs', async () => {
  const tempRepo = await createTempRepo();
  try {
    const seenArgs: string[][] = [];
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        seenArgs.push(params.args);
        if (params.args[0] === 'pr') {
          return {
            exitCode: 0,
            stdout: 'https://github.com/example/repo/pull/45\n',
            stderr: '',
          };
        }
        if ((params.args.at(-1) ?? '').endsWith('/pulls/45')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              number: 45,
              html_url: 'https://github.com/example/repo/pull/45',
              state: 'open',
              head: { ref: 'feature/remote-review' },
              base: { ref: 'main' },
            }),
            stderr: '',
          };
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              number: 45,
              html_url: 'https://github.com/example/repo/pull/45',
              created_at: '2026-07-13T12:00:00Z',
              head: { ref: 'feature/remote-review' },
              base: { ref: 'main' },
            },
          ]),
          stderr: '',
        };
      },
    });
    const repository = {
      ...baseRepositoryState(tempRepo.repoRoot),
      currentBranch: 'local-review',
      upstreamBranch: 'feature/remote-review',
    };
    const created = await createPullRequest({
      repository,
      token: 'secret',
      title: 'Story review',
      body: 'body',
    });
    assert.equal(created.kind, 'ok');
    const createArgs = seenArgs.find(
      (args) => args[0] === 'pr' && args[1] === 'create',
    );
    assert.equal(createArgs?.[createArgs.indexOf('--head') + 1], 'feature/remote-review');
    assert.ok(seenArgs.some((args) => args.at(-1) === 'repos/example/repo/pulls/45'));
  } finally {
    await tempRepo.cleanup();
  }
});

test('PR creation accepts canonical owner and repository casing in the printed URL', async () => {
  const tempRepo = await createTempRepo();
  try {
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        const endpoint = params.args.at(-1) ?? '';
        if (params.args[0] === 'pr' && params.args[1] === 'create') {
          return {
            exitCode: 0,
            stdout: 'https://github.com/Example/Repo/pull/45\n',
            stderr: '',
          };
        }
        if (endpoint === 'repos/example/repo/pulls/45') {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              number: 45,
              html_url: 'https://github.com/Example/Repo/pull/45',
              state: 'open',
              head: {
                ref: baseRepositoryState(tempRepo.repoRoot).upstreamBranch,
              },
              base: { ref: 'main' },
            }),
            stderr: '',
          };
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      },
    });

    const created = await createPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      title: 'Story review',
      body: 'body',
    });
    assert.equal(created.kind, 'ok');
    assert.equal(created.value.number, 45);
  } finally {
    await tempRepo.cleanup();
  }
});

test('post-create reconciliation uses the PR number printed by gh instead of the latest open PR', async () => {
  const tempRepo = await createTempRepo();
  try {
    const pullPages = [
      Array.from({ length: 100 }, (_, index) => ({
        number: index + 1,
        html_url: `https://github.com/example/repo/pull/${String(index + 1)}`,
        title: `older pull request ${String(index + 1)}`,
        created_at: new Date(
          Date.UTC(2026, 5, 20, 10, 0, index + 1),
        ).toISOString(),
        head: {
          ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
        },
        base: { ref: 'main' },
        user: { login: 'review-bot' },
      })),
      [
        {
          number: 145,
          html_url: 'https://github.com/example/repo/pull/145',
          title: 'latest pull request',
          created_at: '2026-06-24T10:00:00Z',
          head: {
            ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          },
          base: { ref: 'main' },
          user: { login: 'review-bot' },
        },
      ],
    ];
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
        const endpoint = params.args.at(-1) ?? '';
        if (endpoint.endsWith('/pulls/45')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              number: 45,
              html_url: 'https://github.com/example/repo/pull/45',
              state: 'open',
              head: {
                ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
              },
              base: { ref: 'main' },
              user: { login: 'review-bot' },
            }),
            stderr: '',
          };
        }
        const page = Number(
          new URL(`https://example.test/${endpoint}`).searchParams.get('page') ??
            '1',
        );
        return {
          exitCode: 0,
          stdout: JSON.stringify(pullPages[page - 1] ?? []),
          stderr: '',
        };
      },
    });

    const latest = await lookupLatestOpenPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
    });
    assert.equal(latest.kind, 'ok');
    assert.equal(latest.value?.number, 145);
    seenArgs.length = 0;

    const created = await createPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      title: 'Story review',
      body: 'body',
    });
    assert.equal(created.kind, 'ok');
    assert.equal(created.value.number, 45);
    assert.deepEqual(created.lookupDiagnostics, []);
    assert.ok(
      seenArgs.some((args) => {
        const endpoint = args.at(-1);
        return endpoint === 'repos/example/repo/pulls/45';
      }),
    );
    assert.equal(
      seenArgs.some((args) => (args.at(-1) ?? '').includes('?state=open')),
      false,
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
        const endpoint = params.args.at(-1) ?? '';
        const page = Number(
          new URL(`https://example.test/${endpoint}`).searchParams.get('page') ??
            '1',
        );
        return {
          exitCode: 0,
          stdout: JSON.stringify(pullPages[page - 1] ?? []),
          stderr: '',
        };
      },
    });

    const failedCreate = await createPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      title: 'Story review',
      body: 'body',
    });
    assert.equal(failedCreate.kind, 'error');
    assert.equal(failedCreate.reason, 'GITHUB_CLI_FAILED');
    assert.equal(failedCreate.stderr, 'connection dropped after create');
    assert.deepEqual(failedCreate.lookupDiagnostics, []);
  } finally {
    await tempRepo.cleanup();
  }
});

test('resumed GitHub review reconciliation keeps the execution-owned persisted handoff PR without latest-open discovery', async () => {
  const tempRepo = await createTempRepo();
  try {
    const reviewsDir = path.join(tempRepo.repoRoot, 'codeInfoTmp/reviews');
    await fs.mkdir(reviewsDir, { recursive: true });
    const handoffPath = path.join(
      reviewsDir,
      '0000060-github-review-exec-1-current.json',
    );
    await fs.writeFile(
      handoffPath,
      JSON.stringify(
        {
          handoff_kind: 'github-review-handoff-v1',
          execution_id: 'exec-1',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: tempRepo.repoRoot,
          branch_name:
            'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          head_sha: 'abc123',
          raw_review_artifact_path: path.join(
            reviewsDir,
            '0000060-github-review-exec-1-pr-45.json',
          ),
          pull_request: {
            number: 45,
            url: 'https://github.com/example/repo/pull/45',
            headRefName:
              'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
            baseRefName: 'main',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    __setGitHubReviewDepsForTests({
      runCommand: async () => {
        throw new Error('latest-open lookup must not run');
      },
    });

    const reconciled = await reconcileResumedGitHubReviewPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      executionId: 'exec-1',
      handoffPath,
      resumedPullRequestNumber: 45,
    });
    assert.equal(reconciled.kind, 'ok');
    assert.equal(reconciled.value.number, 45);
    assert.equal(reconciled.source, 'persisted_handoff');
    assert.equal(reconciled.warnings.length, 0);
  } finally {
    await tempRepo.cleanup();
  }
});

test('resumed GitHub review reconciliation warns only when an expected materialized handoff is missing', async () => {
  const tempRepo = await createTempRepo();
  try {
    __setGitHubReviewDepsForTests({
      runCommand: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          number: 44,
          state: 'open',
          html_url: 'https://github.com/example/repo/pull/44',
          head: {
            ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          },
          base: { ref: 'main' },
          created_at: '2026-06-28T10:00:00Z',
        }),
        stderr: '',
      }),
    });

    const preFetchReconciled = await reconcileResumedGitHubReviewPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      executionId: 'missing',
      handoffPath: path.join(
        tempRepo.repoRoot,
        'codeInfoTmp/reviews/0000060-github-review-missing-current.json',
      ),
      resumedPullRequestNumber: 44,
    });
    assert.equal(preFetchReconciled.kind, 'ok');
    assert.equal(preFetchReconciled.value.number, 44);
    assert.equal(preFetchReconciled.source, 'resumed_context');
    assert.equal(preFetchReconciled.warnings.length, 0);

    const reconciled = await reconcileResumedGitHubReviewPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      executionId: 'missing',
      handoffPath: path.join(
        tempRepo.repoRoot,
        'codeInfoTmp/reviews/0000060-github-review-missing-current.json',
      ),
      resumedPullRequestNumber: 44,
      expectPersistedHandoff: true,
    });
    assert.equal(reconciled.kind, 'ok');
    assert.equal(reconciled.value.number, 44);
    assert.equal(reconciled.source, 'resumed_context');
    assert.equal(reconciled.warnings.length, 1);
    assert.match(
      reconciled.warnings[0] ?? '',
      /lost its execution-scoped handoff/i,
    );
  } finally {
    await tempRepo.cleanup();
  }
});

test('resumed GitHub review reconciliation rejects a manually closed pull request', async () => {
  const tempRepo = await createTempRepo();
  try {
    __setGitHubReviewDepsForTests({
      runCommand: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          number: 44,
          state: 'closed',
          html_url: 'https://github.com/example/repo/pull/44',
          head: {
            ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          },
          base: { ref: 'main' },
        }),
        stderr: '',
      }),
    });

    const reconciled = await reconcileResumedGitHubReviewPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      executionId: 'missing',
      handoffPath: path.join(
        tempRepo.repoRoot,
        'codeInfoTmp/reviews/0000060-github-review-missing-current.json',
      ),
      resumedPullRequestNumber: 44,
    });
    assert.equal(reconciled.kind, 'error');
    assert.equal(reconciled.reason, 'INVALID_GITHUB_RESPONSE');
    assert.match(reconciled.message, /open pull request/i);
  } finally {
    await tempRepo.cleanup();
  }
});

test('resumed GitHub review reconciliation rejects every PR-number mismatch instead of adopting another run', async () => {
  const tempRepo = await createTempRepo();
  try {
    const reviewsDir = path.join(tempRepo.repoRoot, 'codeInfoTmp/reviews');
    await fs.mkdir(reviewsDir, { recursive: true });
    const handoffPath = path.join(
      reviewsDir,
      '0000060-github-review-exec-2-current.json',
    );
    await fs.writeFile(
      handoffPath,
      JSON.stringify(
        {
          handoff_kind: 'github-review-handoff-v1',
          execution_id: 'exec-2',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: tempRepo.repoRoot,
          branch_name:
            'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
          head_sha: 'abc123',
          raw_review_artifact_path: path.join(
            reviewsDir,
            '0000060-github-review-exec-2-pr-45.json',
          ),
          pull_request: {
            number: 45,
            url: 'https://github.com/example/repo/pull/45',
            headRefName:
              'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
            baseRefName: 'main',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    __setGitHubReviewDepsForTests({
      runCommand: async () => ({
        exitCode: 0,
        stdout: JSON.stringify([
          [
            {
              number: 46,
              html_url: 'https://github.com/example/repo/pull/46',
              head: {
                ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
              },
              base: { ref: 'main' },
              created_at: '2026-06-28T10:00:00Z',
            },
          ],
        ]),
        stderr: '',
      }),
    });

    const newerContext = await reconcileResumedGitHubReviewPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      executionId: 'exec-2',
      handoffPath,
      resumedPullRequestNumber: 44,
    });
    assert.equal(newerContext.kind, 'error');
    assert.equal(newerContext.reason, 'SCRATCH_INVALID');
    assert.match(newerContext.message, /will not adopt another pull request/i);

    __setGitHubReviewDepsForTests({
      runCommand: async () => ({
        exitCode: 0,
        stdout: JSON.stringify([
          [
            {
              number: 44,
              html_url: 'https://github.com/example/repo/pull/44',
              head: {
                ref: 'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
              },
              base: { ref: 'main' },
              created_at: '2026-06-28T10:00:00Z',
            },
          ],
        ]),
        stderr: '',
      }),
    });

    const rejected = await reconcileResumedGitHubReviewPullRequest({
      repository: baseRepositoryState(tempRepo.repoRoot),
      token: 'secret',
      executionId: 'exec-2',
      handoffPath,
      resumedPullRequestNumber: 46,
    });
    assert.equal(rejected.kind, 'error');
    assert.equal(rejected.reason, 'SCRATCH_INVALID');
    assert.equal(rejected.warnings.length, 0);
    assert.match(rejected.message, /will not adopt another pull request/i);
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

test('review feedback filtering requires a canonical PR author before accepting feedback', () => {
  const feedback = filterGitHubReviewFeedback({
    artifact: {
      repository: { owner: 'example', name: 'repo' },
      pullRequest: {
        number: 45,
        url: 'https://github.com/example/repo/pull/45',
        headRefName:
          'feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps',
        baseRefName: 'main',
      },
      fetchedAt: '2026-07-14T19:45:00.000Z',
      reviews: [
        {
          id: 1,
          user: { login: 'pull-request-author' },
          body: 'Author follow-up',
          state: 'COMMENTED',
        },
        {
          id: 2,
          user: { login: 'external-reviewer' },
          body: 'External review',
          state: 'COMMENTED',
        },
      ],
      reviewComments: [],
    },
  });

  assert.deepEqual(feedback, []);
});

test('review feedback and external-review input preserve commit provenance', () => {
  const artifact = {
    repository: { owner: 'example', name: 'repo' },
    pullRequest: {
      number: 45,
      url: 'https://github.com/example/repo/pull/45',
      headRefName: 'feature/0000060-demo',
      baseRefName: 'main',
      authorLogin: 'pull-request-author',
    },
    fetchedAt: '2026-07-14T19:45:00.000Z',
    reviews: [
      {
        id: 2,
        user: { login: 'external-reviewer' },
        body: 'External review',
        state: 'COMMENTED',
        commit_id: 'review-commit',
      },
    ],
    reviewComments: [
      {
        id: 3,
        user: { login: 'external-reviewer' },
        body: 'Inline review',
        path: 'server/src/flows/githubReview.ts',
        commit_id: 'inline-commit',
      },
    ],
  };
  const feedback = filterGitHubReviewFeedback({ artifact });

  assert.deepEqual(feedback, [
    {
      kind: 'review',
      reviewer: 'external-reviewer',
      body: 'External review',
      state: 'COMMENTED',
      commitId: 'review-commit',
    },
    {
      kind: 'inline_comment',
      reviewer: 'external-reviewer',
      body: 'Inline review',
      path: 'server/src/flows/githubReview.ts',
      commitId: 'inline-commit',
    },
  ]);

  const markdown = buildGitHubExternalReviewInputMarkdown({
    artifact,
    feedback,
    headSha: 'current-head',
  });
  assert.match(markdown, /Head SHA: current-head/u);
  assert.match(markdown, /Commit ID: review-commit/u);
  assert.match(markdown, /Commit ID: inline-commit/u);
});

test('review fetch preserves the complete paginated producer corpus', async () => {
  const tempRepo = await createTempRepo();
  try {
    const reviewCount = 205;
    const commentCount = 205;
    const reviewPages = [
      Array.from({ length: 100 }, (_, index) => ({
        id: 1000 + index + 1,
        user: { login: `reviewer-${String(index + 1)}` },
        body: `Review body ${String(index + 1)}`,
        state: 'COMMENTED',
        submitted_at: new Date(
          Date.UTC(2026, 5, 24, 10, 0, index + 1),
        ).toISOString(),
      })),
      Array.from({ length: 100 }, (_, index) => ({
        id: 1100 + index + 1,
        user: {
          login: `reviewer-${String(100 + index + 1)}`,
        },
        body: `Review body ${String(100 + index + 1)}`,
        state: 'COMMENTED',
        submitted_at: new Date(
          Date.UTC(2026, 5, 24, 11, 0, index + 1),
        ).toISOString(),
      })),
      Array.from({ length: reviewCount - 200 }, (_, index) => ({
        id: 1200 + index + 1,
        user: {
          login: `reviewer-${String(200 + index + 1)}`,
        },
        body: `Review body ${String(200 + index + 1)}`,
        state: 'COMMENTED',
        submitted_at: new Date(
          Date.UTC(2026, 5, 24, 12, 0, index + 1),
        ).toISOString(),
      })),
    ];
    const commentPages = [
      Array.from({ length: 100 }, (_, index) => ({
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
      Array.from({ length: 100 }, (_, index) => ({
        id: 2100 + index + 1,
        pull_request_review_id: 1100 + index + 1,
        user: {
          login: `commenter-${String(100 + index + 1)}`,
        },
        body: `Inline body ${String(100 + index + 1)}`,
        path: 'server/src/flows/githubReview.ts',
        line: index + 1,
        created_at: new Date(
          Date.UTC(2026, 5, 24, 13, 0, index + 1),
        ).toISOString(),
      })),
      Array.from({ length: commentCount - 200 }, (_, index) => ({
        id: 2200 + index + 1,
        pull_request_review_id: 1200 + index + 1,
        user: {
          login: `commenter-${String(200 + index + 1)}`,
        },
        body: `Inline body ${String(200 + index + 1)}`,
        path: 'server/src/flows/githubReview.ts',
        line: index + 1,
        created_at: new Date(
          Date.UTC(2026, 5, 24, 14, 0, index + 1),
        ).toISOString(),
      })),
    ];
    const seenArgs: string[][] = [];
    __setGitHubReviewDepsForTests({
      runCommand: async (params) => {
        seenArgs.push(params.args);
        const endpoint = params.args.at(-1) ?? '';
        if (endpoint.includes('/reviews?')) {
          const page = Number(
            new URL(`https://example.test/${endpoint}`).searchParams.get('page'),
          );
          return {
            exitCode: 0,
            stdout: JSON.stringify(reviewPages[page - 1] ?? []),
            stderr: '',
          };
        }
        if (endpoint.includes('/comments?')) {
          const page = Number(
            new URL(`https://example.test/${endpoint}`).searchParams.get('page'),
          );
          return {
            exitCode: 0,
            stdout: JSON.stringify(commentPages[page - 1] ?? []),
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
    assert.equal(fetched.value.reviews.length, reviewCount);
    assert.equal(fetched.value.reviewComments.length, commentCount);
    assert.equal(fetched.value.reviews[0].id, 1001);
    assert.equal(fetched.value.reviews.at(-1)?.id, 1205);
    assert.equal(fetched.value.reviewComments[0].id, 2001);
    assert.equal(fetched.value.reviewComments.at(-1)?.id, 2205);
    assert.ok(seenArgs.every((args) => !args.includes('--paginate')));
    assert.ok(seenArgs.every((args) => !args.includes('--slurp')));
    assert.deepEqual(
      seenArgs
        .filter((args) => (args.at(-1) ?? '').includes('/reviews?'))
        .map(
          (args) =>
            new URL(`https://example.test/${args.at(-1) ?? ''}`).searchParams.get(
              'page',
            ),
        ),
      ['1', '2', '3'],
    );
    assert.deepEqual(
      seenArgs
        .filter((args) => (args.at(-1) ?? '').includes('/comments?'))
        .map(
          (args) =>
            new URL(`https://example.test/${args.at(-1) ?? ''}`).searchParams.get(
              'page',
            ),
        ),
      ['1', '2', '3'],
    );
  } finally {
    await tempRepo.cleanup();
  }
});
