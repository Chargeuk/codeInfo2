import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { validateReviewArtifacts } from '../../flows/reviewArtifacts.js';

const execFile = promisify(execFileCb);
const BRANCH = 'feature/0000013-example';
const PLAN_PATH = 'planning/0000013-example.md';
const BASE = 'b'.repeat(40);
const SESSION = '0000013-rs-20260713T102726Z-aaaaaaaa-c0ffee12';
const PASS = '0000013-20260713T102726Z-aaaaaaaa-c0ffee12';
const PLAN =
  '# Story\n\n## Overview\n\nStory.\n\n## Acceptance Criteria\n\n- Works.\n';
const CONTEXT_MARKDOWN =
  '## Overview\n\nStory.\n\n## Acceptance Criteria\n\n- Works.';

type FixtureOptions = {
  codexSession?: string;
  invalidOcrBundleIndexes?: number[];
  missingOcrReportIndexes?: number[];
  ocrBundleCount?: number;
  mainStatus?: string;
  omitMainRepos?: boolean;
  ocrBranch?: string;
};

const initializeRepository = async (repoRoot: string): Promise<string> => {
  await execFile('git', ['init', '-q', repoRoot]);
  await execFile('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repoRoot,
  });
  await execFile('git', ['config', 'user.name', 'Test User'], {
    cwd: repoRoot,
  });
  await execFile('git', ['checkout', '-q', '-b', BRANCH], { cwd: repoRoot });
  await fs.mkdir(path.join(repoRoot, 'planning'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, PLAN_PATH), PLAN);
  await execFile('git', ['add', PLAN_PATH], { cwd: repoRoot });
  await execFile('git', ['commit', '-qm', 'test fixture'], { cwd: repoRoot });
  return (
    await execFile('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoRoot })
  ).stdout.trim();
};

