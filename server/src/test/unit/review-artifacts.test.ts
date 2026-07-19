import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { validateReviewArtifacts as validateReviewArtifactsRaw } from '../../flows/reviewArtifacts.js';

const execFile = promisify(execFileCb);
const BRANCH = 'feature/0000013-example';
const PLAN_PATH = 'planning/0000013-example.md';
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
  additionalRepositoryPath?: string;
  additionalBaseMode?: 'correct' | 'head';
  additionalComparisonBaseRef?: string;
  additionalResolvedBaseBranch?: string;
  additionalResolvedBaseSource?: 'remote' | 'local_fallback';
  additionalRepositoriesValue?: unknown;
  omitAdditionalMainRepo?: boolean;
  ocrBranch?: string;
  divergedComparisonBase?: boolean;
  ocrTargetFrom?: string;
  commentsReviewedFiles?: number;
  pointerTotalFiles?: number;
  waveScope?: boolean;
  ocrCoverageShape?: 'nested' | 'top-level' | 'missing' | 'conflicting';
  ocrBundleShape?: 'canonical' | 'legacy' | 'conflicting' | 'malformed';
  ocrInlineFindings?: Array<Record<string, unknown>>;
};

const argumentValue = (args: string[], flag: string): string => {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `missing ${flag} in OCR command`);
  const value = args[index + 1];
  assert.ok(value, `missing ${flag} value in OCR command`);
  return value;
};

const runFixtureOcrCommand = async (params: { args: string[] }) => {
  const outputPath = argumentValue(params.args, '--output');
  const repoRoot = argumentValue(params.args, '--repo');
  const reviewDir = path.join(repoRoot, 'codeInfoTmp', 'reviews');
  const command = params.args.slice(0, 2).join(' ');
  if (command === 'agent prepare') {
    assert.equal(argumentValue(params.args, '--exclude'), 'planning/**');
    await fs.copyFile(
      path.join(reviewDir, 'ocr-canonical-manifest.json'),
      outputPath,
    );
    return;
  }
  const commentsPath = argumentValue(params.args, '--comments');
  const match = path.basename(commentsPath).match(/ocr-comments-(\d+)\.json/u);
  assert.ok(match, `unexpected comments path ${commentsPath}`);
  const index = match[1];
  if (command === 'agent validate-comments') {
    await fs.copyFile(
      path.join(reviewDir, `ocr-canonical-validation-${index}.json`),
      outputPath,
    );
    return;
  }
  assert.equal(command, 'agent report');
  await fs.copyFile(
    path.join(reviewDir, `ocr-canonical-report-${index}.md`),
    outputPath,
  );
};

const validateReviewArtifacts = (
  params: Parameters<typeof validateReviewArtifactsRaw>[0],
) =>
  validateReviewArtifactsRaw(params, { runOcrCommand: runFixtureOcrCommand });

