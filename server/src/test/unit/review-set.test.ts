import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type {
  PreparedReviewBase,
  prepareReviewBase,
} from '../../flows/reviewBase.js';
import type { PreparedReviewContext } from '../../flows/reviewContext.js';
import { prepareReviewSet } from '../../flows/reviewSet.js';
import type {
  ReviewTarget,
  ReviewTargetSnapshot,
} from '../../flows/reviewTargets.js';

const sha = (character: string) => character.repeat(40);
const sha256 = (character: string) => character.repeat(64);

const context = (branch: string): PreparedReviewContext => ({
  schema_version: 'codeinfo-review-context/v1',
  story_id: '0000064',
  plan_path: 'planning/0000064-parallel-review.md',
  branch,
  source_plan_sha256: sha256('a'),
  context_sha256: sha256('b'),
  sections: {
    overview: { source_heading: 'Overview', markdown: '## Overview\n\nTest.' },
    acceptance_criteria: {
      source_heading: 'Acceptance Criteria',
      markdown: '## Acceptance Criteria\n\n- Works.',
    },
    out_of_scope: null,
  },
  excluded_paths: ['planning/**'],
  warnings: [],
  status: 'completed',
});

const target = (root: string, index: number): ReviewTarget => ({
  target_id: index === 0 ? 'current_repository' : `repo-${index}`,
  repo_alias: index === 0 ? 'current_repository' : `repo-${index}`,
  repo_root: root,
  repository_id: `repo-${index}`,
  branch: 'feature/0000064-parallel-review',
  head_commit: sha(String(index + 1)),
  comparison_base_commit: sha(String(index + 4)),
  story_id: '0000064',
  is_primary: index === 0,
});

const fixture = async (targetCount = 3) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-set-'));
  const roots = Array.from({ length: targetCount }, (_, index) =>
    path.join(root, `repo-${index}`),
  );
  await Promise.all(roots.map((repoRoot) => fs.mkdir(repoRoot)));
  const targets = roots.map(target);
  const snapshot: ReviewTargetSnapshot = {
    schema_version: 'codeinfo-review-targets/v1',
    story_id: '0000064',
    plan_path: 'planning/0000064-parallel-review.md',
    branched_from: 'main',
    plan_host_root: roots[0] as string,
    review_wave_id: '0000064-rw-test-wave',
    targets_sha256: sha256('c'),
    targets,
    created_at: '2026-07-14T12:00:00.000Z',
  };
  const reviewDir = path.join(roots[0] as string, 'codeInfoTmp', 'reviews');
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(reviewDir, '0000064-current-review-targets.json'),
    JSON.stringify(snapshot),
  );
  return { root, roots, snapshot };
};

const fakeContextPreparation = async (params: { branch: string }) => ({
  artifactPath: '/canonical/context.json',
  artifact: context(params.branch),
});

test('prepareReviewSet isolates target pointers and enumerates the complete wave', async () => {
  const prepared = await fixture();
  const calls: Array<Parameters<typeof prepareReviewBase>[0]> = [];
  try {
    const result = await prepareReviewSet(
      {
        snapshot: prepared.snapshot,
        reviewFlowNames: ['artifact', 'codex', 'open-code'],
        crossRepositoryFlowName: 'cross-repository',
      },
      {
        prepareReviewContext: fakeContextPreparation,
        prepareReviewBase: async (params) => {
          calls.push(params);
          const artifactPath = path.join(
            params.workingRepositoryPath,
            'codeInfoTmp',
            'reviews',
            '0000064-current-review-base.json',
          );
          return { artifactPath, artifact: {} as PreparedReviewBase };
        },
        now: () => new Date('2026-07-14T12:30:00.000Z'),
      },
    );

    assert.equal(result.stableUpdated, true);
    assert.equal(result.manifest.target_count, 3);
    assert.equal(result.manifest.expected_job_count, 10);
    assert.equal(result.manifest.coverage.prepared_targets, 3);
    assert.equal(result.manifest.coverage.missing_jobs, 10);
    assert.deepEqual(
      calls
        .map((call) => call.explicitScope?.target.targetId)
        .sort((left, right) => (left ?? '').localeCompare(right ?? '')),
      ['current_repository', 'repo-1', 'repo-2'],
    );
    assert.equal(
      new Set(calls.map((call) => call.workingRepositoryPath)).size,
      3,
    );
    assert.equal(
      calls.every(
        (call) =>
          call.explicitScope?.reviewWaveId ===
            prepared.snapshot.review_wave_id &&
          call.explicitScope.planHostRoot ===
            prepared.snapshot.plan_host_root &&
          call.explicitScope.target.targetId ===
            call.explicitScope.target.repoAlias,
      ),
      true,
    );
    assert.equal(
      calls.every(
        (call) =>
          call.explicitScope?.target.comparisonBaseCommit ===
          prepared.snapshot.targets.find(
            (target) => target.target_id === call.explicitScope?.target.targetId,
          )?.comparison_base_commit,
      ),
      true,
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(result.stablePath, 'utf8')),
      result.manifest,
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(result.versionedPath, 'utf8')),
      result.manifest,
    );
  } finally {
    await fs.rm(prepared.root, { recursive: true, force: true });
  }
});

