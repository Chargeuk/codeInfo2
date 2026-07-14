import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ReviewSetManifest } from '../../flows/reviewSet.js';
import type { ReviewTargetSnapshot } from '../../flows/reviewTargets.js';
import { validateReviewWave } from '../../flows/reviewWaveValidation.js';

const createFixture = async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-wave-validation-'),
  );
  const roots = [path.join(root, 'repo-a'), path.join(root, 'repo-b')];
  await Promise.all(
    roots.map((repoRoot) =>
      fs.mkdir(path.join(repoRoot, 'codeInfoTmp', 'reviews'), {
        recursive: true,
      }),
    ),
  );
  const targets = roots.map((repoRoot, index) => ({
    target_id: index === 0 ? 'current_repository' : 'repo-b',
    repo_alias: index === 0 ? 'current_repository' : 'repo-b',
    repo_root: repoRoot,
    repository_id: index === 0 ? 'repo-a' : 'repo-b',
    branch: 'feature/0000064-review',
    head_commit: String(index + 1).repeat(40),
    story_id: '0000064',
    is_primary: index === 0,
  }));
  const snapshot: ReviewTargetSnapshot = {
    schema_version: 'codeinfo-review-targets/v1',
    story_id: '0000064',
    plan_path: 'planning/0000064-review.md',
    branched_from: 'main',
    plan_host_root: roots[0] as string,
    review_wave_id: '0000064-rw-validation',
    parent_execution_id: 'execution-64',
    targets_sha256: 'a'.repeat(64),
    targets,
    created_at: '2026-07-14T12:00:00.000Z',
  };
  const flows = ['review_artifacts_main', 'codex_review', 'open_code_review'];
  const expectedJobs = [
    ...targets.flatMap((target) =>
      flows.map((flowName) => ({
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
  const reviewSet: ReviewSetManifest = {
    schema_version: 'codeinfo-review-set/v1',
    story_id: snapshot.story_id,
    review_wave_id: snapshot.review_wave_id,
    parent_execution_id: snapshot.parent_execution_id,
    targets_sha256: snapshot.targets_sha256,
    plan_host_root: snapshot.plan_host_root,
    target_count: 2,
    expected_job_count: expectedJobs.length,
    expected_jobs: expectedJobs,
    targets: targets.map((target) => ({
      target_id: target.target_id,
      repo_alias: target.repo_alias,
      repo_root: target.repo_root,
      branch: target.branch,
      head_commit: target.head_commit,
      status: 'prepared',
      base_pointer: 'codeInfoTmp/reviews/0000064-current-review-base.json',
      review_pointers: {
        artifact: 'codeInfoTmp/reviews/0000064-current-review.json',
        codex: 'codeInfoTmp/reviews/0000064-current-codex-review.json',
        open_code: 'codeInfoTmp/reviews/0000064-current-open-code-review.json',
      },
      error: null,
    })),
    coverage: {
      prepared_targets: 2,
      invalid_targets: 0,
      completed_jobs: 0,
      failed_jobs: 0,
      missing_jobs: expectedJobs.length,
    },
    status: 'prepared',
    created_at: '2026-07-14T12:00:00.000Z',
  };
  const pointerPath = (repoRoot: string, key: string) =>
    path.join(repoRoot, 'codeInfoTmp', 'reviews', `0000064-${key}.json`);
  for (const [targetIndex, target] of targets.entries()) {
    for (const [keyIndex, key] of [
      'current-review',
      'current-codex-review',
      'current-open-code-review',
    ].entries()) {
      await fs.writeFile(
        pointerPath(target.repo_root, key),
        JSON.stringify({
          story_id: snapshot.story_id,
          parent_execution_id: snapshot.parent_execution_id,
          review_wave_id: snapshot.review_wave_id,
          target_id: target.target_id,
          head_commit: target.head_commit,
          status: 'completed',
          findings:
            keyIndex < 2
              ? [
                  {
                    title: 'Shared contract mismatch',
                    path: 'src/contract.ts',
                    line: 12,
                    severity:
                      keyIndex === 0
                        ? targetIndex === 0
                          ? 'high'
                          : 'medium'
                        : targetIndex === 0
                          ? 'medium'
                          : 'low',
                  },
                ]
              : [],
        }),
      );
    }
  }
  const crossPointer = path.join(
    roots[0] as string,
    'codeInfoTmp',
    'reviews',
    '0000064-current-cross-repository-review.json',
  );
  await fs.writeFile(
    crossPointer,
    JSON.stringify({
      story_id: snapshot.story_id,
      review_wave_id: snapshot.review_wave_id,
      targets_sha256: snapshot.targets_sha256,
      status: 'completed',
      findings: [],
    }),
  );
  return { root, roots, snapshot, reviewSet, pointerPath, crossPointer };
};

test('complete review wave finalizes exact coverage and retains severity conflicts', async () => {
  const fixture = await createFixture();
  try {
    const result = await validateReviewWave({
      snapshot: fixture.snapshot,
      reviewSet: fixture.reviewSet,
    });

    assert.equal(result.finalized.status, 'completed');
    assert.equal(result.finalized.closeout_allowed, true);
    assert.equal(result.finalized.coverage.completed_jobs, 7);
    assert.equal(result.finalized.job_results?.length, 7);
    assert.equal(result.finalized.aggregated_findings?.length, 2);
    assert.equal(
      result.finalized.aggregated_findings?.every(
        (finding) =>
          finding.target_ids.length === 1 && finding.severity_conflict,
      ),
      true,
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(result.reviewSetPath, 'utf8')),
      result.finalized,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('partial and stale target results preserve usable sibling findings but block closeout', async () => {
  const fixture = await createFixture();
  try {
    await fs.rm(
      fixture.pointerPath(
        fixture.roots[1] as string,
        'current-open-code-review',
      ),
    );
    const stalePath = fixture.pointerPath(
      fixture.roots[1] as string,
      'current-codex-review',
    );
    const stale = JSON.parse(await fs.readFile(stalePath, 'utf8')) as {
      review_wave_id: string;
    };
    stale.review_wave_id = 'older-wave';
    await fs.writeFile(stalePath, JSON.stringify(stale));

    const result = await validateReviewWave({
      snapshot: fixture.snapshot,
      reviewSet: fixture.reviewSet,
    });

    assert.equal(result.finalized.status, 'completed_partial');
    assert.equal(result.finalized.closeout_allowed, false);
    assert.equal(result.finalized.coverage.missing_jobs, 1);
    assert.equal(result.finalized.coverage.failed_jobs, 1);
    assert.equal((result.finalized.aggregated_findings?.length ?? 0) > 0, true);
    assert.equal(
      result.finalized.job_results?.some((job) => job.status === 'stale'),
      true,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('multi-target review cannot close cleanly without usable cross-repository coverage', async () => {
  const fixture = await createFixture();
  try {
    await fs.rm(fixture.crossPointer);
    const result = await validateReviewWave({
      snapshot: fixture.snapshot,
      reviewSet: fixture.reviewSet,
    });

    assert.equal(result.finalized.cross_repository_status, 'missing');
    assert.equal(result.finalized.closeout_allowed, false);
    assert.equal(result.finalized.status, 'completed_partial');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
