import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { After, Given, Then, When } from '@cucumber/cucumber';

import { gateCrossRepositoryReview } from '../../flows/crossRepositoryReview.js';
import { parseFlowFile, type FlowStep } from '../../flows/flowSchema.js';
import type {
  ReviewArtifactsValidationResult,
  ReviewPointerValidationResult,
} from '../../flows/reviewArtifacts.js';
import type { ReviewSetManifest } from '../../flows/reviewSet.js';
import type { ReviewTargetSnapshot } from '../../flows/reviewTargets.js';
import { validateReviewWave } from '../../flows/reviewWaveValidation.js';
import {
  expandSubflowWaveJobs,
  type SubflowWaveJob,
} from '../../flows/subflowWave.js';

let tempRoot: string | undefined;
let snapshot: ReviewTargetSnapshot | undefined;
let reviewSet: ReviewSetManifest | undefined;
let jobs: SubflowWaveJob[] = [];
let firstPassInputIdentities: string[] = [];
let gateAction: string | undefined;
let jobStatuses: string[] = [];
let missingVisible = false;
let closeoutAllowed = false;
let downstreamOwners: string[] = [];
let embeddedTargetValidation = false;
let downstreamCrossCoverage = false;

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

const childInputIdentity = (job: SubflowWaveJob): string => {
  assert.ok(job.inputHash, `Expected ${job.instanceId} to have an input hash.`);
  return JSON.stringify([job.instanceId, job.inputHash]);
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
    comparison_base_commit: 'b'.repeat(40),
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
      ['codex_review', 'open_code_review'].map((flowName) => ({
        instance_id: `${target.target_id}--${flowName}`,
        flow_name: flowName,
        target_id: target.target_id,
        kind: 'target_review' as const,
      })),
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
    review_phase: 'fast',
    cross_repository_required: true,
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
      review_pointers: {
        codex: 'codeInfoTmp/reviews/current-codex-review.json',
        open_code: 'codeInfoTmp/reviews/current-open-code-review.json',
      },
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
  await Promise.all([
    fs.mkdir(path.join(tempRoot, 'codeInfoTmp', 'reviews'), {
      recursive: true,
    }),
    ...targets.map((target) =>
      fs.mkdir(path.join(target.repo_root, 'codeInfoTmp', 'reviews'), {
        recursive: true,
      }),
    ),
  ]);
  await fs.writeFile(
    path.join(
      tempRoot,
      'codeInfoTmp',
      'reviews',
      '0000064-current-review-targets.json',
    ),
    JSON.stringify(snapshot),
  );
};

const validateCurrentReviewSet = async (params: {
  includeCrossRepositoryResult: boolean;
  includeTargetFindings: boolean;
}) => {
  assert(snapshot && reviewSet);
  const activeSnapshot = snapshot;
  const activeReviewSet = reviewSet;
  if (params.includeCrossRepositoryResult) {
    await fs.writeFile(
      path.join(
        activeSnapshot.plan_host_root,
        'codeInfoTmp',
        'reviews',
        '0000064-current-cross-repository-review.json',
      ),
      JSON.stringify({
        schema_version: 'codeinfo-cross-repository-review/v1',
        story_id: activeSnapshot.story_id,
        review_wave_id: activeSnapshot.review_wave_id,
        parent_execution_id: activeSnapshot.parent_execution_id,
        targets_sha256: activeSnapshot.targets_sha256,
        target_count: activeSnapshot.targets.length,
        inspected_target_ids: activeSnapshot.targets.map(
          (target) => target.target_id,
        ),
        relationship_coverage: { 'current_repository->repo-1': 'inspected' },
        status: 'completed',
        findings: [],
        rejected_risks: [],
        residual_uncertainty: [],
        completed_at: '2026-07-14T12:01:00.000Z',
      }),
    );
  }
  const result = await validateReviewWave(
    { snapshot: activeSnapshot, reviewSet: activeReviewSet },
    {
      validateReviewArtifacts: async ({
        workingRepositoryPath,
        pointerKeys,
      }): Promise<ReviewArtifactsValidationResult> => {
        const target = activeSnapshot.targets.find(
          (candidate) => candidate.repo_root === workingRepositoryPath,
        );
        assert(target);
        if (!target.comparison_base_commit) {
          throw new Error('Review-wave fixture target is missing its base commit.');
        }
        const pointerResults: ReviewPointerValidationResult[] = pointerKeys.map(
          (pointerKey) => ({
            pointer_key: pointerKey,
            pointer_file: `codeInfoTmp/reviews/${pointerKey}.json`,
            status: 'passed',
            usable: true,
            errors: [],
            warnings: [],
            validated_artifact_files: [],
            usable_bundle_ids:
              pointerKey === 'current-open-code-review' ? ['bundle-1'] : [],
            validated_findings:
              params.includeTargetFindings &&
              pointerKey === 'current-codex-review'
                ? [
                    {
                      title: `Finding owned by ${target.repo_alias}`,
                      path: 'src/contract.ts',
                      line: activeSnapshot.targets.indexOf(target) + 1,
                      severity: 'should_fix',
                    },
                  ]
                : [],
          }),
        );
        return {
          schema_version: 2,
          validation_mode: 'wave_target',
          story_id: activeSnapshot.story_id,
          plan_path: activeSnapshot.plan_path,
          review_session_id: `${target.target_id}-session`,
          review_pass_id: `${target.target_id}-pass`,
          head_commit: target.head_commit,
          comparison_base_commit: target.comparison_base_commit,
          parent_execution_id: activeSnapshot.parent_execution_id,
          target_id: target.target_id,
          repo_alias: target.repo_alias,
          review_wave_id: activeSnapshot.review_wave_id,
          plan_host_root: activeSnapshot.plan_host_root,
          pointer_files: pointerResults.map((entry) => entry.pointer_file),
          pointer_results: pointerResults,
          validated_artifact_files: [],
          status: 'passed',
          errors: [],
          warnings: [],
          completed_at: '2026-07-14T12:01:00.000Z',
        };
      },
    },
  );
  reviewSet = result.finalized;
  return result.finalized;
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
      path.join(repoRoot, 'flows/two_phase_review_cycle.json'),
      'utf8',
    ),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const waveStep = findWaveStep(parsed.flow.steps);
  assert(waveStep);
  jobs = expandSubflowWaveJobs({
    step: waveStep,
    input: { fast_review_wave: snapshot, fast_review_set: reviewSet },
  });
  firstPassInputIdentities = jobs.map(childInputIdentity);
});

