import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeFlowInput } from './flowInput.js';
import { atomicWriteJson, buildReviewArtifactPath } from './reviewIdentity.js';
import type { ReviewSetManifest } from './reviewSet.js';
import type { ReviewTargetSnapshot } from './reviewTargets.js';
import type { FlowJsonValue } from './types.js';

export const CROSS_REPOSITORY_REVIEW_SCHEMA_VERSION =
  'codeinfo-cross-repository-review/v1';

type CrossRepositoryReviewDeps = {
  mkdir: typeof fs.mkdir;
  rename: typeof fs.rename;
  writeFile: typeof fs.writeFile;
  now: () => Date;
};

const defaultDeps: CrossRepositoryReviewDeps = {
  mkdir: fs.mkdir,
  rename: fs.rename,
  writeFile: fs.writeFile,
  now: () => new Date(),
};

const asObject = <T>(value: FlowJsonValue, label: string): T => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as T;
};

export async function gateCrossRepositoryReview(
  params: {
    targetSnapshot: FlowJsonValue;
    reviewSet: FlowJsonValue;
    outputKey: string;
    signal?: AbortSignal;
  },
  deps: Partial<CrossRepositoryReviewDeps> = {},
): Promise<{
  action: 'not_applicable' | 'review_required';
  targetSnapshot: ReviewTargetSnapshot;
  reviewSet: ReviewSetManifest;
  pointerPath?: string;
  versionedPath?: string;
}> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  params.signal?.throwIfAborted();
  const targetSnapshot = asObject<ReviewTargetSnapshot>(
    params.targetSnapshot,
    'Cross-repository target snapshot',
  );
  const reviewSet = asObject<ReviewSetManifest>(
    params.reviewSet,
    'Cross-repository review set',
  );
  if (targetSnapshot.schema_version !== 'codeinfo-review-targets/v1') {
    throw new Error('Cross-repository target snapshot schema is invalid.');
  }
  if (reviewSet.schema_version !== 'codeinfo-review-set/v1') {
    throw new Error('Cross-repository review-set schema is invalid.');
  }
  if (
    reviewSet.story_id !== targetSnapshot.story_id ||
    reviewSet.review_wave_id !== targetSnapshot.review_wave_id ||
    reviewSet.targets_sha256 !== targetSnapshot.targets_sha256 ||
    reviewSet.target_count !== targetSnapshot.targets.length
  ) {
    throw new Error(
      'Cross-repository review-set identity does not match the target snapshot.',
    );
  }
  const snapshotIds = new Set(
    targetSnapshot.targets.map((target) => target.target_id),
  );
  if (
    snapshotIds.size !== targetSnapshot.targets.length ||
    reviewSet.targets.some((target) => !snapshotIds.has(target.target_id))
  ) {
    throw new Error(
      'Cross-repository review-set target coverage is mismatched.',
    );
  }
  if (targetSnapshot.targets.length > 1) {
    return { action: 'review_required', targetSnapshot, reviewSet };
  }

  const completedAt = resolvedDeps.now().toISOString();
  const result = normalizeFlowInput({
    schema_version: CROSS_REPOSITORY_REVIEW_SCHEMA_VERSION,
    story_id: targetSnapshot.story_id,
    review_wave_id: targetSnapshot.review_wave_id,
    parent_execution_id: targetSnapshot.parent_execution_id,
    targets_sha256: targetSnapshot.targets_sha256,
    target_count: 1,
    status: 'not_applicable',
    findings: [],
    rejected_risks: [],
    residual_uncertainty: [],
    reason: 'Cross-repository review requires at least two repository targets.',
    completed_at: completedAt,
  });
  const pointerPath = buildReviewArtifactPath({
    repoRoot: targetSnapshot.plan_host_root,
    storyId: targetSnapshot.story_id,
    outputKey: params.outputKey,
  });
  const versionedPath = path.join(
    targetSnapshot.plan_host_root,
    'codeInfoTmp',
    'reviews',
    `${targetSnapshot.review_wave_id}-cross-repository-review.json`,
  );
  const atomicDeps = {
    mkdir: resolvedDeps.mkdir,
    rename: resolvedDeps.rename,
    writeFile: resolvedDeps.writeFile,
  };
  await atomicWriteJson(versionedPath, result, atomicDeps);
  await atomicWriteJson(pointerPath, result, atomicDeps);
  return {
    action: 'not_applicable',
    targetSnapshot,
    reviewSet,
    pointerPath,
    versionedPath,
  };
}
