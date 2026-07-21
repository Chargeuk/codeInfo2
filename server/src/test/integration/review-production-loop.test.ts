import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareReviewBatchWorkspace } from '../../flows/reviewBatchWorkspace.js';
import type { ReviewTargetSnapshot } from '../../flows/reviewTargets.js';
import { expandSubflowWaveJobs } from '../../flows/subflowWave.js';

const createFixture = async (targetCount: number) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'generic-review-production-'));
  const planPath = 'planning/0000064-generic-review.md';
  await fs.mkdir(path.join(root, 'planning'), { recursive: true });
  await fs.mkdir(path.join(root, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, planPath),
    '# Story 64\n\n## Description\n\nGeneric review batches.\n\n## Acceptance Criteria\n\n- Best effort.\n',
  );
  await fs.writeFile(
    path.join(root, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    JSON.stringify({ plan_path: planPath }),
  );
  const targets = await Promise.all(
    Array.from({ length: targetCount }, async (_, index) => {
      const repoRoot = index === 0 ? root : path.join(root, `repo-${index}`);
      await fs.mkdir(repoRoot, { recursive: true });
      return {
        target_id: index === 0 ? 'current_repository' : `repo-${index}`,
        repo_alias: index === 0 ? 'current_repository' : `repo-${index}`,
        repo_root: repoRoot,
        repository_id: `repo-${index}`,
        branch: 'feature/0000064-generic-review',
        head_commit: String(index + 1).repeat(40),
        comparison_base_commit: 'a'.repeat(40),
        story_id: '0000064',
        is_primary: index === 0,
      };
    }),
  );
  const snapshot: ReviewTargetSnapshot = {
    schema_version: 'codeinfo-review-targets/v1',
    story_id: '0000064',
    plan_path: planPath,
    branched_from: 'main',
    plan_host_root: root,
    review_cycle_id: '0000064-rc-generic',
    review_wave_id: '0000064-rw-generic',
    targets_sha256: 'f'.repeat(64),
    targets,
    created_at: '2026-07-21T00:00:00.000Z',
  };
  return { root, snapshot };
};

test('production generic batch pre-creates every multi-target reviewer job without an expected-result join', async () => {
  const fixture = await createFixture(3);
  try {
    const jobs = expandSubflowWaveJobs({
      step: { type: 'subflowWave', groupsFrom: 'review_groups' },
      input: {
        targets: fixture.snapshot.targets,
        review_groups: [
          {
            kind: 'matrix',
            id: 'configured',
            itemsFrom: 'targets',
            itemName: 'target',
            flowNames: ['codex_review', 'open_code_review'],
            bindings: { workingFolderFrom: 'target.repo_root' },
          },
          {
            kind: 'singleton',
            id: 'story',
            flowName: 'cross_repository_review',
          },
        ],
      },
    });
    const workspace = await prepareReviewBatchWorkspace({
      snapshot: fixture.snapshot,
      jobs,
    });

    assert.equal(workspace.jobs.length, 7);
    assert.equal(
      (await fs.readdir(path.join(workspace.batchRoot, 'jobs'))).length,
      7,
    );
    for (const job of workspace.jobs) {
      const reviewJob = job.input?.review_job as Record<string, unknown>;
      assert.deepEqual(await fs.readdir(String(reviewJob.output_dir)), []);
    }
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('reviewer regrouping does not change the job workspace or consumer boundary', async () => {
  const fixture = await createFixture(1);
  try {
    const makeJob = (groupId: string) =>
      expandSubflowWaveJobs({
        step: { type: 'subflowWave', groupsFrom: 'review_groups' },
        input: {
          targets: fixture.snapshot.targets,
          review_groups: [
            {
              kind: 'matrix',
              id: groupId,
              itemsFrom: 'targets',
              itemName: 'target',
              flowNames: ['movable_reviewer'],
              bindings: { workingFolderFrom: 'target.repo_root' },
            },
          ],
        },
      })[0];
    const repeated = await prepareReviewBatchWorkspace({
      snapshot: fixture.snapshot,
      jobs: [makeJob('repeated')!],
    });
    const movedSnapshot = {
      ...fixture.snapshot,
      review_wave_id: '0000064-rw-moved',
    };
    const oneShot = await prepareReviewBatchWorkspace({
      snapshot: movedSnapshot,
      jobs: [makeJob('one_shot')!],
    });
    const repeatedContract = repeated.jobs[0]?.input?.review_job as Record<
      string,
      unknown
    >;
    const movedContract = oneShot.jobs[0]?.input?.review_job as Record<
      string,
      unknown
    >;

    assert.deepEqual(Object.keys(repeatedContract), Object.keys(movedContract));
    assert.equal(JSON.stringify(repeatedContract).includes('fast'), false);
    assert.equal(JSON.stringify(movedContract).includes('slow'), false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