const initializeRepository = async (
  repoRoot: string,
  divergedComparisonBase = false,
): Promise<{ base: string; head: string; mergeBase: string }> => {
  await execFile('git', ['init', '-q', repoRoot]);
  await execFile('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repoRoot,
  });
  await execFile('git', ['config', 'user.name', 'Test User'], {
    cwd: repoRoot,
  });
  await execFile('git', ['checkout', '-q', '-b', 'main'], { cwd: repoRoot });
  await fs.mkdir(path.join(repoRoot, 'planning'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, PLAN_PATH), PLAN);
  await execFile('git', ['add', PLAN_PATH], { cwd: repoRoot });
  await execFile('git', ['commit', '-qm', 'test fixture'], { cwd: repoRoot });
  const mergeBase = (
    await execFile('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoRoot })
  ).stdout.trim();
  await execFile('git', ['checkout', '-q', '-b', BRANCH], { cwd: repoRoot });
  await fs.writeFile(
    path.join(repoRoot, 'changed.ts'),
    'export const changed = true;\n',
  );
  await execFile('git', ['add', 'changed.ts'], { cwd: repoRoot });
  await execFile('git', ['commit', '-qm', 'feature change'], { cwd: repoRoot });
  const head = (
    await execFile('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoRoot })
  ).stdout.trim();
  let base = mergeBase;
  if (divergedComparisonBase) {
    await execFile('git', ['checkout', '-q', 'main'], { cwd: repoRoot });
    await fs.writeFile(
      path.join(repoRoot, 'main-change.ts'),
      'export const main = true;\n',
    );
    await execFile('git', ['add', 'main-change.ts'], { cwd: repoRoot });
    await execFile('git', ['commit', '-qm', 'advance main'], { cwd: repoRoot });
    base = (
      await execFile('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoRoot })
    ).stdout.trim();
    await execFile('git', ['checkout', '-q', BRANCH], { cwd: repoRoot });
  }
  return { base, head, mergeBase };
};

const initializeAdditionalRepository = async (
  repoRoot: string,
): Promise<{ base: string; head: string }> => {
  await execFile('git', ['init', '-q', repoRoot]);
  await execFile('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repoRoot,
  });
  await execFile('git', ['config', 'user.name', 'Test User'], {
    cwd: repoRoot,
  });
  await execFile('git', ['checkout', '-q', '-b', 'main'], { cwd: repoRoot });
  await fs.writeFile(
    path.join(repoRoot, 'base.ts'),
    'export const base = true;\n',
  );
  await execFile('git', ['add', 'base.ts'], { cwd: repoRoot });
  await execFile('git', ['commit', '-qm', 'additional base'], {
    cwd: repoRoot,
  });
  const base = (
    await execFile('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoRoot })
  ).stdout.trim();
  await execFile('git', ['checkout', '-q', '-b', BRANCH], { cwd: repoRoot });
  await fs.writeFile(
    path.join(repoRoot, 'additional.ts'),
    'export const additional = true;\n',
  );
  await execFile('git', ['add', 'additional.ts'], { cwd: repoRoot });
  await execFile('git', ['commit', '-qm', 'additional fixture'], {
    cwd: repoRoot,
  });
  const head = (
    await execFile('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoRoot })
  ).stdout.trim();
  return { base, head };
};

const writeFixture = async (repoRoot: string, options: FixtureOptions = {}) => {
  const { base, head, mergeBase } = await initializeRepository(
    repoRoot,
    options.divergedComparisonBase,
  );
  const reviewDir = path.join(repoRoot, 'codeInfoTmp', 'reviews');
  await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    JSON.stringify({
      plan_path: PLAN_PATH,
      ...(options.additionalRepositoriesValue !== undefined
        ? { additional_repositories: options.additionalRepositoriesValue }
        : options.additionalRepositoryPath
          ? {
              additional_repositories: [
                { path: options.additionalRepositoryPath },
              ],
            }
          : {}),
    }),
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
    comparison_base_commit: base,
    parent_execution_id: 'execution-13',
    ...(options.waveScope
      ? {
          target_id: 'current_repository',
          review_wave_id: '0000013-rw-wave-target',
          plan_host_root: repoRoot,
        }
      : {}),
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
  const mainRepos: Array<Record<string, unknown>> = [currentRepository];
  if (options.additionalRepositoryPath && !options.omitAdditionalMainRepo) {
    const additionalResolvedBaseSource =
      options.additionalResolvedBaseSource ?? 'local_fallback';
    const additionalHead = (
      await execFile('git', ['rev-parse', 'HEAD^{commit}'], {
        cwd: options.additionalRepositoryPath,
      })
    ).stdout.trim();
    const additionalBase = (
      await execFile('git', ['rev-parse', 'main^{commit}'], {
        cwd: options.additionalRepositoryPath,
      })
    ).stdout.trim();
    mainRepos.push({
      repo_alias: 'additional_repository_1',
      repo_root: options.additionalRepositoryPath,
      branch: BRANCH,
      logical_base_branch: 'main',
      resolved_base_branch: options.additionalResolvedBaseBranch ?? 'main',
      resolved_base_source: additionalResolvedBaseSource,
      remote_name: 'origin',
      remote_fetch_status:
        additionalResolvedBaseSource === 'remote'
          ? 'success'
          : 'missing_remote',
      local_fallback_reason:
        additionalResolvedBaseSource === 'remote' ? null : 'missing_remote',
      comparison_base_ref: options.additionalComparisonBaseRef ?? 'main',
      comparison_base_commit:
        options.additionalBaseMode === 'head' ? additionalHead : additionalBase,
      comparison_head_ref: 'HEAD',
      comparison_rule: 'local_head_vs_resolved_base',
      head_commit: additionalHead,
    });
  }
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
      findings: [],
      ...(options.omitMainRepos ? {} : { repos: mainRepos }),
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
        summary: {
          files_reviewed: options.commentsReviewedFiles ?? 1,
          issues_found: 0,
        },
        comments: [],
      }),
    );
    const validation = {
      schema_version: 'codex-review-validation/v1',
      bundle_id: bundleId,
      valid: !invalidIndexes.has(index),
      errors: invalidIndexes.has(index)
        ? [{ code: 'stale_bundle', message: 'stale' }]
        : [],
      warnings: [],
    };
    await Promise.all([
      fs.writeFile(
        path.join(reviewDir, validationFile),
        JSON.stringify(validation),
      ),
      fs.writeFile(
        path.join(reviewDir, `ocr-canonical-validation-${index}.json`),
        JSON.stringify(validation),
      ),
    ]);
    const report = `# OCR bundle report\n\n- Bundle: ${bundleId}\n`;
    if (!missingReportIndexes.has(index)) {
      await fs.writeFile(path.join(reviewDir, reportFile), report);
    }
    await fs.writeFile(
      path.join(reviewDir, `ocr-canonical-report-${index}.md`),
      report,
    );
    bundles.push({
      bundle_id: bundleId,
      comments_path: `codeInfoTmp/reviews/${commentsFile}`,
      validation_path: `codeInfoTmp/reviews/${validationFile}`,
      report_path: `codeInfoTmp/reviews/${reportFile}`,
    });
    manifestBundles.push({
      schema_version: 'codex-review-bundle/v1',
      bundle_id: bundleId,
      target: {
        mode: 'range',
        from: options.ocrTargetFrom ?? base,
        to: head,
        base_sha: mergeBase,
        head_sha: head,
        merge_base_sha: mergeBase,
        diff_sha256: `sha256:${'d'.repeat(64)}`,
      },
      summary: {
        total_files: 1,
        reviewable_files: 1,
        excluded_files: 0,
      },
      files: [
        {
          path: `changed-${index}.ts`,
          reviewable: true,
          patch: '@@ -0,0 +1 @@\n+change',
          hunks: [],
        },
      ],
    });
  }
  const manifest = {
    schema_version: 'codex-review-manifest/v1',
    manifest_id: `sha256:${'a'.repeat(64)}`,
    root: repoRoot,
    target_hash: `sha256:${'d'.repeat(64)}`,
    batch_strategy: 'diff',
    batch_size: 1,
    partial: invalidIndexes.size > 0,
    summary: {
      total_files: bundleCount,
      reviewable_files: bundleCount,
      excluded_files: 0,
    },
    skipped_files: [],
    bundles: manifestBundles,
  };
  await Promise.all([
    fs.writeFile(
      path.join(reviewDir, 'ocr-manifest.json'),
      JSON.stringify(manifest),
    ),
    fs.writeFile(
      path.join(reviewDir, 'ocr-canonical-manifest.json'),
      JSON.stringify(manifest),
    ),
  ]);
  const pointerCoverage = {
    total_files: options.pointerTotalFiles ?? bundleCount,
    reviewable_files: bundleCount,
    reviewed_files: bundleCount - invalidIndexes.size,
    excluded_files: 0,
    skipped_files: 0,
    failed_files: invalidIndexes.size,
  };
  const coverageShape = options.ocrCoverageShape ?? 'nested';
  const pointerCoverageFields =
    coverageShape === 'top-level'
      ? pointerCoverage
      : coverageShape === 'missing'
        ? {}
        : coverageShape === 'conflicting'
          ? {
              coverage: pointerCoverage,
              total_files: pointerCoverage.total_files + 1,
            }
          : { coverage: pointerCoverage };
  const legacyBundles = bundles.map((bundle) => ({
    bundle_id: bundle.bundle_id,
    comments_file: bundle.comments_path,
    validation_file: bundle.validation_path,
    report_file: bundle.report_path,
    validation_status: 'valid',
  }));
  const bundleShape = options.ocrBundleShape ?? 'canonical';
  const pointerBundleFields =
    bundleShape === 'legacy'
      ? { bundle_artifacts: legacyBundles }
      : bundleShape === 'conflicting'
        ? {
            bundles,
            bundle_artifacts: legacyBundles.map((bundle, index) =>
              index === 0
                ? { ...bundle, report_file: 'codeInfoTmp/reviews/other.md' }
                : bundle,
            ),
          }
        : bundleShape === 'malformed'
          ? {
              bundle_artifacts: legacyBundles.map((bundle, index) =>
                index === 0 ? { ...bundle, comments_file: undefined } : bundle,
              ),
            }
          : { bundles };
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
      ...pointerBundleFields,
      ...pointerCoverageFields,
      review_output_file: 'codeInfoTmp/reviews/ocr.md',
      overall_validation_status: invalidIndexes.size > 0 ? 'partial' : 'valid',
      partial: invalidIndexes.size > 0,
      findings: options.ocrInlineFindings ?? [],
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
    assert.equal(result.validation_mode, 'legacy');
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

