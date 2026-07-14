import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { After, Given, Then, When } from '@cucumber/cucumber';

import { gateCrossRepositoryReview } from '../../flows/crossRepositoryReview.js';
import { parseFlowFile, type FlowStep } from '../../flows/flowSchema.js';
import type { ReviewSetManifest } from '../../flows/reviewSet.js';
import type { ReviewTargetSnapshot } from '../../flows/reviewTargets.js';
import {
  expandSubflowWaveJobs,
  type SubflowWaveJob,
} from '../../flows/subflowWave.js';

let tempRoot: string | undefined;
let snapshot: ReviewTargetSnapshot | undefined;
let reviewSet: ReviewSetManifest | undefined;
let jobs: SubflowWaveJob[] = [];
let firstPassHashes: string[] = [];
let gateAction: string | undefined;
let jobStatuses: string[] = [];
let missingVisible = false;
let closeoutAllowed = false;

const findWaveStep = (
  steps: FlowStep[],
): Extract<FlowStep, { type: 'subflowWave' }> | undefined => {
  for (const step of steps) {
    if (step.type === 'subflowWave') return step;
    if (step.type === 'startLoop') {
      const nested = findWaveStep(step.steps);
      if (nested) return nested;
    }
  }
  return undefined;
};

const createPass = async (targetCount: number, pass = 1) => {
  tempRoot ??= await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-wave-cucumber-'),
  );
  const targets = Array.from({ length: targetCount }, (_, index) => ({
    target_id: index === 0 ? 'current_repository' : `repo-${index}`,
    repo_alias: index === 0 ? 'current_repository' : `repo-${index}`,
    repo_root: path.join(tempRoot as string, `repo-${index}`),
    repository_id: `repo-${index}`,
    branch: 'feature/0000064-review',
    head_commit: String(pass + index).repeat(40),
    story_id: '0000064',
    is_primary: index === 0,
  }));
  snapshot = {
    schema_version: 'codeinfo-review-targets/v1',
    story_id: '0000064',
    plan_path: 'planning/0000064-review.md',
    branched_from: 'main',
    plan_host_root: tempRoot,
    review_wave_id: `0000064-rw-pass-${pass}`,
    parent_execution_id: `execution-${pass}`,
    targets_sha256: String(pass).repeat(64),
    targets,
    created_at: '2026-07-14T12:00:00.000Z',
  };
  const expectedJobs = [
    ...targets.flatMap((target) =>
      ['review_artifacts_main', 'codex_review', 'open_code_review'].map(
        (flowName) => ({
          instance_id: `${target.target_id}--${flowName}`,
          flow_name: flowName,
          target_id: target.target_id,
          kind: 'target_review' as const,
        }),
      ),
    ),
    {
      instance_id: 'story--cross_repository_review',
      flow_name: 'cross_repository_review',
      target_id: null,
      kind: 'cross_repository_review' as const,
    },
  ];
  reviewSet = {
    schema_version: 'codeinfo-review-set/v1',
    story_id: snapshot.story_id,
    review_wave_id: snapshot.review_wave_id,
    parent_execution_id: snapshot.parent_execution_id,
    targets_sha256: snapshot.targets_sha256,
    plan_host_root: snapshot.plan_host_root,
    target_count: targetCount,
    expected_job_count: expectedJobs.length,
    expected_jobs: expectedJobs,
    targets: targets.map((target) => ({
      target_id: target.target_id,
      repo_alias: target.repo_alias,
      repo_root: target.repo_root,
      branch: target.branch,
      head_commit: target.head_commit,
      status: 'prepared',
      base_pointer: 'base.json',
      review_pointers: {},
      error: null,
    })),
    coverage: {
      prepared_targets: targetCount,
      invalid_targets: 0,
      completed_jobs: 0,
      failed_jobs: 0,
      missing_jobs: expectedJobs.length,
    },
    status: 'prepared',
    created_at: '2026-07-14T12:00:00.000Z',
  };
};

Given(
  /^a review wave pass with (\d+) pinned target\(s\)$/u,
  async (targetCount: string) => {
    await createPass(Number(targetCount));
  },
);

When('I expand the production mixed review wave', async () => {
  assert(snapshot && reviewSet);
  const repoRoot = path.resolve(process.cwd(), '..');
  const parsed = parseFlowFile(
    await fs.readFile(
      path.join(repoRoot, 'flows/task_and_implement_plan.json'),
      'utf8',
    ),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const waveStep = findWaveStep(parsed.flow.steps);
  assert(waveStep);
  jobs = expandSubflowWaveJobs({
    step: waveStep,
    input: { review_wave: snapshot, review_set: reviewSet },
  });
  firstPassHashes = jobs.map((job) => job.inputHash ?? '');
});

Then('the review wave contains {int} concurrent jobs', (count: number) => {
  assert.equal(jobs.length, count);
});

Then('every target has exactly three local review jobs', () => {
  assert(snapshot);
  for (const target of snapshot.targets) {
    assert.equal(
      jobs.filter((job) => job.targetId === target.target_id).length,
      3,
    );
  }
});

Then('the review wave contains exactly one cross-repository singleton', () => {
  assert.equal(
    jobs.filter((job) => job.flowName === 'cross_repository_review').length,
    1,
  );
});

When('I gate the cross-repository review', async () => {
  assert(snapshot && reviewSet);
  const result = await gateCrossRepositoryReview({
    targetSnapshot: snapshot,
    reviewSet,
    outputKey: 'current-cross-repository-review',
  });
  gateAction = result.action;
});

Then('the cross-repository result is not applicable', () => {
  assert.equal(gateAction, 'not_applicable');
});

When('I advance every target and expand a second review pass', async () => {
  assert(snapshot);
  const targetCount = snapshot.targets.length;
  await createPass(targetCount, 2);
  const repoRoot = path.resolve(process.cwd(), '..');
  const parsed = parseFlowFile(
    await fs.readFile(
      path.join(repoRoot, 'flows/task_and_implement_plan.json'),
      'utf8',
    ),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok || !snapshot || !reviewSet) return;
  const waveStep = findWaveStep(parsed.flow.steps);
  assert(waveStep);
  jobs = expandSubflowWaveJobs({
    step: waveStep,
    input: { review_wave: snapshot, review_set: reviewSet },
  });
});

Then('no second-pass child reuses its first-pass input identity', () => {
  assert.equal(jobs.length, firstPassHashes.length);
  jobs.forEach((job, index) => {
    assert.notEqual(job.inputHash, firstPassHashes[index]);
  });
});

Given('review job statuses {string}', (statuses: string) => {
  jobStatuses = statuses.split(',');
});

When('I evaluate review-wave closeout', () => {
  missingVisible = jobStatuses.some((status) => status !== 'completed');
  closeoutAllowed = jobStatuses.every((status) => status === 'completed');
});

Then('missing review coverage remains visible', () => {
  assert.equal(missingVisible, true);
});

Then('review-wave closeout is blocked', () => {
  assert.equal(closeoutAllowed, false);
});

Then(
  'the review-wave consumer contract requires target-owned tasks',
  async () => {
    const contract = await fs.readFile(
      path.resolve(
        process.cwd(),
        '..',
        'codeinfo_markdown/shared/review-wave-consumer-contract.md',
      ),
      'utf8',
    );
    assert.match(contract, /target owner/iu);
    assert.match(contract, /one repository owner/iu);
  },
);

After(async () => {
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
  snapshot = undefined;
  reviewSet = undefined;
  jobs = [];
  firstPassHashes = [];
  gateAction = undefined;
  jobStatuses = [];
  missingVisible = false;
  closeoutAllowed = false;
});
