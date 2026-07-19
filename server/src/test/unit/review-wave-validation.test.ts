import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type {
  ReviewArtifactsValidationResult,
  ReviewPointerValidationResult,
} from '../../flows/reviewArtifacts.js';
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
  await fs.writeFile(
    path.join(
      root,
      'repo-a',
      'codeInfoTmp',
      'reviews',
      '0000064-current-review-targets.json',
    ),
    JSON.stringify(snapshot),
  );
  const flows = ['codex_review', 'open_code_review'];
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
    review_phase: 'fast',
    cross_repository_required: true,
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
            keyIndex > 0
              ? [
                  {
                    title: 'Shared contract mismatch',
                    path: 'src/contract.ts',
                    line: 12,
                    severity:
                      keyIndex === 1
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
      schema_version: 'codeinfo-cross-repository-review/v1',
      story_id: snapshot.story_id,
      review_wave_id: snapshot.review_wave_id,
      parent_execution_id: snapshot.parent_execution_id,
      targets_sha256: snapshot.targets_sha256,
      target_count: targets.length,
      status: 'completed',
      findings: [],
      rejected_risks: [],
      residual_uncertainty: [],
      completed_at: '2026-07-14T12:01:00.000Z',
    }),
  );
  const validateTargetArtifacts = async (params: {
    workingRepositoryPath: string;
    pointerKeys: string[];
    validationMode?: 'legacy' | 'wave_target';
    storyId?: string;
    ensureCanonicalFallback?: boolean;
  }): Promise<ReviewArtifactsValidationResult> => {
    assert.equal(params.validationMode, 'wave_target');
    assert.equal(params.storyId, snapshot.story_id);
    assert.equal(params.ensureCanonicalFallback, true);
    const target = targets.find(
      (candidate) => candidate.repo_root === params.workingRepositoryPath,
    );
    assert(target);
    const pointerResults: ReviewPointerValidationResult[] = [];
    for (const pointerKey of params.pointerKeys) {
      const filePath = pointerPath(target.repo_root, pointerKey);
      try {
        const pointer = JSON.parse(
          await fs.readFile(filePath, 'utf8'),
        ) as Record<string, unknown>;
        const identityMatches =
          pointer.story_id === snapshot.story_id &&
          pointer.parent_execution_id === snapshot.parent_execution_id &&
          pointer.review_wave_id === snapshot.review_wave_id &&
          pointer.target_id === target.target_id &&
          pointer.head_commit === target.head_commit;
        pointerResults.push({
          pointer_key: pointerKey,
          pointer_file: path.relative(target.repo_root, filePath),
          status: identityMatches ? 'passed' : 'stale',
          usable: identityMatches,
          errors: identityMatches
            ? []
            : [`${pointerKey} identity does not match the review wave.`],
          warnings: [],
          validated_artifact_files: [],
          usable_bundle_ids:
            pointerKey === 'current-open-code-review' && identityMatches
              ? ['bundle-1']
              : [],
          validated_findings: Array.isArray(pointer.findings)
            ? pointer.findings
            : [],
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        pointerResults.push({
          pointer_key: pointerKey,
          pointer_file: path.relative(target.repo_root, filePath),
          status: 'missing',
          usable: false,
          errors: [`${pointerKey} is missing.`],
          warnings: [],
          validated_artifact_files: [],
          usable_bundle_ids: [],
          validated_findings: [],
        });
      }
    }
    const usable = pointerResults.filter((result) => result.usable);
    return {
      schema_version: 2,
      validation_mode: 'wave_target',
      story_id: snapshot.story_id,
      plan_path: snapshot.plan_path,
      review_session_id: `${target.target_id}-session`,
      review_pass_id: `${target.target_id}-pass`,
      head_commit: target.head_commit,
      comparison_base_commit: 'b'.repeat(40),
      parent_execution_id: snapshot.parent_execution_id,
      target_id: target.target_id,
      repo_alias: target.repo_alias,
      review_wave_id: snapshot.review_wave_id,
      plan_host_root: snapshot.plan_host_root,
      pointer_files: pointerResults.map((result) => result.pointer_file),
      pointer_results: pointerResults,
      validated_artifact_files: [],
      status:
        usable.length === pointerResults.length
          ? 'passed'
          : usable.length > 0
            ? 'partial'
            : 'blocked',
      errors: pointerResults.flatMap((result) => result.errors),
      warnings: [],
      completed_at: '2026-07-14T12:01:00.000Z',
    };
  };
  return {
    root,
    roots,
    snapshot,
    reviewSet,
    pointerPath,
    crossPointer,
    validateTargetArtifacts,
  };
};

test('complete review wave finalizes exact coverage and retains severity conflicts', async () => {
  const fixture = await createFixture();
  try {
    const result = await validateReviewWave(
      {
        snapshot: fixture.snapshot,
        reviewSet: fixture.reviewSet,
      },
      { validateReviewArtifacts: fixture.validateTargetArtifacts },
    );

    assert.equal(result.finalized.status, 'completed');
    assert.equal(result.finalized.closeout_allowed, true);
    assert.equal(result.stableUpdated, true);
    assert.equal(result.finalized.coverage.completed_jobs, 5);
    assert.equal(result.finalized.job_results?.length, 5);
    assert.equal(
      result.finalized.job_results
        ?.filter((job) => job.target_id !== null)
        .every(
          (job) =>
            job.validation?.usable &&
            job.validation.target_id === job.target_id &&
            job.validation.review_wave_id === fixture.snapshot.review_wave_id,
        ),
      true,
    );
    assert.equal(result.finalized.aggregated_findings?.length, 2);
    assert.equal(
      result.finalized.aggregated_findings?.every(
        (finding) =>
          finding.target_ids.length === 1 && finding.severity_conflict,
      ),
      true,
    );
    for (const finding of result.finalized.aggregated_findings ?? []) {
      assert.equal(finding.sources.length, 2);
      assert.deepEqual(
        finding.sources.map((source) => source.review_name),
        ['Codex Review', 'Open Code Review'],
      );
      assert.equal(
        finding.sources.every(
          (source) =>
            source.review_phase === 'fast' &&
            source.target_id === finding.target_ids[0] &&
            source.repo_alias === finding.target_ids[0],
        ),
        true,
      );
    }
    assert.deepEqual(
      JSON.parse(await fs.readFile(result.reviewSetPath, 'utf8')),
      result.finalized,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('superseded complete wave keeps versioned evidence without replacing stable pointers', async () => {
  const fixture = await createFixture();
  try {
    const reviewsRoot = path.join(
      fixture.snapshot.plan_host_root,
      'codeInfoTmp',
      'reviews',
    );
    const stableTargetsPath = path.join(
      reviewsRoot,
      '0000064-current-review-targets.json',
    );
    const stableReviewSetPath = path.join(
      reviewsRoot,
      '0000064-current-review-set.json',
    );
    const stableValidationPath = path.join(
      reviewsRoot,
      '0000064-current-review-wave-validation.json',
    );
    await Promise.all([
      fs.writeFile(
        stableTargetsPath,
        JSON.stringify({
          ...fixture.snapshot,
          review_wave_id: '0000064-rw-newer',
          parent_execution_id: 'execution-newer',
        }),
      ),
      fs.writeFile(stableReviewSetPath, JSON.stringify({ stable: 'newer' })),
      fs.writeFile(stableValidationPath, JSON.stringify({ stable: 'newer' })),
    ]);

    const result = await validateReviewWave(
      { snapshot: fixture.snapshot, reviewSet: fixture.reviewSet },
      { validateReviewArtifacts: fixture.validateTargetArtifacts },
    );

    assert.equal(result.finalized.closeout_allowed, true);
    assert.equal(result.stableUpdated, false);
    assert.deepEqual(
      JSON.parse(await fs.readFile(stableReviewSetPath, 'utf8')),
      { stable: 'newer' },
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(stableValidationPath, 'utf8')),
      { stable: 'newer' },
    );
    assert.equal(
      JSON.parse(await fs.readFile(result.versionedReviewSetPath, 'utf8'))
        .review_wave_id,
      fixture.snapshot.review_wave_id,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('review wave deduplicates exact source repeats without losing sibling reviewers', async () => {
  const fixture = await createFixture();
  try {
    const codexPath = fixture.pointerPath(
      fixture.roots[0] as string,
      'current-codex-review',
    );
    const codex = JSON.parse(await fs.readFile(codexPath, 'utf8')) as {
      findings: Array<Record<string, unknown>>;
    };
    codex.findings.push({ ...codex.findings[0] });
    await fs.writeFile(codexPath, JSON.stringify(codex));

    const result = await validateReviewWave(
      { snapshot: fixture.snapshot, reviewSet: fixture.reviewSet },
      { validateReviewArtifacts: fixture.validateTargetArtifacts },
    );

    const finding = result.finalized.aggregated_findings?.find(
      (candidate) => candidate.target_ids[0] === 'current_repository',
    );
    assert(finding);
    assert.equal(finding.sources.length, 2);
    assert.deepEqual(
      finding.sources.map((source) => source.instance_id),
      [
        'current_repository--codex_review',
        'current_repository--open_code_review',
      ],
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('cross-repository findings retain story-scoped review provenance', async () => {
  const fixture = await createFixture();
  try {
    const cross = JSON.parse(
      await fs.readFile(fixture.crossPointer, 'utf8'),
    ) as {
      findings: Array<Record<string, unknown>>;
    };
    cross.findings = [
      {
        title: 'Cross-repository contract mismatch',
        path: 'src/integration.ts',
        line: 8,
        severity: 'high',
        target_ids: ['current_repository', 'repo-b'],
      },
    ];
    await fs.writeFile(fixture.crossPointer, JSON.stringify(cross));

    const result = await validateReviewWave(
      { snapshot: fixture.snapshot, reviewSet: fixture.reviewSet },
      { validateReviewArtifacts: fixture.validateTargetArtifacts },
    );

    const finding = result.finalized.aggregated_findings?.find(
      (candidate) => candidate.title === 'Cross-repository contract mismatch',
    );
    assert(finding);
    assert.deepEqual(finding.target_ids, ['current_repository', 'repo-b']);
    assert.deepEqual(finding.sources, [
      {
        instance_id: 'story--cross_repository_review',
        flow_name: 'cross_repository_review',
        review_phase: 'fast',
        target_id: null,
        repo_alias: null,
        review_name: 'Cross-Repository Review',
        severity: 'high',
      },
    ]);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('partial and stale target results publish the current canonical handoff but block closeout', async () => {
  const fixture = await createFixture();
  try {
    const stableReviewSetPath = path.join(
      fixture.snapshot.plan_host_root,
      'codeInfoTmp',
      'reviews',
      '0000064-current-review-set.json',
    );
    const stableValidationPath = path.join(
      fixture.snapshot.plan_host_root,
      'codeInfoTmp',
      'reviews',
      '0000064-current-review-wave-validation.json',
    );
    await fs.writeFile(
      stableReviewSetPath,
      JSON.stringify({ stable: 'newer' }),
    );
    await fs.writeFile(
      stableValidationPath,
      JSON.stringify({ stable: 'newer' }),
    );
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

    const result = await validateReviewWave(
      {
        snapshot: fixture.snapshot,
        reviewSet: fixture.reviewSet,
      },
      { validateReviewArtifacts: fixture.validateTargetArtifacts },
    );

    assert.equal(result.finalized.status, 'completed_partial');
    assert.equal(result.finalized.closeout_allowed, false);
    assert.equal(result.stableUpdated, true);
    assert.equal(result.finalized.coverage.missing_jobs, 1);
    assert.equal(result.finalized.coverage.failed_jobs, 1);
    assert.equal((result.finalized.aggregated_findings?.length ?? 0) > 0, true);
    assert.equal(
      result.finalized.job_results?.some((job) => job.status === 'stale'),
      true,
    );
    assert.deepEqual(
      result.finalized.aggregated_findings?.[0]?.sources.map(
        (source) => source.instance_id,
      ),
      [
        'current_repository--codex_review',
        'current_repository--open_code_review',
      ],
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(stableReviewSetPath, 'utf8')),
      result.finalized,
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(stableValidationPath, 'utf8')),
      result.validation,
    );
    assert.equal(
      JSON.parse(await fs.readFile(result.versionedReviewSetPath, 'utf8'))
        .closeout_allowed,
      false,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('multi-target review cannot close cleanly without usable cross-repository coverage', async () => {
  const fixture = await createFixture();
  try {
    await fs.rm(fixture.crossPointer);
    const result = await validateReviewWave(
      {
        snapshot: fixture.snapshot,
        reviewSet: fixture.reviewSet,
      },
      { validateReviewArtifacts: fixture.validateTargetArtifacts },
    );

    assert.equal(result.finalized.cross_repository_status, 'missing');
    assert.equal(result.finalized.closeout_allowed, false);
    assert.equal(result.finalized.status, 'completed_partial');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('multi-target review cannot close cleanly with a malformed cross-repository result', async () => {
  const fixture = await createFixture();
  try {
    await fs.writeFile(
      fixture.crossPointer,
      JSON.stringify({
        story_id: fixture.snapshot.story_id,
        review_wave_id: fixture.snapshot.review_wave_id,
        parent_execution_id: fixture.snapshot.parent_execution_id,
        targets_sha256: fixture.snapshot.targets_sha256,
        status: 'completed',
        findings: [],
      }),
    );

    const result = await validateReviewWave(
      {
        snapshot: fixture.snapshot,
        reviewSet: fixture.reviewSet,
      },
      { validateReviewArtifacts: fixture.validateTargetArtifacts },
    );

    assert.equal(result.finalized.cross_repository_status, 'invalid');
    assert.equal(result.finalized.closeout_allowed, false);
    assert.equal(result.finalized.status, 'completed_partial');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('slow review wave closes with complete target coverage and no cross-repository job', async () => {
  const fixture = await createFixture();
  try {
    for (const target of fixture.snapshot.targets) {
      const pointerPath = fixture.pointerPath(
        target.repo_root,
        'current-review',
      );
      const pointer = JSON.parse(
        await fs.readFile(pointerPath, 'utf8'),
      ) as Record<string, unknown>;
      pointer.findings = [
        {
          title: 'Main review finding',
          path: 'src/main-review.ts',
          line: 11,
          severity: 'should_fix',
        },
      ];
      await fs.writeFile(pointerPath, JSON.stringify(pointer));
    }
    const expectedJobs = fixture.snapshot.targets.map((target) => ({
      instance_id: `${target.target_id}--review_artifacts_main`,
      flow_name: 'review_artifacts_main',
      target_id: target.target_id,
      kind: 'target_review' as const,
    }));
    const slowReviewSet: ReviewSetManifest = {
      ...fixture.reviewSet,
      review_phase: 'slow',
      cross_repository_required: false,
      expected_job_count: expectedJobs.length,
      expected_jobs: expectedJobs,
      coverage: {
        ...fixture.reviewSet.coverage,
        missing_jobs: expectedJobs.length,
      },
    };

    const result = await validateReviewWave(
      {
        snapshot: fixture.snapshot,
        reviewSet: slowReviewSet,
      },
      { validateReviewArtifacts: fixture.validateTargetArtifacts },
    );

    assert.equal(result.finalized.review_phase, 'slow');
    assert.equal(result.finalized.cross_repository_status, 'not_expected');
    assert.equal(result.finalized.coverage.completed_jobs, 2);
    assert.equal(result.finalized.closeout_allowed, true);
    const mainReviewFindings = (
      result.finalized.aggregated_findings ?? []
    ).filter((finding) =>
      finding.sources.some(
        (source) => source.flow_name === 'review_artifacts_main',
      ),
    );
    assert.equal(mainReviewFindings.length, 2);
    assert.equal(
      mainReviewFindings.every(
        (finding) =>
          finding.sources.length === 1 &&
          finding.sources[0]?.review_name === 'Main Review' &&
          finding.sources[0]?.review_phase === 'slow' &&
          finding.sources[0]?.target_id === finding.target_ids[0] &&
          finding.sources[0]?.repo_alias === finding.target_ids[0],
      ),
      true,
    );
    assert.equal(result.validation.review_phase, 'slow');
    assert.equal(result.validation.cross_repository_required, false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('wave validation rejects a manifest bound to the wrong review phase', async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      validateReviewWave({
        snapshot: fixture.snapshot,
        reviewSet: fixture.reviewSet,
        expectedReviewPhase: 'slow',
      }),
      /identity, phase, or expected job count/u,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
