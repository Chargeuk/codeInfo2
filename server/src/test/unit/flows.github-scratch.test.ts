import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  __resetGitHubReviewDepsForTests,
  __setGitHubReviewDepsForTests,
  appendGitHubReviewPlanNote,
  claimGitHubReviewScratchOwnership,
  GITHUB_REVIEW_HANDOFF_KIND,
  GITHUB_REVIEW_SELECTOR_KIND,
  readGitHubReviewScratch,
  resolveCanonicalGitHubReviewScratchPaths,
  writeGitHubReviewScratch,
  type GitHubCurrentReviewHandoff,
  type GitHubRepositoryState,
  type GitHubReviewScratchSelector,
} from '../../flows/githubReview.js';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows/github-review',
);

afterEach(() => {
  __resetGitHubReviewDepsForTests();
});

const createTempRepo = async (params?: {
  currentTaskJson?: Record<string, unknown>;
  planLines?: string[];
}) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'github-scratch-'));
  await fs.mkdir(path.join(repoRoot, 'codeInfoStatus/flow-state'), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoRoot, 'planning'), {
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
  await fs.writeFile(
    path.join(repoRoot, 'codeInfoStatus/flow-state/current-task.json'),
    JSON.stringify(
      params?.currentTaskJson ?? {
        task_number: 5,
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.writeFile(
    path.join(
      repoRoot,
      'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
    ),
    (
      params?.planLines ?? [
        '### Task 5. Final Story Validation And Close-Out',
        '',
        '#### Implementation notes',
        '',
        '- Existing note.',
        '',
      ]
    ).join('\n'),
    'utf8',
  );
  return {
    repoRoot,
    cleanup: async () => {
      await fs.rm(repoRoot, { recursive: true, force: true });
    },
  };
};

const readTempPlan = async (repoRoot: string) =>
  await fs.readFile(
    path.join(
      repoRoot,
      'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
    ),
    'utf8',
  );

const buildRepositoryState = (repoRoot: string): GitHubRepositoryState => ({
  workingRepositoryRoot: repoRoot,
  repositoryHost: 'github.com',
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

const buildSelectorPath = (repoRoot: string) =>
  path.join(repoRoot, 'codeInfoTmp/reviews/0000060-github-review-current.json');

const buildExecutionScopedHandoffPath = (
  repoRoot: string,
  executionId: string,
) =>
  path.join(
    repoRoot,
    `codeInfoTmp/reviews/0000060-github-review-${executionId}-current.json`,
  );

test('failed execution-scoped scratch publish leaves the last valid selector-owned handoff authoritative', async () => {
  const tempRepo = await createTempRepo();
  try {
    const selectorPath = buildSelectorPath(tempRepo.repoRoot);
    const handoffPath = buildExecutionScopedHandoffPath(
      tempRepo.repoRoot,
      'old',
    );
    await fs.mkdir(path.dirname(selectorPath), { recursive: true });
    const existing: GitHubCurrentReviewHandoff = {
      handoff_kind: GITHUB_REVIEW_HANDOFF_KIND,
      execution_id: 'old',
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
    const existingSelector: GitHubReviewScratchSelector = {
      selector_kind: GITHUB_REVIEW_SELECTOR_KIND,
      execution_id: 'old',
      plan_path:
        'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
      story_number: '0000060',
      repository_root: tempRepo.repoRoot,
      branch_name: 'feature/0000060-demo',
      handoff_path: handoffPath,
    };
    await fs.writeFile(
      selectorPath,
      JSON.stringify(existingSelector, null, 2),
      'utf8',
    );
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
      executionId: 'new',
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
    const selector = JSON.parse(
      await fs.readFile(selectorPath, 'utf8'),
    ) as GitHubReviewScratchSelector;
    assert.equal(selector.execution_id, 'old');
    const stillVisible = JSON.parse(await fs.readFile(handoffPath, 'utf8')) as {
      pull_request: { number: number };
    };
    assert.equal(stillVisible.pull_request.number, 44);
  } finally {
    await tempRepo.cleanup();
  }
});

test('malformed selector or partial handoff state is rejected instead of being read as a clean review', async () => {
  const tempRepo = await createTempRepo();
  try {
    const malformedFixture = await fs.readFile(
      path.join(fixturesDir, 'current-review-malformed.json'),
      'utf8',
    );
    const selectorPath = buildSelectorPath(tempRepo.repoRoot);
    const handoffPath = buildExecutionScopedHandoffPath(
      tempRepo.repoRoot,
      'bad',
    );
    await fs.mkdir(path.dirname(selectorPath), { recursive: true });
    await fs.writeFile(
      selectorPath,
      JSON.stringify(
        {
          selector_kind: GITHUB_REVIEW_SELECTOR_KIND,
          execution_id: 'bad',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: tempRepo.repoRoot,
          branch_name: 'feature/0000060-demo',
          handoff_path: handoffPath,
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(handoffPath, malformedFixture, 'utf8');

    const parsed = await readGitHubReviewScratch({ handoffPath: selectorPath });
    assert.equal(parsed.kind, 'error');
    assert.equal(parsed.reason, 'SCRATCH_INVALID');
  } finally {
    await tempRepo.cleanup();
  }
});

test('scratch readers reject path-bearing state that escapes the worked repository root', async () => {
  const tempRepo = await createTempRepo();
  try {
    const selectorPath = buildSelectorPath(tempRepo.repoRoot);
    await fs.mkdir(path.dirname(selectorPath), { recursive: true });
    await fs.writeFile(
      selectorPath,
      JSON.stringify(
        {
          selector_kind: GITHUB_REVIEW_SELECTOR_KIND,
          execution_id: 'escape',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: tempRepo.repoRoot,
          branch_name: 'feature/0000060-demo',
          handoff_path: path.join(
            tempRepo.repoRoot,
            'codeInfoTmp/reviews/0000060-github-review-escape-current.json',
          ),
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      path.join(
        tempRepo.repoRoot,
        'codeInfoTmp/reviews/0000060-github-review-escape-current.json',
      ),
      JSON.stringify(
        {
          handoff_kind: GITHUB_REVIEW_HANDOFF_KIND,
          execution_id: 'escape',
          plan_path: '../planning/outside.md',
          story_number: '0000060',
          repository_root: tempRepo.repoRoot,
          branch_name: 'feature/0000060-demo',
          head_sha: 'deadbeef',
          raw_review_artifact_path: path.join(
            tempRepo.repoRoot,
            '../outside.json',
          ),
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

    const parsed = await readGitHubReviewScratch({ handoffPath: selectorPath });
    assert.equal(parsed.kind, 'error');
    assert.equal(parsed.reason, 'SCRATCH_INVALID');
  } finally {
    await tempRepo.cleanup();
  }
});

test('GitHub review plan-note append rejects current-plan handoffs that escape the worked repository root', async () => {
  const tempRepo = await createTempRepo();
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'github-plan-'));
  try {
    const outsidePlanPath = path.join(outsideRoot, '0000060-outside-plan.md');
    const outsideOriginal = [
      '### Task 5. Final Story Validation And Close-Out',
      '',
      '#### Implementation notes',
      '',
      '- Outside note.',
      '',
    ].join('\n');
    await fs.writeFile(outsidePlanPath, outsideOriginal, 'utf8');
    await fs.writeFile(
      path.join(
        tempRepo.repoRoot,
        'codeInfoStatus/flow-state/current-plan.json',
      ),
      JSON.stringify(
        {
          plan_path: path.relative(tempRepo.repoRoot, outsidePlanPath),
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await appendGitHubReviewPlanNote({
      workingRepositoryRoot: tempRepo.repoRoot,
      note: 'Should not be appended.',
    });
    assert.equal(result.kind, 'error');
    assert.equal(result.reason, 'SCRATCH_INVALID');
    assert.match(
      result.message,
      /plan_path must remain repository-root contained/i,
    );
    assert.equal(await fs.readFile(outsidePlanPath, 'utf8'), outsideOriginal);
  } finally {
    await fs.rm(outsideRoot, { recursive: true, force: true });
    await tempRepo.cleanup();
  }
});

test('contradictory overlapping GitHub review plan-note appends preserve sibling notes under the selected task block', async () => {
  const tempRepo = await createTempRepo();
  try {
    const first = appendGitHubReviewPlanNote({
      workingRepositoryRoot: tempRepo.repoRoot,
      note: 'Retry A recorded a skip note.',
    });
    const second = appendGitHubReviewPlanNote({
      workingRepositoryRoot: tempRepo.repoRoot,
      note: 'Retry B recorded a failure note.',
    });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.kind, 'ok');
    assert.equal(secondResult.kind, 'ok');

    const plan = await readTempPlan(tempRepo.repoRoot);
    assert.match(plan, /- Existing note\./);
    assert.match(plan, /- Retry A recorded a skip note\./);
    assert.match(plan, /- Retry B recorded a failure note\./);
    assert.equal(
      plan.match(/- Retry A recorded a skip note\./g)?.length ?? 0,
      1,
    );
    assert.equal(
      plan.match(/- Retry B recorded a failure note\./g)?.length ?? 0,
      1,
    );
  } finally {
    await tempRepo.cleanup();
  }
});

test('idempotent replay of the same GitHub review plan note does not duplicate the durable bullet', async () => {
  const tempRepo = await createTempRepo();
  try {
    const note = 'Retry replay kept the same note authoritative.';
    const [firstResult, secondResult] = await Promise.all([
      appendGitHubReviewPlanNote({
        workingRepositoryRoot: tempRepo.repoRoot,
        note,
      }),
      appendGitHubReviewPlanNote({
        workingRepositoryRoot: tempRepo.repoRoot,
        note,
      }),
    ]);
    assert.equal(firstResult.kind, 'ok');
    assert.equal(secondResult.kind, 'ok');

    const plan = await readTempPlan(tempRepo.repoRoot);
    assert.equal(
      plan.match(/- Retry replay kept the same note authoritative\./g)
        ?.length ?? 0,
      1,
    );
  } finally {
    await tempRepo.cleanup();
  }
});

test('GitHub review plan-note append keeps task selection and duplicate-note guards stable under the concurrent writer seam', async () => {
  const tempRepo = await createTempRepo({
    currentTaskJson: {
      selected_task: {
        number: 5,
      },
    },
    planLines: [
      '### Task 4. Different Task',
      '',
      '#### Implementation notes',
      '',
      '- Other task note.',
      '',
      '### Task 5. Final Story Validation And Close-Out',
      '',
      '#### Implementation notes',
      '',
      '- Existing note.',
      '',
    ],
  });
  try {
    const before = await readTempPlan(tempRepo.repoRoot);
    const result = await appendGitHubReviewPlanNote({
      workingRepositoryRoot: tempRepo.repoRoot,
      note: 'Existing note.',
    });
    assert.equal(result.kind, 'ok');

    const plan = await readTempPlan(tempRepo.repoRoot);
    assert.equal(plan, before);
    assert.equal(plan.match(/- Existing note\./g)?.length ?? 0, 1);
    assert.equal(plan.match(/- Other task note\./g)?.length ?? 0, 1);
    assert.match(
      plan,
      /### Task 4\. Different Task[\s\S]*- Other task note\.[\s\S]*### Task 5\. Final Story Validation And Close-Out[\s\S]*- Existing note\./,
    );
  } finally {
    await tempRepo.cleanup();
  }
});

test('GitHub review plan-note append recovers a dead owner and its stale legacy recovery directory', async () => {
  const tempRepo = await createTempRepo();
  try {
    const planPath = path.join(
      tempRepo.repoRoot,
      'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
    );
    await fs.writeFile(
      `${planPath}.lock`,
      `${JSON.stringify({
        pid: 2_147_483_647,
        token: 'dead-owner',
        acquired_at: new Date().toISOString(),
      })}\n`,
      'utf8',
    );
    await fs.mkdir(`${planPath}.lock.recovery`);

    const result = await appendGitHubReviewPlanNote({
      workingRepositoryRoot: tempRepo.repoRoot,
      note: 'Recovered after a dead lock owner.',
    });
    assert.equal(result.kind, 'ok');
    assert.match(
      await readTempPlan(tempRepo.repoRoot),
      /- Recovered after a dead lock owner\./u,
    );
    await assert.rejects(fs.stat(`${planPath}.lock`), /ENOENT/u);
    await assert.rejects(fs.stat(`${planPath}.lock.recovery`), /ENOENT/u);
  } finally {
    await tempRepo.cleanup();
  }
});

test('GitHub review scratch publish rejects current-plan handoffs that escape the worked repository root', async () => {
  const tempRepo = await createTempRepo();
  try {
    await fs.writeFile(
      path.join(
        tempRepo.repoRoot,
        'codeInfoStatus/flow-state/current-plan.json',
      ),
      JSON.stringify(
        {
          plan_path: '../planning/0000060-outside-plan.md',
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await writeGitHubReviewScratch({
      repository: buildRepositoryState(tempRepo.repoRoot),
      executionId: 'escape',
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
        fetchedAt: '2026-06-27T10:00:00Z',
        reviews: [],
        reviewComments: [],
      },
    });

    assert.equal(result.kind, 'error');
    assert.equal(result.reason, 'SCRATCH_INVALID');
    assert.match(
      result.message,
      /plan_path must remain repository-root contained/i,
    );
  } finally {
    await tempRepo.cleanup();
  }
});

test('fresh successful GitHub-review scratch publish updates the selector to the current execution-scoped handoff', async () => {
  const tempRepo = await createTempRepo();
  try {
    const selectorPath = buildSelectorPath(tempRepo.repoRoot);
    const staleHandoffPath = buildExecutionScopedHandoffPath(
      tempRepo.repoRoot,
      'old',
    );
    await fs.mkdir(path.dirname(selectorPath), { recursive: true });
    await fs.writeFile(
      staleHandoffPath,
      JSON.stringify(
        {
          handoff_kind: GITHUB_REVIEW_HANDOFF_KIND,
          execution_id: 'old',
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
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      selectorPath,
      JSON.stringify(
        {
          selector_kind: GITHUB_REVIEW_SELECTOR_KIND,
          execution_id: 'old',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: tempRepo.repoRoot,
          branch_name: 'feature/0000060-demo',
          handoff_path: staleHandoffPath,
        },
        null,
        2,
      ),
      'utf8',
    );

    await claimGitHubReviewScratchOwnership({
      repository: buildRepositoryState(tempRepo.repoRoot),
      executionId: 'new',
    });

    const written = await writeGitHubReviewScratch({
      repository: buildRepositoryState(tempRepo.repoRoot),
      executionId: 'new',
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
    assert.equal(written.kind, 'ok');

    const parsed = await readGitHubReviewScratch({ handoffPath: selectorPath });
    assert.equal(parsed.kind, 'ok');
    assert.equal(parsed.value.handoff_kind, GITHUB_REVIEW_HANDOFF_KIND);
    assert.equal(parsed.value.execution_id, 'new');
    assert.equal(parsed.value.pull_request.number, 45);
    assert.match(
      parsed.value.raw_review_artifact_path,
      /0000060-github-review-new-pr-45\.json$/,
    );
  } finally {
    await tempRepo.cleanup();
  }
});

test('restart-time rereads reject selector ownership that no longer matches the resumed execution', async () => {
  const tempRepo = await createTempRepo();
  try {
    await claimGitHubReviewScratchOwnership({
      repository: buildRepositoryState(tempRepo.repoRoot),
      executionId: 'new',
    });
    const written = await writeGitHubReviewScratch({
      repository: buildRepositoryState(tempRepo.repoRoot),
      executionId: 'new',
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
    assert.equal(written.kind, 'ok');

    const selectorPath = buildSelectorPath(tempRepo.repoRoot);
    const parsed = await readGitHubReviewScratch({
      handoffPath: selectorPath,
      expectedExecutionId: 'old',
    });
    assert.equal(parsed.kind, 'error');
    assert.equal(parsed.reason, 'SCRATCH_INVALID');
    assert.match(parsed.message, /resumed flow execution/i);
  } finally {
    await tempRepo.cleanup();
  }
});

test('execution-scoped handoff refresh can preserve a newer selector owner while keeping the resumed execution authoritative for its own handoff', async () => {
  const tempRepo = await createTempRepo();
  try {
    const selectorPath = buildSelectorPath(tempRepo.repoRoot);
    const oldHandoffPath = buildExecutionScopedHandoffPath(
      tempRepo.repoRoot,
      'old',
    );
    const newHandoffPath = buildExecutionScopedHandoffPath(
      tempRepo.repoRoot,
      'new',
    );
    await fs.mkdir(path.dirname(selectorPath), { recursive: true });
    await fs.writeFile(
      newHandoffPath,
      JSON.stringify(
        {
          handoff_kind: GITHUB_REVIEW_HANDOFF_KIND,
          execution_id: 'new',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: tempRepo.repoRoot,
          branch_name: 'feature/0000060-demo',
          head_sha: 'newsha',
          raw_review_artifact_path: path.join(
            tempRepo.repoRoot,
            'codeInfoTmp/reviews/0000060-github-review-new-pr-88.json',
          ),
          pull_request: {
            number: 88,
            url: 'https://github.com/example/repo/pull/88',
            headRefName: 'feature/0000060-demo',
            baseRefName: 'main',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      selectorPath,
      JSON.stringify(
        {
          selector_kind: GITHUB_REVIEW_SELECTOR_KIND,
          execution_id: 'new',
          plan_path:
            'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md',
          story_number: '0000060',
          repository_root: tempRepo.repoRoot,
          branch_name: 'feature/0000060-demo',
          handoff_path: newHandoffPath,
        },
        null,
        2,
      ),
      'utf8',
    );

    const written = await writeGitHubReviewScratch({
      repository: buildRepositoryState(tempRepo.repoRoot),
      executionId: 'old',
      pullRequest: {
        number: 77,
        url: 'https://github.com/example/repo/pull/77',
        headRefName: 'feature/0000060-demo',
        baseRefName: 'main',
      },
      artifact: {
        repository: { owner: 'example', name: 'repo' },
        pullRequest: {
          number: 77,
          url: 'https://github.com/example/repo/pull/77',
          headRefName: 'feature/0000060-demo',
          baseRefName: 'main',
        },
        fetchedAt: '2026-06-27T18:00:00Z',
        reviews: [],
        reviewComments: [],
      },
      preserveForeignSelectorOwnership: true,
    });
    assert.equal(written.kind, 'ok');

    const selector = JSON.parse(
      await fs.readFile(selectorPath, 'utf8'),
    ) as GitHubReviewScratchSelector;
    assert.equal(selector.execution_id, 'new');
    const resumedHandoff = await readGitHubReviewScratch({
      handoffPath: oldHandoffPath,
      expectedExecutionId: 'old',
    });
    assert.equal(resumedHandoff.kind, 'ok');
    assert.equal(resumedHandoff.value.pull_request.number, 77);
  } finally {
    await tempRepo.cleanup();
  }
});

test('resumed scratch path reconstruction rejects drifted persisted selector and handoff hints before any reread', async () => {
  const tempRepo = await createTempRepo();
  try {
    const resolved = resolveCanonicalGitHubReviewScratchPaths({
      workingRepositoryRoot: tempRepo.repoRoot,
      storyNumber: '0000060',
      executionId: 'exec-old',
      selectorPath: path.join(tempRepo.repoRoot, 'outside', 'selector.json'),
      handoffPath: path.join(tempRepo.repoRoot, 'outside', 'handoff.json'),
    });
    assert.equal(resolved.kind, 'error');
    assert.equal(resolved.reason, 'SCRATCH_INVALID');
    assert.match(resolved.message, /selectorPath|handoffPath/i);
  } finally {
    await tempRepo.cleanup();
  }
});