const writeFixture = async (repoRoot: string, options: FixtureOptions = {}) => {
  const head = await initializeRepository(repoRoot);
  const reviewDir = path.join(repoRoot, 'codeInfoTmp', 'reviews');
  await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    JSON.stringify({ plan_path: PLAN_PATH }),
  );

  const sourcePlanSha256 = crypto
    .createHash('sha256')
    .update(PLAN)
    .digest('hex');
  const contextSha256 = crypto
    .createHash('sha256')
    .update(CONTEXT_MARKDOWN)
    .digest('hex');
  const identity = {
    story_id: '0000013',
    plan_path: PLAN_PATH,
    review_session_id: SESSION,
    review_pass_id: PASS,
    head_commit: head,
    comparison_base_commit: BASE,
    parent_execution_id: 'execution-13',
  };
  const scope = {
    repo_alias: 'current_repository',
    repo_root: repoRoot,
    branch: BRANCH,
    branched_from: 'main',
    logical_base_branch: 'main',
    resolved_base_branch: 'main',
    resolved_base_source: 'remote',
    remote_name: 'origin',
    remote_fetch_status: 'success',
    local_fallback_reason: null,
    comparison_base_ref: 'origin/main',
    comparison_head_ref: 'HEAD',
    comparison_rule: 'local_head_vs_resolved_base',
    review_context_file:
      'codeInfoTmp/reviews/0000013-current-review-context.json',
    review_context_sha256: contextSha256,
    review_context_source_plan_sha256: sourcePlanSha256,
    review_excluded_paths: ['planning/**'],
  };
  const currentRepository = {
    repo_alias: scope.repo_alias,
    repo_root: scope.repo_root,
    branch: scope.branch,
    logical_base_branch: scope.logical_base_branch,
    resolved_base_branch: scope.resolved_base_branch,
    resolved_base_source: scope.resolved_base_source,
    remote_name: scope.remote_name,
    remote_fetch_status: scope.remote_fetch_status,
    local_fallback_reason: scope.local_fallback_reason,
    comparison_base_ref: scope.comparison_base_ref,
    comparison_base_commit: identity.comparison_base_commit,
    comparison_head_ref: scope.comparison_head_ref,
    comparison_rule: scope.comparison_rule,
    head_commit: identity.head_commit,
  };
  await fs.writeFile(
    path.join(reviewDir, '0000013-current-review-context.json'),
    JSON.stringify({
      schema_version: 'codeinfo-review-context/v1',
      story_id: identity.story_id,
      plan_path: PLAN_PATH,
      branch: BRANCH,
      source_plan_sha256: sourcePlanSha256,
      context_sha256: contextSha256,
      sections: {
        overview: {
          source_heading: 'Overview',
          markdown: '## Overview\n\nStory.',
        },
        acceptance_criteria: {
          source_heading: 'Acceptance Criteria',
          markdown: '## Acceptance Criteria\n\n- Works.',
        },
        out_of_scope: null,
      },
      excluded_paths: ['planning/**'],
      warnings: [],
      status: 'completed',
    }),
  );
  await fs.writeFile(
    path.join(reviewDir, '0000013-current-review-base.json'),
    JSON.stringify({ ...identity, ...scope, status: 'completed' }),
  );
  await Promise.all(
    ['evidence.md', 'findings.md', 'codex.md', 'ocr.md'].map((name) =>
      fs.writeFile(path.join(reviewDir, name), `# ${name}\n`),
    ),
  );
  await fs.writeFile(
    path.join(reviewDir, '0000013-current-review.json'),
    JSON.stringify({
      ...identity,
      ...scope,
      evidence_file: 'codeInfoTmp/reviews/evidence.md',
      findings_file: 'codeInfoTmp/reviews/findings.md',
      ...(options.omitMainRepos ? {} : { repos: [currentRepository] }),
      status: options.mainStatus ?? 'completed',
    }),
  );
  await fs.writeFile(
    path.join(reviewDir, '0000013-current-codex-review.json'),
    JSON.stringify({
      ...identity,
      ...scope,
      review_session_id: options.codexSession ?? SESSION,
      canonical_review_pass_id: PASS,
      codex_review_pass_id: `${PASS}-codex`,
      review_output_file: 'codeInfoTmp/reviews/codex.md',
      status: 'completed',
    }),
  );

  const bundleCount = options.ocrBundleCount ?? 1;
  const invalidIndexes = new Set(options.invalidOcrBundleIndexes ?? []);
  const missingReportIndexes = new Set(options.missingOcrReportIndexes ?? []);
  const bundles = [];
  const manifestBundles = [];
  for (let index = 0; index < bundleCount; index += 1) {
    const bundleId = `sha256:${String(index + 1).padStart(64, '0')}`;
    const commentsFile = `ocr-comments-${index}.json`;
    const validationFile = `ocr-validation-${index}.json`;
    const reportFile = `ocr-report-${index}.md`;
    await fs.writeFile(
      path.join(reviewDir, commentsFile),
      JSON.stringify({
        schema_version: 'codex-review-comments/v1',
        bundle_id: bundleId,
        summary: { files_reviewed: 1, issues_found: 0 },
        comments: [],
      }),
    );
    await fs.writeFile(
      path.join(reviewDir, validationFile),
      JSON.stringify({
        schema_version: 'codex-review-validation/v1',
        bundle_id: bundleId,
        valid: !invalidIndexes.has(index),
        errors: invalidIndexes.has(index) ? [{ code: 'stale_bundle' }] : [],
        warnings: [],
      }),
    );
    if (!missingReportIndexes.has(index)) {
      await fs.writeFile(
        path.join(reviewDir, reportFile),
        '# OCR bundle report\n',
      );
    }
    bundles.push({
      bundle_id: bundleId,
      comments_path: `codeInfoTmp/reviews/${commentsFile}`,
      validation_path: `codeInfoTmp/reviews/${validationFile}`,
      report_path: `codeInfoTmp/reviews/${reportFile}`,
    });
    manifestBundles.push({
      schema_version: 'codex-review-bundle/v1',
      bundle_id: bundleId,
      target: { base_sha: BASE, head_sha: head },
    });
  }
  await fs.writeFile(
    path.join(reviewDir, 'ocr-manifest.json'),
    JSON.stringify({
      schema_version: 'codex-review-manifest/v1',
      partial: invalidIndexes.size > 0,
      bundles: manifestBundles,
    }),
  );
  await fs.writeFile(
    path.join(reviewDir, '0000013-current-open-code-review.json'),
    JSON.stringify({
      ...identity,
      ...scope,
      branch: options.ocrBranch ?? BRANCH,
      schema_version: 'codeinfo-open-code-review/v1',
      canonical_review_pass_id: PASS,
      open_code_review_pass_id: `${PASS}-ocr`,
      manifest_path: 'codeInfoTmp/reviews/ocr-manifest.json',
      bundles,
      coverage: {
        total_files: bundleCount,
        reviewable_files: bundleCount,
        reviewed_files: bundleCount - invalidIndexes.size,
        excluded_files: 0,
        skipped_files: 0,
        failed_files: invalidIndexes.size,
      },
      review_output_file: 'codeInfoTmp/reviews/ocr.md',
      overall_validation_status: invalidIndexes.size > 0 ? 'partial' : 'valid',
      partial: invalidIndexes.size > 0,
      status: 'completed',
    }),
  );
  return { head, identity };
};