test('phase-aware review sets expand fast 2N+1 and slow N job shapes', async () => {
  const prepared = await fixture();
  const prepareBase = async (
    params: Parameters<typeof prepareReviewBase>[0],
  ) => ({
    artifactPath: path.join(
      params.workingRepositoryPath,
      'codeInfoTmp/reviews/0000064-current-review-base.json',
    ),
    artifact: {} as PreparedReviewBase,
  });
  try {
    const fast = await prepareReviewSet(
      {
        snapshot: prepared.snapshot,
        reviewPhase: 'fast',
        reviewFlowNames: ['codex', 'open-code'],
        crossRepositoryFlowName: 'cross-repository',
      },
      {
        prepareReviewContext: fakeContextPreparation,
        prepareReviewBase: prepareBase,
      },
    );
    const slow = await prepareReviewSet(
      {
        snapshot: prepared.snapshot,
        reviewPhase: 'slow',
        reviewFlowNames: ['artifact'],
      },
      {
        prepareReviewContext: fakeContextPreparation,
        prepareReviewBase: prepareBase,
      },
    );

    assert.equal(fast.manifest.review_phase, 'fast');
    assert.equal(fast.manifest.cross_repository_required, true);
    assert.equal(fast.manifest.expected_job_count, 7);
    assert.equal(
      fast.manifest.expected_jobs.filter(
        (job) => job.kind === 'cross_repository_review',
      ).length,
      1,
    );
    assert.equal(slow.manifest.review_phase, 'slow');
    assert.equal(slow.manifest.cross_repository_required, false);
    assert.equal(slow.manifest.expected_job_count, 3);
    assert.equal(
      slow.manifest.expected_jobs.every(
        (job) => job.kind === 'target_review' && job.flow_name === 'artifact',
      ),
      true,
    );
  } finally {
    await fs.rm(prepared.root, { recursive: true, force: true });
  }
});

test('phase-aware review sets reject missing fast cross review and slow cross review', async () => {
  const prepared = await fixture(1);
  try {
    await assert.rejects(
      prepareReviewSet({
        snapshot: prepared.snapshot,
        reviewPhase: 'fast',
        reviewFlowNames: ['codex', 'open-code'],
      }),
      /require a cross-repository flow/u,
    );
    await assert.rejects(
      prepareReviewSet({
        snapshot: prepared.snapshot,
        reviewPhase: 'slow',
        reviewFlowNames: ['artifact'],
        crossRepositoryFlowName: 'cross-repository',
      }),
      /cannot include a cross-repository flow/u,
    );
  } finally {
    await fs.rm(prepared.root, { recursive: true, force: true });
  }
});

test('one-target phase-aware review sets expand to three fast jobs and one slow job', async () => {
  const prepared = await fixture(1);
  const prepareBase = async (
    params: Parameters<typeof prepareReviewBase>[0],
  ) => ({
    artifactPath: path.join(
      params.workingRepositoryPath,
      'codeInfoTmp/reviews/0000064-current-review-base.json',
    ),
    artifact: {} as PreparedReviewBase,
  });
  try {
    const fast = await prepareReviewSet(
      {
        snapshot: prepared.snapshot,
        reviewPhase: 'fast',
        reviewFlowNames: ['codex', 'open-code'],
        crossRepositoryFlowName: 'cross-repository',
      },
      {
        prepareReviewContext: fakeContextPreparation,
        prepareReviewBase: prepareBase,
      },
    );
    const slow = await prepareReviewSet(
      {
        snapshot: prepared.snapshot,
        reviewPhase: 'slow',
        reviewFlowNames: ['artifact'],
      },
      {
        prepareReviewContext: fakeContextPreparation,
        prepareReviewBase: prepareBase,
      },
    );

    assert.equal(fast.manifest.expected_job_count, 3);
    assert.equal(slow.manifest.expected_job_count, 1);
  } finally {
    await fs.rm(prepared.root, { recursive: true, force: true });
  }
});

