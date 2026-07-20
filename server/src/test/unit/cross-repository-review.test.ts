import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { gateCrossRepositoryReview } from '../../flows/crossRepositoryReview.js';
import type { ReviewSetManifest } from '../../flows/reviewSet.js';
import type { ReviewTargetSnapshot } from '../../flows/reviewTargets.js';

const buildFixture = async (targetCount: number, invalidTargets = 0) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cross-repo-review-'));
  const targets = Array.from({ length: targetCount }, (_, index) => ({
    target_id: index === 0 ? 'current_repository' : `repo-${index}`,
    repo_alias: index === 0 ? 'current_repository' : `repo-${index}`,
    repo_root: path.join(root, `repo-${index}`),
    repository_id: `repo-${index}`,
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
    plan_host_root: root,
    review_wave_id: '0000064-rw-test',
    targets_sha256: 'a'.repeat(64),
    targets,
    created_at: '2026-07-14T12:00:00.000Z',
  };
  const reviewSet: ReviewSetManifest = {
    schema_version: 'codeinfo-review-set/v1',
    story_id: snapshot.story_id,
    review_wave_id: snapshot.review_wave_id,
    targets_sha256: snapshot.targets_sha256,
    plan_host_root: root,
    target_count: targetCount,
    expected_job_count: targetCount * 3 + 1,
    expected_jobs: [],
    targets: targets.map((target, index) => ({
      target_id: target.target_id,
      repo_alias: target.repo_alias,
      repo_root: target.repo_root,
      branch: target.branch,
      head_commit: target.head_commit,
      status:
        index < invalidTargets ? ('invalid' as const) : ('prepared' as const),
      base_pointer: index < invalidTargets ? null : 'base.json',
      review_pointers: {},
      error: index < invalidTargets ? 'partial evidence' : null,
    })),
    coverage: {
      prepared_targets: targetCount - invalidTargets,
      invalid_targets: invalidTargets,
      completed_jobs: 0,
      failed_jobs: 0,
      missing_jobs: targetCount * 3 + 1,
    },
    status: invalidTargets ? 'completed_with_invalid_targets' : 'prepared',
    created_at: '2026-07-14T12:00:00.000Z',
  };
  return { root, snapshot, reviewSet };
};

test('one target publishes not_applicable without requesting review work', async () => {
  const fixture = await buildFixture(1);
  try {
    const currentTargetsPath = path.join(
      fixture.root,
      'codeInfoTmp',
      'reviews',
      '0000064-current-review-targets.json',
    );
    await fs.mkdir(path.dirname(currentTargetsPath), { recursive: true });
    await fs.writeFile(currentTargetsPath, JSON.stringify(fixture.snapshot));
    const result = await gateCrossRepositoryReview({
      targetSnapshot: fixture.snapshot,
      reviewSet: fixture.reviewSet,
      outputKey: 'current-cross-repository-review',
    });

    assert.equal(result.action, 'not_applicable');
    assert.ok(result.pointerPath);
    assert.ok(result.versionedPath);
    const pointer = JSON.parse(
      await fs.readFile(result.pointerPath as string, 'utf8'),
    ) as { status: string; findings: unknown[]; target_count: number };
    assert.equal(pointer.status, 'not_applicable');
    assert.equal(pointer.target_count, 1);
    assert.deepEqual(pointer.findings, []);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('a superseded singleton keeps its versioned result without replacing the current pointer', async () => {
  const fixture = await buildFixture(1);
  try {
    const currentTargetsPath = path.join(
      fixture.root,
      'codeInfoTmp',
      'reviews',
      '0000064-current-review-targets.json',
    );
    const currentPointerPath = path.join(
      fixture.root,
      'codeInfoTmp',
      'reviews',
      '0000064-current-cross-repository-review.json',
    );
    await fs.mkdir(path.dirname(currentTargetsPath), { recursive: true });
    await Promise.all([
      fs.writeFile(
        currentTargetsPath,
        JSON.stringify({
          ...fixture.snapshot,
          review_wave_id: '0000064-rw-newer',
        }),
      ),
      fs.writeFile(
        currentPointerPath,
        JSON.stringify({ review_wave_id: '0000064-rw-newer' }),
      ),
    ]);

    const result = await gateCrossRepositoryReview({
      targetSnapshot: fixture.snapshot,
      reviewSet: fixture.reviewSet,
      outputKey: 'current-cross-repository-review',
    });

    assert.equal(
      JSON.parse(await fs.readFile(currentPointerPath, 'utf8')).review_wave_id,
      '0000064-rw-newer',
    );
    assert.equal(
      JSON.parse(await fs.readFile(result.versionedPath as string, 'utf8'))
        .review_wave_id,
      fixture.snapshot.review_wave_id,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('multiple targets request one review even when some local evidence is partial', async () => {
  const fixture = await buildFixture(3, 1);
  try {
    const result = await gateCrossRepositoryReview({
      targetSnapshot: fixture.snapshot,
      reviewSet: fixture.reviewSet,
      outputKey: 'current-cross-repository-review',
    });

    assert.equal(result.action, 'review_required');
    assert.equal(result.targetSnapshot.targets.length, 3);
    assert.equal(result.reviewSet.coverage.invalid_targets, 1);
    assert.equal(result.pointerPath, undefined);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('cross-repository gate rejects review-set identity and target mismatches', async () => {
  const fixture = await buildFixture(2);
  try {
    await assert.rejects(
      gateCrossRepositoryReview({
        targetSnapshot: fixture.snapshot,
        reviewSet: {
          ...fixture.reviewSet,
          targets_sha256: 'b'.repeat(64),
        },
        outputKey: 'current-cross-repository-review',
      }),
      /identity does not match/u,
    );
    await assert.rejects(
      gateCrossRepositoryReview({
        targetSnapshot: fixture.snapshot,
        reviewSet: {
          ...fixture.reviewSet,
          targets: fixture.reviewSet.targets.map((target, index) =>
            index === 1 ? { ...target, target_id: 'unexpected' } : target,
          ),
        },
        outputKey: 'current-cross-repository-review',
      }),
      /coverage is mismatched/u,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
