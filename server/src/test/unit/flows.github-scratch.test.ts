import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  __resetGitHubReviewDepsForTests,
  __setGitHubReviewDepsForTests,
  readGitHubReviewScratch,
  writeGitHubReviewScratch,
  type GitHubCurrentReviewHandoff,
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
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'github-scratch-'));
  await fs.mkdir(path.join(repoRoot, 'codeInfoStatus/flow-state'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(repoRoot, 'codeInfoStatus/flow-state/current-plan.json'),
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
  return {
    repoRoot,
    cleanup: async () => {
      await fs.rm(repoRoot, { recursive: true, force: true });
    },
  };
};

const buildRepositoryState = (repoRoot: string): GitHubRepositoryState => ({
  workingRepositoryRoot: repoRoot,
  repositoryOwner: 'example',
  repositoryName: 'repo',
  repositoryFullName: 'example/repo',
  currentBranch: 'feature/0000060-demo',
  headSha: 'deadbeef',
  upstreamRemote: 'origin',
  upstreamBranch: 'feature/0000060-demo',
  baseBranch: 'main',
  remoteUrl: 'https://github.com/example/repo.git',
});

const buildHandoffPath = (repoRoot: string) =>
  path.join(repoRoot, 'codeInfoTmp/reviews/0000060-current-review.json');

test('safe replacement keeps the previous valid handoff visible when publish fails', async () => {
  const tempRepo = await createTempRepo();
  try {
    const handoffPath = buildHandoffPath(tempRepo.repoRoot);
    await fs.mkdir(path.dirname(handoffPath), { recursive: true });
    const existing: GitHubCurrentReviewHandoff = {
      plan_path:
        'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
      story_number: '0000060',
      repository_root: tempRepo.repoRoot,
      branch_name: 'feature/0000060-demo',
      head_sha: 'oldsha',
      raw_review_artifact_path: path.join(
        tempRepo.repoRoot,
        'codeInfoTmp/reviews/0000060-github-review-pr-44.json',
      ),
      pull_request: {
        number: 44,
        url: 'https://github.com/example/repo/pull/44',
        headRefName: 'feature/0000060-demo',
        baseRefName: 'main',
      },
    };
    await fs.writeFile(handoffPath, JSON.stringify(existing, null, 2), 'utf8');
    let renameCount = 0;
    __setGitHubReviewDepsForTests({
      rename: async (fromPath, toPath) => {
        renameCount += 1;
        if (renameCount === 1) {
          const error = new Error('simulated publish failure');
          throw error;
        }
        await fs.rename(fromPath, toPath);
      },
    });

    const result = await writeGitHubReviewScratch({
      repository: buildRepositoryState(tempRepo.repoRoot),
      pullRequest: {
        number: 45,
        url: 'https://github.com/example/repo/pull/45',
        headRefName: 'feature/0000060-demo',
        baseRefName: 'main',
      },
      artifact: {
        repository: { owner: 'example', name: 'repo' },
        pullRequest: {
          number: 45,
          url: 'https://github.com/example/repo/pull/45',
          headRefName: 'feature/0000060-demo',
          baseRefName: 'main',
        },
        fetchedAt: '2026-06-24T10:00:00Z',
        reviews: [],
        reviewComments: [],
      },
    });
    assert.equal(result.kind, 'error');
    const stillVisible = JSON.parse(await fs.readFile(handoffPath, 'utf8')) as {
      pull_request: { number: number };
    };
    assert.equal(stillVisible.pull_request.number, 44);
  } finally {
    await tempRepo.cleanup();
  }
});

test('malformed or partial scratch state is rejected instead of being read as a clean review', async () => {
  const tempRepo = await createTempRepo();
  try {
    const malformedFixture = await fs.readFile(
      path.join(fixturesDir, 'current-review-malformed.json'),
      'utf8',
    );
    const handoffPath = buildHandoffPath(tempRepo.repoRoot);
    await fs.mkdir(path.dirname(handoffPath), { recursive: true });
    await fs.writeFile(handoffPath, malformedFixture, 'utf8');

    const parsed = await readGitHubReviewScratch({ handoffPath });
    assert.equal(parsed.kind, 'error');
    assert.equal(parsed.reason, 'SCRATCH_INVALID');
  } finally {
    await tempRepo.cleanup();
  }
});

test('scratch readers validate freshness without deleting or resetting story-local review files', async () => {
  const tempRepo = await createTempRepo();
  try {
    const handoffPath = buildHandoffPath(tempRepo.repoRoot);
    const rawArtifactPath = path.join(
      tempRepo.repoRoot,
      'codeInfoTmp/reviews/0000060-github-review-pr-45.json',
    );
    await fs.mkdir(path.dirname(handoffPath), { recursive: true });
    await fs.writeFile(
      handoffPath,
      JSON.stringify(
        {
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: tempRepo.repoRoot,
          branch_name: 'feature/0000060-demo',
          head_sha: 'deadbeef',
          raw_review_artifact_path: rawArtifactPath,
          pull_request: {
            number: 45,
            url: 'https://github.com/example/repo/pull/45',
            headRefName: 'feature/0000060-demo',
            baseRefName: 'main',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(rawArtifactPath, '{"old":"artifact"}\n', 'utf8');

    const parsed = await readGitHubReviewScratch({ handoffPath });
    assert.equal(parsed.kind, 'ok');

    const [handoffStillExists, artifactStillExists] = await Promise.all([
      fs.stat(handoffPath).then(() => true),
      fs.stat(rawArtifactPath).then(() => true),
    ]);
    assert.equal(handoffStillExists, true);
    assert.equal(artifactStillExists, true);
  } finally {
    await tempRepo.cleanup();
  }
});