Then('the review wave expands to {int} job descriptors', (count: number) => {
  assert.equal(jobs.length, count);
});

Then('every target has exactly two fast local review jobs', () => {
  assert(snapshot);
  for (const target of snapshot.targets) {
    assert.equal(
      jobs.filter((job) => job.targetId === target.target_id).length,
      2,
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
      path.join(repoRoot, 'flows/two_phase_review_cycle.json'),
      'utf8',
    ),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok || !snapshot || !reviewSet) return;
  const waveStep = findWaveStep(parsed.flow.steps);
  assert(waveStep);
  jobs = expandSubflowWaveJobs({
    step: waveStep,
    input: { fast_review_wave: snapshot, fast_review_set: reviewSet },
  });
});

When('I expand the production slow review wave', async () => {
  assert(snapshot && reviewSet);
  const repoRoot = path.resolve(process.cwd(), '..');
  const parsed = parseFlowFile(
    await fs.readFile(
      path.join(repoRoot, 'flows/two_phase_review_cycle.json'),
      'utf8',
    ),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const waveStep = parsed.flow.steps.find(
    (step) =>
      step.type === 'subflowWave' && step.label === 'Run Slow Review Wave',
  );
  assert(waveStep?.type === 'subflowWave');
  jobs = expandSubflowWaveJobs({
    step: waveStep,
    input: {
      slow_review_wave: snapshot,
      slow_review_set: {
        ...reviewSet,
        review_phase: 'slow',
        cross_repository_required: false,
      },
    },
  });
});

Then('every target has exactly one slow main review job', () => {
  assert(snapshot);
  for (const target of snapshot.targets) {
    const targetJobs = jobs.filter((job) => job.targetId === target.target_id);
    assert.equal(targetJobs.length, 1);
    assert.equal(targetJobs[0]?.flowName, 'review_artifacts_main');
  }
  assert.equal(
    jobs.some((job) => job.flowName === 'cross_repository_review'),
    false,
  );
});

Then('no second-pass child reuses its first-pass input identity', () => {
  assert.equal(jobs.length, firstPassInputIdentities.length);
  const firstPassIdentities = new Set(firstPassInputIdentities);
  const secondPassIdentities = new Set(jobs.map(childInputIdentity));

  assert.equal(firstPassIdentities.size, firstPassInputIdentities.length);
  assert.equal(secondPassIdentities.size, jobs.length);
  assert.equal(
    [...secondPassIdentities].some((identity) =>
      firstPassIdentities.has(identity),
    ),
    false,
  );
});

When('I evaluate review-wave closeout', async () => {
  const finalized = await validateCurrentReviewSet({
    includeCrossRepositoryResult: false,
    includeTargetFindings: false,
  });
  jobStatuses = finalized.job_results?.map((job) => job.status) ?? [];
  missingVisible = jobStatuses.some((status) => status !== 'completed');
  closeoutAllowed = finalized.closeout_allowed === true;
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

Given(
  'a finalized review wave with {int} validated target owners',
  async (targetCount: number) => {
    await createPass(targetCount);
    assert(snapshot && reviewSet);
  },
);

When('I route aggregated review findings to downstream tasking', async () => {
  assert(snapshot);
  const finalized = await validateCurrentReviewSet({
    includeCrossRepositoryResult: true,
    includeTargetFindings: true,
  });
  downstreamOwners = (finalized.aggregated_findings ?? []).flatMap(
    (finding) => finding.target_ids,
  );
  embeddedTargetValidation = (finalized.job_results ?? [])
    .filter((job) => job.target_id !== null)
    .every(
      (job) =>
        job.validation?.usable === true &&
        job.validation.target_id === job.target_id &&
        job.validation_file?.startsWith(
          snapshot?.targets.find((target) => target.target_id === job.target_id)
            ?.repo_root ?? '',
        ),
    );
  downstreamCrossCoverage =
    finalized.cross_repository_status === 'completed' &&
    (finalized.job_results ?? []).some(
      (job) => job.target_id === null && job.status === 'completed',
    );
});

Then('every routed finding retains its validated target owner', () => {
  assert(snapshot);
  assert.deepEqual(
    [...downstreamOwners].sort(),
    snapshot.targets.map((target) => target.target_id).sort(),
  );
});

Then('cross-repository coverage remains visible downstream', () => {
  assert.equal(downstreamCrossCoverage, true);
});

Then(
  'downstream tasking uses embedded target validation instead of a plan-host-only pointer',
  () => {
    assert.equal(embeddedTargetValidation, true);
  },
);

After(async () => {
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
  snapshot = undefined;
  reviewSet = undefined;
  jobs = [];
  firstPassInputIdentities = [];
  gateAction = undefined;
  jobStatuses = [];
  missingVisible = false;
  closeoutAllowed = false;
  downstreamOwners = [];
  embeddedTargetValidation = false;
  downstreamCrossCoverage = false;
});