test('prepareReviewSet invalidates only a drifting target', async () => {
  const prepared = await fixture();
  try {
    const result = await prepareReviewSet(
      {
        snapshot: prepared.snapshot,
        reviewFlowNames: ['artifact', 'codex', 'open-code'],
        crossRepositoryFlowName: 'cross-repository',
      },
      {
        prepareReviewContext: fakeContextPreparation,
        prepareReviewBase: async (params) => {
          if (params.explicitScope?.target.targetId === 'repo-1') {
            throw new Error('Review target HEAD drifted.');
          }
          return {
            artifactPath: path.join(
              params.workingRepositoryPath,
              'codeInfoTmp/reviews/0000064-current-review-base.json',
            ),
            artifact: {} as PreparedReviewBase,
          };
        },
      },
    );

    assert.equal(result.manifest.status, 'completed_with_invalid_targets');
    assert.equal(result.manifest.coverage.prepared_targets, 2);
    assert.equal(result.manifest.coverage.invalid_targets, 1);
    assert.equal(result.manifest.targets[1]?.status, 'invalid');
    assert.match(result.manifest.targets[1]?.error ?? '', /HEAD drifted/u);
  } finally {
    await fs.rm(prepared.root, { recursive: true, force: true });
  }
});

test('a stale wave writes versioned evidence without replacing the stable manifest', async () => {
  const prepared = await fixture(1);
  const stableReviewSetPath = path.join(
    prepared.roots[0] as string,
    'codeInfoTmp/reviews/0000064-current-review-set.json',
  );
  try {
    await fs.writeFile(stableReviewSetPath, JSON.stringify({ wave: 'newer' }));
    await fs.writeFile(
      path.join(
        prepared.roots[0] as string,
        'codeInfoTmp/reviews/0000064-current-review-targets.json',
      ),
      JSON.stringify({
        ...prepared.snapshot,
        review_wave_id: '0000064-rw-newer-wave',
      }),
    );
    const result = await prepareReviewSet(
      {
        snapshot: prepared.snapshot,
        reviewFlowNames: ['artifact', 'codex', 'open-code'],
        crossRepositoryFlowName: 'cross-repository',
      },
      {
        prepareReviewContext: fakeContextPreparation,
        prepareReviewBase: async (params) => ({
          artifactPath: path.join(
            params.workingRepositoryPath,
            'codeInfoTmp/reviews/0000064-current-review-base.json',
          ),
          artifact: {} as PreparedReviewBase,
        }),
      },
    );

    assert.equal(result.stableUpdated, false);
    assert.deepEqual(
      JSON.parse(await fs.readFile(stableReviewSetPath, 'utf8')),
      { wave: 'newer' },
    );
    assert.equal(
      (await fs.readFile(result.versionedPath, 'utf8')).includes(
        prepared.snapshot.review_wave_id,
      ),
      true,
    );
  } finally {
    await fs.rm(prepared.root, { recursive: true, force: true });
  }
});

test('prepareReviewSet propagates abort before writing a manifest', async () => {
  const prepared = await fixture(1);
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      prepareReviewSet(
        {
          snapshot: prepared.snapshot,
          reviewFlowNames: ['artifact', 'codex', 'open-code'],
          crossRepositoryFlowName: 'cross-repository',
          signal: controller.signal,
        },
        {
          prepareReviewContext: async (params) => {
            params.signal?.throwIfAborted();
            return fakeContextPreparation(params);
          },
        },
      ),
      /abort/iu,
    );
    await assert.rejects(
      fs.access(
        path.join(
          prepared.roots[0] as string,
          'codeInfoTmp/reviews/0000064-rw-test-wave-review-set.json',
        ),
      ),
    );
    await assert.rejects(
      fs.access(
        path.join(
          prepared.roots[0] as string,
          'codeInfoTmp',
          'reviews',
          '0000064-current-review-set.json',
        ),
      ),
    );
  } finally {
    await fs.rm(prepared.root, { recursive: true, force: true });
  }
});
