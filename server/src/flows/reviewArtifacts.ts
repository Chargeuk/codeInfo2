import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  readPreparedReviewBase,
  resolveReviewRepositoryRoot,
  type PreparedReviewBase,
} from './reviewBase.js';
import {
  assertReviewIdentityMatches,
  atomicWriteJson,
  buildReviewArtifactPath,
  deriveCanonicalStoryId,
  readReviewIdentity,
  resolveContainedReviewArtifactPath,
  type ReviewIdentity,
} from './reviewIdentity.js';

type ReviewPointer = Record<string, unknown>;

export type ReviewArtifactsValidationResult = {
  schema_version: 1;
  story_id: string;
  plan_path: string;
  review_session_id: string;
  review_pass_id: string;
  head_commit: string;
  comparison_base_commit: string;
  parent_execution_id: string;
  pointer_files: string[];
  validated_artifact_files: string[];
  status: 'passed' | 'blocked';
  errors: string[];
  completed_at: string;
};

const readJsonObject = async (filePath: string): Promise<ReviewPointer> => {
  const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${filePath} did not contain a JSON object.`);
  }
  return parsed as ReviewPointer;
};

const toPosixRelative = (repoRoot: string, absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join('/');

const assertRealPathContained = async (
  repoRoot: string,
  artifactPath: string,
): Promise<void> => {
  const [reviewRoot, resolvedArtifact] = await Promise.all([
    fs.realpath(path.join(repoRoot, 'codeInfoTmp', 'reviews')),
    fs.realpath(artifactPath),
  ]);
  const relative = path.relative(reviewRoot, resolvedArtifact);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${artifactPath} resolves outside codeInfoTmp/reviews.`);
  }
};

const referencedArtifactFields = (pointerKey: string): string[] => {
  if (pointerKey === 'current-review') {
    return ['evidence_file', 'findings_file'];
  }
  if (pointerKey === 'current-codex-review') {
    return ['review_output_file'];
  }
  if (pointerKey === 'current-open-code-review') {
    return ['review_output_file'];
  }
  return ['review_output_file'];
};

const pointerIdentity = (
  pointer: ReviewPointer,
  pointerKey: string,
): ReviewIdentity =>
  readReviewIdentity(pointer, {
    canonicalPassField: pointerKey !== 'current-review',
  });

const REVIEW_SCOPE_FIELDS = [
  'repo_alias',
  'repo_root',
  'branch',
  'branched_from',
  'logical_base_branch',
  'resolved_base_branch',
  'resolved_base_source',
  'remote_name',
  'remote_fetch_status',
  'remote_fetch_error',
  'remote_fetch_exit_code',
  'local_fallback_reason',
  'comparison_base_ref',
  'comparison_head_ref',
  'comparison_rule',
  'review_context_file',
  'review_context_sha256',
  'review_context_source_plan_sha256',
  'review_excluded_paths',
] as const satisfies readonly (keyof PreparedReviewBase)[];

const valuesEqual = (expected: unknown, actual: unknown): boolean =>
  Array.isArray(expected) && Array.isArray(actual)
    ? expected.length === actual.length &&
      expected.every((value, index) => value === actual[index])
    : expected === actual;

const assertReviewScopeMatches = (
  expected: PreparedReviewBase,
  pointer: ReviewPointer,
  pointerKey: string,
): void => {
  for (const field of REVIEW_SCOPE_FIELDS) {
    if (!valuesEqual(expected[field], pointer[field])) {
      throw new Error(
        `${pointerKey}.${field} does not match the prepared review scope.`,
      );
    }
  }
};

export async function validateReviewArtifacts(params: {
  workingRepositoryPath: string;
  pointerKeys: string[];
  signal?: AbortSignal;
}): Promise<ReviewArtifactsValidationResult> {
  params.signal?.throwIfAborted();
  const repoRoot = await resolveReviewRepositoryRoot(
    params.workingRepositoryPath,
    undefined,
    params.signal,
  );
  const currentPlanPath = path.join(
    repoRoot,
    'codeInfoStatus',
    'flow-state',
    'current-plan.json',
  );
  const currentPlan = await readJsonObject(currentPlanPath);
  const planPath =
    typeof currentPlan.plan_path === 'string' ? currentPlan.plan_path : '';
  const storyId = deriveCanonicalStoryId(planPath);
  const prepared = await readPreparedReviewBase({
    workingRepositoryPath: repoRoot,
    storyNumber: storyId,
    outputKey: 'current-review-base',
  });
  if (!prepared) {
    throw new Error('Prepared review session is missing.');
  }
  const expected = readReviewIdentity(prepared.artifact);
  const errors: string[] = [];
  const pointerFiles: string[] = [];
  const validatedArtifactFiles: string[] = [];

  for (const pointerKey of params.pointerKeys) {
    const pointerPath = buildReviewArtifactPath({
      repoRoot,
      storyId,
      outputKey: pointerKey,
    });
    pointerFiles.push(toPosixRelative(repoRoot, pointerPath));
    try {
      const pointer = await readJsonObject(pointerPath);
      assertReviewIdentityMatches(
        expected,
        pointerIdentity(pointer, pointerKey),
        pointerKey,
      );
      assertReviewScopeMatches(prepared.artifact, pointer, pointerKey);
      const status = pointer.status;
      if (
        status === 'pending' ||
        status === 'preparing' ||
        status === 'failed'
      ) {
        throw new Error(
          `${pointerKey} has non-complete status ${String(status)}.`,
        );
      }
      if (pointerKey === 'current-open-code-review') {
        if (
          pointer.schema_version !== 'codeinfo-open-code-review/v1' ||
          pointer.status !== 'completed' ||
          pointer.overall_validation_status !== 'valid' ||
          pointer.partial !== false
        ) {
          throw new Error(
            'current-open-code-review is not a complete, valid, non-partial OCR result.',
          );
        }
      }
      for (const field of referencedArtifactFields(pointerKey)) {
        const relativePath = pointer[field];
        if (typeof relativePath !== 'string' || relativePath.trim() === '') {
          throw new Error(`${pointerKey}.${field} is missing.`);
        }
        const artifactPath = resolveContainedReviewArtifactPath({
          repoRoot,
          relativePath,
        });
        await fs.access(artifactPath, fsConstants.R_OK);
        await assertRealPathContained(repoRoot, artifactPath);
        validatedArtifactFiles.push(toPosixRelative(repoRoot, artifactPath));
      }
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : `${pointerKey} validation failed unexpectedly.`,
      );
    }
  }

  const result: ReviewArtifactsValidationResult = {
    schema_version: 1,
    ...expected,
    pointer_files: pointerFiles,
    validated_artifact_files: validatedArtifactFiles,
    status: errors.length === 0 ? 'passed' : 'blocked',
    errors,
    completed_at: new Date().toISOString(),
  };
  const stablePath = buildReviewArtifactPath({
    repoRoot,
    storyId,
    outputKey: 'current-review-validation',
  });
  const versionedPath = path.join(
    repoRoot,
    'codeInfoTmp',
    'reviews',
    `${expected.review_session_id}-review-artifacts-validation.json`,
  );
  await Promise.all([
    atomicWriteJson(stablePath, result),
    atomicWriteJson(versionedPath, result),
  ]);
  if (errors.length > 0) {
    throw new Error(
      `Review artifact validation blocked: ${errors.join(' | ')}`,
    );
  }
  return result;
}