test('validateReviewArtifacts publishes server-owned findings from a JSON findings pointer', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-findings-pointer-'),
  );
  try {
    await writeFixture(repoRoot);
    const findings = [
      {
        title: 'Validated finding',
        path: 'src/example.ts',
        line: 7,
        severity: 'high',
      },
    ];
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoTmp', 'reviews', 'findings.json'),
      JSON.stringify(findings),
    );
    const pointerPath = path.join(
      repoRoot,
      'codeInfoTmp',
      'reviews',
      '0000013-current-codex-review.json',
    );
    const pointer = JSON.parse(
      await fs.readFile(pointerPath, 'utf8'),
    ) as Record<string, unknown>;
    pointer.findings_file = 'codeInfoTmp/reviews/findings.json';
    await fs.writeFile(pointerPath, JSON.stringify(pointer));

    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-codex-review'],
    });

    assert.equal(result.status, 'passed');
    assert.deepEqual(result.pointer_results[0]?.validated_findings, findings);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts consumes inline main-review findings while retaining the Markdown disposition artifact', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-main-findings-pointer-'),
  );
  try {
    await writeFixture(repoRoot);
    const findings = [
      {
        title: 'Validated main-review finding',
        path: 'src/main-review.ts',
        line: 11,
        severity: 'should_fix',
      },
    ];
    const pointerPath = path.join(
      repoRoot,
      'codeInfoTmp',
      'reviews',
      '0000013-current-review.json',
    );
    const pointer = JSON.parse(
      await fs.readFile(pointerPath, 'utf8'),
    ) as Record<string, unknown>;
    pointer.findings = findings;
    await fs.writeFile(pointerPath, JSON.stringify(pointer));

    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
    });

    assert.equal(result.status, 'passed');
    assert.deepEqual(result.pointer_results[0]?.validated_findings, findings);
    assert.equal(result.pointer_results[0]?.structured_findings_declared, true);
    assert.equal(
      JSON.parse(await fs.readFile(pointerPath, 'utf8')).findings_file,
      'codeInfoTmp/reviews/findings.md',
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects a completed main-review pointer with only Markdown findings', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-main-markdown-only-'),
  );
  try {
    await writeFixture(repoRoot);
    const pointerPath = path.join(
      repoRoot,
      'codeInfoTmp',
      'reviews',
      '0000013-current-review.json',
    );
    const pointer = JSON.parse(
      await fs.readFile(pointerPath, 'utf8'),
    ) as Record<string, unknown>;
    delete pointer.findings;
    await fs.writeFile(pointerPath, JSON.stringify(pointer));

    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.pointer_results[0]?.usable, false);
    assert.equal(
      result.pointer_results[0]?.structured_findings_declared,
      false,
    );
    assert.match(
      result.pointer_results[0]?.errors[0] ?? '',
      /must declare structured findings/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts validates a wave target without an ambient current-plan handoff', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-wave-target-'),
  );
  try {
    await writeFixture(repoRoot, { waveScope: true });
    await fs.rm(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    );

    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      storyId: '0000013',
      validationMode: 'wave_target',
      pointerKeys: [
        'current-review',
        'current-codex-review',
        'current-open-code-review',
      ],
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.validation_mode, 'wave_target');
    assert.equal(result.target_id, 'current_repository');
    assert.equal(result.review_wave_id, '0000013-rw-wave-target');
    assert.equal(result.plan_host_root, repoRoot);
    assert.equal(
      result.pointer_results.every((entry) => entry.usable),
      true,
    );
    assert.deepEqual(
      result.pointer_results.find(
        (entry) => entry.pointer_key === 'current-open-code-review',
      )?.usable_bundle_ids,
      [`sha256:${'1'.padStart(64, '0')}`],
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts creates a target-scoped fallback when every fast wave reviewer is unusable', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-wave-target-fallback-'),
  );
  try {
    await writeFixture(repoRoot, {
      waveScope: true,
      codexSession: 'stale-session',
      ocrBranch: 'feature/0000013-other-scope',
    });
    await fs.rm(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    );

    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      storyId: '0000013',
      validationMode: 'wave_target',
      pointerKeys: ['current-codex-review', 'current-open-code-review'],
      ensureCanonicalFallback: true,
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.fallback_findings_file);
    const canonicalPointer = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000013-current-review.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(canonicalPointer.status, 'completed');
    assert.equal(canonicalPointer.target_id, 'current_repository');
    assert.equal(canonicalPointer.review_wave_id, '0000013-rw-wave-target');
    assert.equal(canonicalPointer.plan_host_root, repoRoot);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts publishes usable wave-target validation for transitional OCR pointer shapes', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-wave-target-top-level-coverage-'),
  );
  try {
    await writeFixture(repoRoot, {
      waveScope: true,
      ocrCoverageShape: 'top-level',
      ocrBundleShape: 'legacy',
    });
    await fs.rm(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    );

    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      storyId: '0000013',
      validationMode: 'wave_target',
      pointerKeys: ['current-open-code-review'],
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.validation_mode, 'wave_target');
    assert.equal(result.target_id, 'current_repository');
    assert.equal(result.review_wave_id, '0000013-rw-wave-target');
    assert.equal(result.plan_host_root, repoRoot);
    assert.equal(result.pointer_results[0]?.usable, true);
    assert.deepEqual(result.pointer_results[0]?.usable_bundle_ids, [
      `sha256:${'1'.padStart(64, '0')}`,
    ]);
    assert.match(
      result.warnings.join('\n'),
      /transitional top-level coverage/u,
    );
    assert.match(result.warnings.join('\n'), /transitional bundle_artifacts/u);

    const published = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000013-current-review-validation.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(published.status, 'passed');
    assert.equal(published.validation_mode, 'wave_target');
    assert.equal(published.target_id, 'current_repository');
    assert.equal(published.review_wave_id, '0000013-rw-wave-target');
    assert.equal(published.plan_host_root, repoRoot);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts accepts transitional OCR bundle aliases with a warning', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-legacy-bundles-'),
  );
  try {
    await writeFixture(repoRoot, { ocrBundleShape: 'legacy' });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.pointer_results[0]?.usable, true);
    assert.match(result.warnings.join('\n'), /transitional bundle_artifacts/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects a pointer from a different review wave', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-stale-wave-target-'),
  );
  try {
    await writeFixture(repoRoot, { waveScope: true });
    const pointerPath = path.join(
      repoRoot,
      'codeInfoTmp',
      'reviews',
      '0000013-current-review.json',
    );
    const pointer = JSON.parse(
      await fs.readFile(pointerPath, 'utf8'),
    ) as Record<string, unknown>;
    pointer.review_wave_id = '0000013-rw-older-wave';
    await fs.writeFile(pointerPath, JSON.stringify(pointer));

    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      storyId: '0000013',
      validationMode: 'wave_target',
      pointerKeys: ['current-review'],
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.pointer_results[0]?.status, 'stale');
    assert.equal(result.pointer_results[0]?.usable, false);
    assert.match(result.errors.join('\n'), /review_wave_id/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects conflicting OCR bundle representations', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-conflicting-bundles-'),
  );
  try {
    await writeFixture(repoRoot, { ocrBundleShape: 'conflicting' });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /bundle representations conflict/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects malformed transitional OCR bundle aliases', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-malformed-bundles-'),
  );
  try {
    await writeFixture(repoRoot, { ocrBundleShape: 'malformed' });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /no usable validated bundles/u);
    assert.match(result.warnings.join('\n'), /comments_path is missing/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts forwards cancellation to OCR and does not publish validation artifacts', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-abort-'),
  );
  try {
    await writeFixture(repoRoot);
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;

    await assert.rejects(
      validateReviewArtifactsRaw(
        {
          workingRepositoryPath: repoRoot,
          pointerKeys: ['current-open-code-review'],
          signal: controller.signal,
        },
        {
          runOcrCommand: async ({ signal }) => {
            observedSignal = signal;
            controller.abort();
            signal?.throwIfAborted();
          },
        },
      ),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError',
    );

    assert.equal(observedSignal, controller.signal);
    await assert.rejects(
      fs.access(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000013-current-review-validation.json',
        ),
      ),
      { code: 'ENOENT' },
    );
    await assert.rejects(
      fs.access(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          `${SESSION}-review-artifacts-validation.json`,
        ),
      ),
      { code: 'ENOENT' },
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts accepts an OCR range whose merge-base predates the prepared base', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-diverged-base-'),
  );
  try {
    await writeFixture(repoRoot, { divergedComparisonBase: true });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.pointer_results[0]?.usable, true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects an OCR manifest that differs from the server-generated diff', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-ocr-manifest-'),
  );
  try {
    await writeFixture(repoRoot);
    const manifestPath = path.join(
      repoRoot,
      'codeInfoTmp',
      'reviews',
      'ocr-manifest.json',
    );
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, 'utf8'),
    ) as Record<string, unknown>;
    manifest.manifest_id = `sha256:${'b'.repeat(64)}`;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /server-generated Git diff/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects altered OCR evidence that retains the canonical manifest id', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-ocr-evidence-'),
  );
  try {
    await writeFixture(repoRoot);
    const manifestPath = path.join(
      repoRoot,
      'codeInfoTmp',
      'reviews',
      'ocr-manifest.json',
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      manifest_id: string;
      bundles: Array<{ files: Array<{ patch: string }> }>;
    };
    const originalManifestId = manifest.manifest_id;

    manifest.bundles[0]!.files[0]!.patch =
      '@@ -1 +1 @@\n-original evidence\n+altered evidence\n';
    assert.equal(manifest.manifest_id, originalManifestId);
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /server-generated Git diff/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects a reviewable planning file even in an otherwise canonical manifest', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-ocr-planning-'),
  );
  try {
    await writeFixture(repoRoot);
    const reviewDir = path.join(repoRoot, 'codeInfoTmp', 'reviews');
    for (const name of ['ocr-manifest.json', 'ocr-canonical-manifest.json']) {
      const manifestPath = path.join(reviewDir, name);
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
        bundles: Array<{ files: Array<{ path: string }> }>;
      };
      manifest.bundles[0]!.files[0]!.path = 'planning/large-plan.md';
      await fs.writeFile(manifestPath, JSON.stringify(manifest));
    }
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /planning file/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects an agent validation that disagrees with fresh OCR validation', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-ocr-validation-'),
  );
  try {
    await writeFixture(repoRoot);
    const canonicalValidationPath = path.join(
      repoRoot,
      'codeInfoTmp',
      'reviews',
      'ocr-canonical-validation-0.json',
    );
    const validation = JSON.parse(
      await fs.readFile(canonicalValidationPath, 'utf8'),
    ) as Record<string, unknown>;
    validation.valid = false;
    validation.errors = [{ code: 'unknown_path', message: 'changed comments' }];
    await fs.writeFile(canonicalValidationPath, JSON.stringify(validation));
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /no usable validated bundles/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects a report that is not the deterministic bundle report', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-ocr-report-'),
  );
  try {
    await writeFixture(repoRoot);
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoTmp', 'reviews', 'ocr-report-0.md'),
      '# Report from another bundle\n',
    );
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /no usable validated bundles/u);
    assert.match(result.warnings.join('\n'), /server-rendered bundle report/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects an OCR range prepared from another base', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-wrong-from-'),
  );
  try {
    await writeFixture(repoRoot, { ocrTargetFrom: 'a'.repeat(40) });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.pointer_results[0]?.status, 'stale');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects OCR coverage that disagrees with the manifest', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-coverage-'),
  );
  try {
    await writeFixture(repoRoot, { pointerTotalFiles: 99 });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /coverage does not match/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts accepts transitional top-level OCR coverage with a warning', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-top-level-coverage-'),
  );
  try {
    await writeFixture(repoRoot, { ocrCoverageShape: 'top-level' });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.pointer_results[0]?.usable, true);
    assert.equal(result.pointer_results[0]?.usable_bundle_ids.length, 1);
    assert.match(
      result.warnings.join('\n'),
      /transitional top-level coverage/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects missing OCR coverage in both supported shapes', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-missing-coverage-'),
  );
  try {
    await writeFixture(repoRoot, { ocrCoverageShape: 'missing' });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /coverage is missing/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects conflicting nested and top-level OCR coverage', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-conflicting-coverage-'),
  );
  try {
    await writeFixture(repoRoot, { ocrCoverageShape: 'conflicting' });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /coverage is ambiguous/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects a bundle that did not review every reviewable file', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-files-reviewed-'),
  );
  try {
    await writeFixture(repoRoot, { commentsReviewedFiles: 0 });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /validated bundles/u);
    assert.match(result.warnings.join('\n'), /reviewed-file coverage/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts accepts complete multi-repository main review scope', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-main-repo-'),
  );
  const additionalRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-additional-repo-'),
  );
  try {
    await initializeAdditionalRepository(additionalRoot);
    await writeFixture(repoRoot, { additionalRepositoryPath: additionalRoot });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
    });
    assert.equal(result.status, 'passed');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(additionalRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts accepts a remote base for an additional repository', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-main-repo-'),
  );
  const additionalRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-additional-repo-'),
  );
  try {
    const { base } = await initializeAdditionalRepository(additionalRoot);
    await execFile('git', ['update-ref', 'refs/remotes/origin/main', base], {
      cwd: additionalRoot,
    });
    await writeFixture(repoRoot, {
      additionalRepositoryPath: additionalRoot,
      additionalComparisonBaseRef: 'origin/main',
      additionalResolvedBaseSource: 'remote',
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
    });
    assert.equal(result.status, 'passed');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(additionalRoot, { recursive: true, force: true });
  }
});

