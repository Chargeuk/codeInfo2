import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { validateReviewArtifacts } from '../../flows/reviewArtifacts.js';

const execFile = promisify(execFileCb);
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const identity = {
  story_id: '0000013',
  plan_path: 'planning/0000013-example.md',
  review_session_id: '0000013-rs-20260713T102726Z-aaaaaaaa-c0ffee12',
  review_pass_id: '0000013-20260713T102726Z-aaaaaaaa-c0ffee12',
  head_commit: HEAD,
  comparison_base_commit: BASE,
  parent_execution_id: 'execution-13',
};
const scope = {
  repo_alias: 'current_repository',
  repo_root: '',
  branch: 'feature/0000013-example',
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
  review_context_sha256: 'c'.repeat(64),
  review_context_source_plan_sha256: 'd'.repeat(64),
  review_excluded_paths: ['planning/**'],
};

const writeFixture = async (
  repoRoot: string,
  codexSession = identity.review_session_id,
  ocrPartial = false,
) => {
  const reviewDir = path.join(repoRoot, 'codeInfoTmp', 'reviews');
  await fs.mkdir(path.join(repoRoot, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    JSON.stringify({ plan_path: identity.plan_path }),
  );
  await fs.writeFile(
    path.join(reviewDir, '0000013-current-review-base.json'),
    JSON.stringify({
      ...identity,
      ...scope,
      repo_root: repoRoot,
      status: 'completed',
    }),
  );
  await fs.writeFile(path.join(reviewDir, 'evidence.md'), '# Evidence\n');
  await fs.writeFile(path.join(reviewDir, 'findings.md'), '# Findings\n');
  await fs.writeFile(path.join(reviewDir, 'codex.md'), '# Codex\n');
  await fs.writeFile(path.join(reviewDir, 'ocr.md'), '# OCR\n');
  await fs.writeFile(
    path.join(reviewDir, '0000013-current-review.json'),
    JSON.stringify({
      ...identity,
      ...scope,
      repo_root: repoRoot,
      evidence_file: 'codeInfoTmp/reviews/evidence.md',
      findings_file: 'codeInfoTmp/reviews/findings.md',
      status: 'completed',
    }),
  );
  await fs.writeFile(
    path.join(reviewDir, '0000013-current-codex-review.json'),
    JSON.stringify({
      ...identity,
      ...scope,
      repo_root: repoRoot,
      review_session_id: codexSession,
      canonical_review_pass_id: identity.review_pass_id,
      review_output_file: 'codeInfoTmp/reviews/codex.md',
      status: 'completed',
    }),
  );
  await fs.writeFile(
    path.join(reviewDir, '0000013-current-open-code-review.json'),
    JSON.stringify({
      ...identity,
      ...scope,
      repo_root: repoRoot,
      schema_version: 'codeinfo-open-code-review/v1',
      canonical_review_pass_id: identity.review_pass_id,
      review_output_file: 'codeInfoTmp/reviews/ocr.md',
      overall_validation_status: 'valid',
      partial: ocrPartial,
      status: 'completed',
    }),
  );
};

test('validateReviewArtifacts accepts one coherent server-owned review session', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await execFile('git', ['init', '-q', repoRoot]);
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
    assert.equal(result.story_id, '0000013');
    assert.equal(result.validated_artifact_files.length, 4);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts blocks a stale child session before merge', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await execFile('git', ['init', '-q', repoRoot]);
    await writeFixture(
      repoRoot,
      '0000013-rs-20260703T175948Z-cccccccc-stale123',
    );
    await assert.rejects(
      validateReviewArtifacts({
        workingRepositoryPath: repoRoot,
        pointerKeys: ['current-review', 'current-codex-review'],
      }),
      /review_session_id/u,
    );
    const blocker = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000013-current-review-validation.json',
        ),
        'utf8',
      ),
    ) as { status: string; errors: string[] };
    assert.equal(blocker.status, 'blocked');
    assert.match(blocker.errors.join('\n'), /review_session_id/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts requires OCR coverage to be valid and non-partial', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await execFile('git', ['init', '-q', repoRoot]);
    await writeFixture(repoRoot, identity.review_session_id, true);
    await assert.rejects(
      validateReviewArtifacts({
        workingRepositoryPath: repoRoot,
        pointerKeys: [
          'current-review',
          'current-codex-review',
          'current-open-code-review',
        ],
      }),
      /non-partial OCR result/u,
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts blocks a pointer with mismatched prepared scope', async () => {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'review-artifacts-'),
  );
  try {
    await execFile('git', ['init', '-q', repoRoot]);
    await writeFixture(repoRoot);
    const pointerPath = path.join(
      repoRoot,
      'codeInfoTmp',
      'reviews',
      '0000013-current-open-code-review.json',
    );
    const pointer = JSON.parse(await fs.readFile(pointerPath, 'utf8')) as {
      branch: string;
      review_context_sha256: string;
    };
    pointer.branch = 'feature/0000013-other-scope';
    pointer.review_context_sha256 = 'e'.repeat(64);
    await fs.writeFile(pointerPath, JSON.stringify(pointer));

    await assert.rejects(
      validateReviewArtifacts({
        workingRepositoryPath: repoRoot,
        pointerKeys: ['current-open-code-review'],
      }),
      /prepared review scope/u,
    );
    const blocker = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          'codeInfoTmp',
          'reviews',
          '0000013-current-review-validation.json',
        ),
        'utf8',
      ),
    ) as { status: string; errors: string[] };
    assert.equal(blocker.status, 'blocked');
    assert.match(blocker.errors.join('\n'), /\.branch/u);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