test('validateReviewArtifacts accepts one coherent server-owned review session', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot);
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: [
        'current-review',
        'current-codex-review',
        'current-open-code-review',
      ],
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.schema_version, 2);
    assert.equal(result.story_id, '0000013');
    assert.equal(
      result.pointer_results.every((entry) => entry.usable),
      true,
    );
    assert.equal(result.validated_artifact_files.length, 8);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects a stale child but keeps coherent evidence usable', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot, {
      codexSession: '0000013-rs-20260703T175948Z-cccccccc-stale123',
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review', 'current-codex-review'],
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.pointer_results[0]?.status, 'passed');
    assert.equal(result.pointer_results[1]?.status, 'stale');
    assert.match(result.errors.join('\n'), /review_session_id/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts keeps valid OCR bundles when another bundle fails', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot, {
      ocrBundleCount: 2,
      invalidOcrBundleIndexes: [1],
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.pointer_results[0]?.status, 'partial');
    assert.equal(result.pointer_results[0]?.usable, true);
    assert.equal(result.pointer_results[0]?.usable_bundle_ids.length, 1);
    assert.match(result.warnings.join('\n'), /validation failed/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts keeps valid OCR bundles when another bundle artifact is missing', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot, {
      ocrBundleCount: 2,
      missingOcrReportIndexes: [1],
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.pointer_results[0]?.usable, true);
    assert.equal(result.pointer_results[0]?.usable_bundle_ids.length, 1);
    assert.match(result.warnings.join('\n'), /no such file/iu);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts records mismatched prepared scope without throwing', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot, { ocrBranch: 'feature/0000013-other-scope' });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.pointer_results[0]?.status, 'stale');
    assert.match(result.errors.join('\n'), /\.branch/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects a completed main pointer without repository scope', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot, { omitMainRepos: true });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.pointer_results[0]?.status, 'failed');
    assert.match(result.errors.join('\n'), /repos must contain/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts creates a fallback merge target when main review fails', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot, { mainStatus: 'failed' });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review', 'current-codex-review'],
    });
    assert.equal(result.status, 'partial');
    assert.ok(result.fallback_findings_file);
    const fallbackPointer = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000013-current-review.json',
        ),
        'utf8',
      ),
    ) as { status?: string; main_review_status?: string };
    assert.equal(fallbackPointer.status, 'partial');
    assert.equal(fallbackPointer.main_review_status, 'unavailable');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects all pointers after HEAD changes', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot);
    await fs.writeFile(path.join(repoRoot, 'changed.txt'), 'changed\n');
    await execFile('git', ['add', 'changed.txt'], { cwd: repoRoot });
    await execFile('git', ['commit', '-qm', 'advance head'], { cwd: repoRoot });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review', 'current-codex-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.equal(
      result.pointer_results.every((entry) => entry.status === 'stale'),
      true,
    );
    assert.match(result.errors.join('\n'), /stale or mismatched with Git/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