for (const comparisonBaseRef of [
  `origin/${BRANCH}`,
  `refs/remotes/origin/${BRANCH}`,
]) {
  test(`validateReviewArtifacts rejects reviewed-branch remote base ${comparisonBaseRef}`, async () => {
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'review-artifacts-main-repo-'),
    );
    const additionalRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'review-artifacts-additional-repo-'),
    );
    try {
      const { head } = await initializeAdditionalRepository(additionalRoot);
      await execFile(
        'git',
        ['update-ref', `refs/remotes/origin/${BRANCH}`, head],
        { cwd: additionalRoot },
      );
      await writeFixture(repoRoot, {
        additionalRepositoryPath: additionalRoot,
        additionalBaseMode: 'head',
        additionalComparisonBaseRef: comparisonBaseRef,
        additionalResolvedBaseBranch: BRANCH,
        additionalResolvedBaseSource: 'remote',
      });
      const result = await validateReviewArtifacts({
        workingRepositoryPath: repoRoot,
        pointerKeys: ['current-review'],
      });
      assert.equal(result.status, 'blocked');
      assert.match(result.errors.join('\n'), /points at the reviewed branch/u);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(additionalRoot, { recursive: true, force: true });
    }
  });
}

test('validateReviewArtifacts rejects an additional repository whose base is its reviewed HEAD', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-main-repo-'),
  );
  const additionalRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-additional-repo-'),
  );
  try {
    await initializeAdditionalRepository(additionalRoot);
    await writeFixture(repoRoot, {
      additionalRepositoryPath: additionalRoot,
      additionalBaseMode: 'head',
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /comparison_base_commit/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(additionalRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts keeps sibling reviews usable when additional scope is malformed', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-main-repo-'),
  );
  try {
    await writeFixture(repoRoot, {
      additionalRepositoriesValue: { path: '/missing/repository' },
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review', 'current-codex-review'],
    });
    assert.equal(result.status, 'partial');
    assert.equal(
      result.pointer_results.find(
        (entry) => entry.pointer_key === 'current-codex-review',
      )?.usable,
      true,
    );
    assert.match(result.errors.join('\n'), /must be an array/u);
    assert.ok(result.fallback_findings_file);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts maps an additional repository host path before validation', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-main-repo-'),
  );
  const pathRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-path-map-'),
  );
  const hostRoot = path.join(pathRoot, 'host');
  const executionRoot = path.join(pathRoot, 'execution');
  const hostAdditionalRoot = path.join(hostRoot, 'additional');
  const mappedAdditionalRoot = path.join(executionRoot, 'additional');
  const previousHostIngest = process.env.CODEINFO_HOST_INGEST_DIR;
  const previousWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
  try {
    await fs.mkdir(hostRoot, { recursive: true });
    await fs.mkdir(executionRoot, { recursive: true });
    await initializeAdditionalRepository(mappedAdditionalRoot);
    await writeFixture(repoRoot, {
      additionalRepositoryPath: mappedAdditionalRoot,
    });
    await fs.writeFile(
      path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: PLAN_PATH,
        additional_repositories: [{ path: hostAdditionalRoot }],
      }),
    );
    process.env.CODEINFO_HOST_INGEST_DIR = hostRoot;
    process.env.CODEINFO_CODEX_WORKDIR = executionRoot;
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
    });
    assert.equal(result.status, 'passed');
  } finally {
    if (previousHostIngest === undefined) {
      delete process.env.CODEINFO_HOST_INGEST_DIR;
    } else {
      process.env.CODEINFO_HOST_INGEST_DIR = previousHostIngest;
    }
    if (previousWorkdir === undefined) {
      delete process.env.CODEINFO_CODEX_WORKDIR;
    } else {
      process.env.CODEINFO_CODEX_WORKDIR = previousWorkdir;
    }
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(pathRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects a main review missing a declared repository', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-main-repo-'),
  );
  const additionalRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-additional-repo-'),
  );
  try {
    await initializeAdditionalRepository(additionalRoot);
    await writeFixture(repoRoot, {
      additionalRepositoryPath: additionalRoot,
      omitAdditionalMainRepo: true,
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /repositories declared/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(additionalRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts rejects a main review after an additional repository advances', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-main-repo-'),
  );
  const additionalRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-additional-repo-'),
  );
  try {
    await initializeAdditionalRepository(additionalRoot);
    await writeFixture(repoRoot, { additionalRepositoryPath: additionalRoot });
    await fs.writeFile(
      path.join(additionalRoot, 'later.ts'),
      'export const later = true;\n',
    );
    await execFile('git', ['add', 'later.ts'], { cwd: additionalRoot });
    await execFile('git', ['commit', '-qm', 'advance additional'], {
      cwd: additionalRoot,
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.errors.join('\n'), /head_commit does not match/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(additionalRoot, { recursive: true, force: true });
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
      ocrInlineFindings: [
        {
          bundle_id: `sha256:${'1'.padStart(64, '0')}`,
          title: 'Usable bundle finding',
          path: 'changed-0.ts',
          severity: 'P1',
        },
        {
          bundle_id: `sha256:${'2'.padStart(64, '0')}`,
          title: 'Rejected bundle finding',
          path: 'changed-1.ts',
          severity: 'P1',
        },
      ],
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-open-code-review'],
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.pointer_results[0]?.status, 'partial');
    assert.equal(result.pointer_results[0]?.usable, true);
    assert.equal(result.pointer_results[0]?.usable_bundle_ids.length, 1);
    assert.deepEqual(result.pointer_results[0]?.validated_findings, [
      {
        bundle_id: `sha256:${'1'.padStart(64, '0')}`,
        title: 'Usable bundle finding',
        path: 'changed-0.ts',
        severity: 'P1',
      },
    ]);
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
  const additionalRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-additional-repo-'),
  );
  try {
    await initializeAdditionalRepository(additionalRoot);
    await writeFixture(repoRoot, {
      mainStatus: 'failed',
      additionalRepositoryPath: additionalRoot,
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review', 'current-codex-review'],
    });
    assert.equal(result.status, 'partial');
    assert.ok(result.fallback_findings_file);
    const canonicalPointer = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000013-current-review.json',
        ),
        'utf8',
      ),
    ) as {
      status?: string;
      main_review_status?: string;
      declared_repository_scope?: string[];
      unreviewed_repositories?: string[];
    };
    assert.equal(canonicalPointer.status, 'failed');
    assert.equal(canonicalPointer.main_review_status, undefined);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(additionalRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts validates fast reviewers and creates their canonical merge target', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot);
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-codex-review', 'current-open-code-review'],
      ensureCanonicalFallback: true,
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.pointer_results.length, 2);
    assert.equal(
      result.pointer_results.every((entry) => entry.usable),
      true,
    );
    assert.ok(result.fallback_findings_file);
    const canonicalPointer = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000013-current-review.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(canonicalPointer.status, 'completed');
    assert.equal(canonicalPointer.repo_alias, 'current_repository');
    assert.equal(canonicalPointer.repo_root, await fs.realpath(repoRoot));
    assert.equal(canonicalPointer.review_pass_id, PASS);
    assert.equal(canonicalPointer.comparison_head_ref, 'HEAD');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts creates a canonical fallback when no fast reviewer is usable', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot, {
      codexSession: 'stale-session',
      ocrBranch: 'feature/0000013-other-scope',
    });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-codex-review', 'current-open-code-review'],
      ensureCanonicalFallback: true,
    });

    assert.equal(result.status, 'blocked');
    assert.equal(
      result.pointer_results.every((entry) => !entry.usable),
      true,
    );
    assert.ok(result.fallback_findings_file);
    const fallbackText = await fs.readFile(
      path.join(repoRoot, result.fallback_findings_file as string),
      'utf8',
    );
    assert.match(fallbackText, /Main review was not requested/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts accepts a valid slow review without replacing it', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot);
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
      ensureCanonicalFallback: true,
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.fallback_findings_file, undefined);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts creates a canonical fallback for an unusable slow review', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot, { mainStatus: 'failed' });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
      ensureCanonicalFallback: true,
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.fallback_findings_file);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts server-finalizes a findings-ready slow review', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-finalize-slow-'),
  );
  try {
    await writeFixture(repoRoot, { mainStatus: 'findings' });
    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-review'],
      finalizeCurrentReview: true,
    });

    assert.equal(result.status, 'passed');
    const pointer = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000013-current-review.json',
        ),
        'utf8',
      ),
    ) as { status?: string; completed_at?: string };
    assert.equal(pointer.status, 'completed');
    assert.equal(typeof pointer.completed_at, 'string');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts does not overwrite canonical state from a stale prepared session', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await writeFixture(repoRoot);
    const canonicalPath = path.join(
      repoRoot,
      'codeInfoTmp',
      'reviews',
      '0000013-current-review.json',
    );
    const before = await fs.readFile(canonicalPath, 'utf8');
    await fs.writeFile(path.join(repoRoot, 'changed.txt'), 'changed\n');
    await execFile('git', ['add', 'changed.txt'], { cwd: repoRoot });
    await execFile('git', ['commit', '-qm', 'advance head'], { cwd: repoRoot });

    const result = await validateReviewArtifacts({
      workingRepositoryPath: repoRoot,
      pointerKeys: ['current-codex-review'],
      ensureCanonicalFallback: true,
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.fallback_findings_file, undefined);
    assert.equal(await fs.readFile(canonicalPath, 'utf8'), before);
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
