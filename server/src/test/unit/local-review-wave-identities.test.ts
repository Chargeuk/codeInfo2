import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { FlowSubflowWaveStep } from '../../flows/flowSchema.js';
import { expandSubflowWaveJobs } from '../../flows/subflowWave.js';

// These are the actual matrix identities written as Instance in each job.md.
test('local review phases expand distinct target job identities', () => {
  const file = path.resolve(process.cwd(), '../flows/local_review_current_plan.json');
  const flow = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    steps: Array<{
      label?: string;
      steps?: Array<{
        groups?: Array<{
          bindings: { inputValues: { review_groups: unknown } };
        }>;
      }>;
    }>;
  };
  const target = {
    target_id: 'repo-a',
    repo_root: '/repo-a',
  };
  const input = {
    review_batch_targets: {
      targets: [target],
      plan_host_root: '/repo-a',
    },
  };
  const jobsFor = (label: string) => {
    const phase = flow.steps.find((step) => step.label === label);
    assert.ok(phase?.steps?.[0]?.groups?.[0]);
    const groups = phase.steps[0].groups[0].bindings.inputValues.review_groups;
    return expandSubflowWaveJobs({
      step: {
        type: 'subflowWave',
        groups: groups as NonNullable<FlowSubflowWaveStep['groups']>,
      },
      input,
    });
  };
  assert.deepEqual(
    jobsFor('Standard Local Review').map((job) => job.instanceId),
    [
      'local_standard_target_reviews:repo-a:codex_review',
      'local_standard_target_reviews:repo-a:open_code_review',
      'local_standard_story_review:cross_repository_review',
    ],
  );
  assert.deepEqual(
    jobsFor('Deep Local Review').map((job) => job.instanceId),
    ['local_deep_target_reviews:repo-a:review_artifacts_main'],
  );
});

test('shared local batch expands review and automated jobs with the same snapshot', () => {
  const file = path.resolve(process.cwd(), '../flows/local_review_batch.json');
  const flow = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    steps: FlowSubflowWaveStep[];
  };
  const step = flow.steps.find((candidate) => candidate.type === 'subflowWave');
  assert.ok(step);
  const snapshot = {
    review_wave_id: 'wave-1',
    plan_host_root: '/repo-a',
    targets: [{ target_id: 'repo-a', repo_root: '/repo-a', head: 'abc123' }],
  };
  const reviewGroups = [{ kind: 'singleton', id: 'review' }];

  for (const enabled of [true, false]) {
    const jobs = expandSubflowWaveJobs({
      step,
      input: {
        review_batch_targets: snapshot,
        effective_review_groups: reviewGroups,
        parallel_automated_validation: enabled,
      },
    });
    assert.deepEqual(
      jobs.map((job) => job.flowName),
      ['review_filter_branch', 'review_automated_branch'],
    );
    assert.deepEqual(jobs[0]?.input?.review_batch_targets, snapshot);
    assert.deepEqual(jobs[1]?.input?.review_batch_targets, snapshot);
    assert.deepEqual(jobs[0]?.input?.effective_review_groups, reviewGroups);
    assert.equal(jobs[1]?.input?.parallel_automated_validation, enabled);
  }
});
