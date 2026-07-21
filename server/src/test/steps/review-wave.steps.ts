import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { After, Given, Then, When } from '@cucumber/cucumber';

import { prepareReviewBatchWorkspace } from '../../flows/reviewBatchWorkspace.js';
import type { ReviewTargetSnapshot } from '../../flows/reviewTargets.js';
import {
  expandSubflowWaveJobs,
  type SubflowWaveJob,
} from '../../flows/subflowWave.js';
import type { FlowJsonValue } from '../../flows/types.js';

let tempRoot: string | undefined;
let snapshot: ReviewTargetSnapshot | undefined;
let jobs: SubflowWaveJob[] = [];
let jobContracts: Array<Record<string, unknown>> = [];
let flexibleOutputVisible = false;
let emptyOutputVisible = false;
let regroupedContracts: Array<Record<string, unknown>> = [];

const configuredGroups = (groupId = 'configured'): FlowJsonValue[] => [
  {
    kind: 'matrix' as const,
    id: groupId,
    itemsFrom: 'targets',
    itemName: 'target',
    flowNames: ['codex_review', 'open_code_review'],
    bindings: { workingFolderFrom: 'target.repo_root' },
  },
  {
    kind: 'singleton' as const,
    id: 'story',
    flowName: 'cross_repository_review',
  },
];

const expand = (groups: FlowJsonValue[]) => {
  assert.ok(snapshot);
  return expandSubflowWaveJobs({
    step: { type: 'subflowWave', groupsFrom: 'review_groups' },
    input: { targets: snapshot.targets, review_groups: groups },
  });
};

Given(
  'a generic review batch with {int} pinned target\\(s\\)',
  async (targetCount: number) => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-batch-cucumber-'));
    const planPath = 'planning/0000064-review.md';
    await fs.mkdir(path.join(tempRoot, 'planning'), { recursive: true });
    await fs.mkdir(path.join(tempRoot, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tempRoot, planPath),
      '# Story\n\n## Description\n\nReview generically.\n\n## Acceptance Criteria\n\n- Best effort.\n',
    );
    await fs.writeFile(
      path.join(tempRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({ plan_path: planPath }),
    );
    const targets = await Promise.all(
      Array.from({ length: targetCount }, async (_, index) => {
        const repoRoot = index === 0 ? tempRoot! : path.join(tempRoot!, `repo-${index}`);
        await fs.mkdir(repoRoot, { recursive: true });
        return {
          target_id: index === 0 ? 'current_repository' : `repo-${index}`,
          repo_alias: index === 0 ? 'current_repository' : `repo-${index}`,
          repo_root: repoRoot,
          repository_id: `repo-${index}`,
          branch: 'feature/0000064-review',
          head_commit: String(index + 1).repeat(40),
          comparison_base_commit: 'a'.repeat(40),
          story_id: '0000064',
          is_primary: index === 0,
        };
      }),
    );
    snapshot = {
      schema_version: 'codeinfo-review-targets/v1',
      story_id: '0000064',
      plan_path: planPath,
      branched_from: 'main',
      plan_host_root: tempRoot,
      review_cycle_id: '0000064-rc-cucumber',
      review_wave_id: '0000064-rw-cucumber',
      targets_sha256: 'b'.repeat(64),
      targets,
      created_at: '2026-07-21T00:00:00.000Z',
    };
  },
);

When('I schedule two target reviewers and one story reviewer', async () => {
  assert.ok(snapshot);
  jobs = expand(configuredGroups());
  const workspace = await prepareReviewBatchWorkspace({ snapshot, jobs });
  jobs = workspace.jobs;
  jobContracts = jobs.map(
    (job) => job.input?.review_job as Record<string, unknown>,
  );
});

Then(
  'the generic batch contains {int} discoverable job workspaces',
  async (count: number) => {
    assert.equal(jobs.length, count);
    for (const contract of jobContracts) {
      assert.ok((await fs.stat(String(contract.job_dir))).isDirectory());
    }
  },
);

Then('every scheduled reviewer receives the common workspace contract', () => {
  for (const contract of jobContracts) {
    for (const field of [
      'input_dir',
      'job_dir',
      'work_dir',
      'output_dir',
      'verification_dir',
    ]) {
      assert.equal(typeof contract[field], 'string');
    }
  }
});

Then('no job workspace encodes a fast or slow review class', () => {
  assert.doesNotMatch(JSON.stringify(jobContracts), /fast|slow/iu);
});

When(
  'one reviewer writes an unexpected output filename while another remains empty',
  async () => {
    const first = jobContracts[0];
    const second = jobContracts[1];
    assert.ok(first && second);
    await fs.writeFile(
      path.join(String(first.output_dir), 'anything the reviewer chose.txt'),
      'useful evidence\n',
    );
    flexibleOutputVisible = (await fs.readdir(String(first.output_dir))).length === 1;
    emptyOutputVisible = (await fs.readdir(String(second.output_dir))).length === 0;
  },
);

Then(
  'both reviewer jobs remain discoverable without parsing their output',
  () => {
    assert.equal(flexibleOutputVisible, true);
    assert.equal(emptyOutputVisible, true);
  },
);

When(
  'I compare the same reviewer in two differently named scheduling groups',
  async () => {
    assert.ok(snapshot);
    const makeSingle = (id: string): FlowJsonValue[] => [
      {
        kind: 'matrix' as const,
        id,
        itemsFrom: 'targets',
        itemName: 'target',
        flowNames: ['movable_reviewer'],
        bindings: { workingFolderFrom: 'target.repo_root' },
      },
    ];
    const first = await prepareReviewBatchWorkspace({
      snapshot,
      jobs: expand(makeSingle('group_a')),
    });
    const second = await prepareReviewBatchWorkspace({
      snapshot: { ...snapshot, review_wave_id: '0000064-rw-regrouped' },
      jobs: expand(makeSingle('group_b')),
    });
    regroupedContracts = [first, second].map(
      (workspace) =>
        workspace.jobs[0]?.input?.review_job as Record<string, unknown>,
    );
  },
);

Then('both scheduled jobs expose the same common workspace fields', () => {
  assert.equal(regroupedContracts.length, 2);
  assert.deepEqual(
    Object.keys(regroupedContracts[0] ?? {}),
    Object.keys(regroupedContracts[1] ?? {}),
  );
});

After(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
  tempRoot = undefined;
  snapshot = undefined;
  jobs = [];
  jobContracts = [];
  flexibleOutputVisible = false;
  emptyOutputVisible = false;
  regroupedContracts = [];
});
