import fs from 'node:fs/promises';
import path from 'node:path';

import {
  prepareReviewBase,
  type PrepareReviewBaseResult,
} from './reviewBase.js';
import {
  prepareReviewContext,
  resolvePreparedReviewContextPath,
  type PreparedReviewContext,
} from './reviewContext.js';
import { atomicWriteJson, buildReviewArtifactPath } from './reviewIdentity.js';
import type { ReviewTarget, ReviewTargetSnapshot } from './reviewTargets.js';
import type { FlowJsonValue } from './types.js';

export const REVIEW_SET_SCHEMA_VERSION = 'codeinfo-review-set/v1';

export type ReviewSetTarget = {
  target_id: string;
  repo_alias: string;
  repo_root: string;
  branch: string;
  head_commit: string;
  status: 'prepared' | 'invalid';
  base_pointer: string | null;
  review_pointers: Record<string, string>;
  error: string | null;
};

export type ReviewSetManifest = {
  schema_version: typeof REVIEW_SET_SCHEMA_VERSION;
  story_id: string;
  review_wave_id: string;
  parent_execution_id: string;
  targets_sha256: string;
  plan_host_root: string;
  target_count: number;
  expected_job_count: number;
  expected_jobs: Array<{
    instance_id: string;
    flow_name: string;
    target_id: string | null;
    kind: 'target_review' | 'cross_repository_review';
  }>;
  targets: ReviewSetTarget[];
  coverage: {
    prepared_targets: number;
    invalid_targets: number;
    completed_jobs: number;
    failed_jobs: number;
    missing_jobs: number;
  };
  status:
    | 'prepared'
    | 'completed_with_invalid_targets'
    | 'completed'
    | 'completed_partial'
    | 'invalid';
  job_results?: ReviewWaveJobResult[];
  cross_repository_status?: string;
  aggregated_findings?: AggregatedReviewFinding[];
  closeout_allowed?: boolean;
  created_at: string;
};

export type ReviewWaveJobResult = {
  instance_id: string;
  flow_name: string;
  target_id: string | null;
  status: 'completed' | 'partial' | 'failed' | 'missing' | 'stale' | 'invalid';
  pointer_path: string | null;
  error: string | null;
};

export type AggregatedReviewFinding = {
  fingerprint: string;
  target_ids: string[];
  title: string;
  path: string | null;
  line: number | null;
  severities: string[];
  severity_conflict: boolean;
  sources: Array<{ instance_id: string; severity: string }>;
  detail: FlowJsonValue;
};

type ReviewSetDeps = {
  readFile: typeof fs.readFile;
  writeFile: typeof fs.writeFile;
  rename: typeof fs.rename;
  mkdir: typeof fs.mkdir;
  prepareReviewContext: typeof prepareReviewContext;
  prepareReviewBase: typeof prepareReviewBase;
  now: () => Date;
};

const defaultDeps: ReviewSetDeps = {
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  rename: fs.rename,
  mkdir: fs.mkdir,
  prepareReviewContext,
  prepareReviewBase,
  now: () => new Date(),
};

const relativeReviewPath = (repoRoot: string, filename: string) =>
  path.posix.join('codeInfoTmp', 'reviews', filename);

const materializeTargetContext = async (params: {
  target: ReviewTarget;
  snapshot: ReviewTargetSnapshot;
  canonicalContext: PreparedReviewContext;
  deps: ReviewSetDeps;
}) => {
  const artifactPath = resolvePreparedReviewContextPath(
    params.target.repo_root,
    params.snapshot.story_id,
  );
  const artifact: PreparedReviewContext = {
    ...params.canonicalContext,
    branch: params.target.branch,
  };
  await atomicWriteJson(artifactPath, artifact, {
    mkdir: params.deps.mkdir,
    rename: params.deps.rename,
    writeFile: params.deps.writeFile,
  });
  return { artifactPath, artifact };
};

const prepareOneTarget = async (params: {
  target: ReviewTarget;
  snapshot: ReviewTargetSnapshot;
  canonicalContext: PreparedReviewContext;
  signal?: AbortSignal;
  deps: ReviewSetDeps;
}): Promise<ReviewSetTarget> => {
  try {
    params.signal?.throwIfAborted();
    const reviewContext = await materializeTargetContext(params);
    const base: PrepareReviewBaseResult = await params.deps.prepareReviewBase({
      workingRepositoryPath: params.target.repo_root,
      outputKey: 'current-review-base',
      parentExecutionId: params.snapshot.parent_execution_id,
      initializeReviewPointers: true,
      explicitScope: {
        planHostRoot: params.snapshot.plan_host_root,
        planPath: params.snapshot.plan_path,
        storyNumber: params.snapshot.story_id,
        branchedFrom: params.snapshot.branched_from,
        reviewWaveId: params.snapshot.review_wave_id,
        target: {
          targetId: params.target.target_id,
          repoAlias: params.target.repo_alias,
          repoRoot: params.target.repo_root,
          branch: params.target.branch,
          headCommit: params.target.head_commit,
        },
        reviewContext,
      },
      signal: params.signal,
    });
    const prefix = `${params.snapshot.story_id}-`;
    return {
      target_id: params.target.target_id,
      repo_alias: params.target.repo_alias,
      repo_root: params.target.repo_root,
      branch: params.target.branch,
      head_commit: params.target.head_commit,
      status: 'prepared',
      base_pointer: relativeReviewPath(
        params.target.repo_root,
        path.basename(base.artifactPath),
      ),
      review_pointers: {
        artifact: relativeReviewPath(
          params.target.repo_root,
          `${prefix}current-review.json`,
        ),
        codex: relativeReviewPath(
          params.target.repo_root,
          `${prefix}current-codex-review.json`,
        ),
        open_code: relativeReviewPath(
          params.target.repo_root,
          `${prefix}current-open-code-review.json`,
        ),
      },
      error: null,
    };
  } catch (error) {
    if (
      params.signal?.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      throw error;
    }
    return {
      target_id: params.target.target_id,
      repo_alias: params.target.repo_alias,
      repo_root: params.target.repo_root,
      branch: params.target.branch,
      head_commit: params.target.head_commit,
      status: 'invalid',
      base_pointer: null,
      review_pointers: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const targetSnapshotIsCurrent = async (
  snapshot: ReviewTargetSnapshot,
  deps: ReviewSetDeps,
) => {
  const stablePath = buildReviewArtifactPath({
    repoRoot: snapshot.plan_host_root,
    storyId: snapshot.story_id,
    outputKey: 'current-review-targets',
  });
  try {
    const current = JSON.parse(
      await deps.readFile(stablePath, 'utf8'),
    ) as Partial<ReviewTargetSnapshot>;
    return (
      current.review_wave_id === snapshot.review_wave_id &&
      current.targets_sha256 === snapshot.targets_sha256
    );
  } catch {
    return false;
  }
};

export async function prepareReviewSet(
  params: {
    snapshot: ReviewTargetSnapshot;
    reviewFlowNames: string[];
    crossRepositoryFlowName: string;
    signal?: AbortSignal;
  },
  deps: Partial<ReviewSetDeps> = {},
): Promise<{
  manifest: ReviewSetManifest;
  stablePath: string;
  versionedPath: string;
  stableUpdated: boolean;
}> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const primary = params.snapshot.targets.find((target) => target.is_primary);
  if (!primary)
    throw new Error('Review target snapshot lacks a primary target.');
  if (new Set(params.reviewFlowNames).size !== params.reviewFlowNames.length) {
    throw new Error('Review flow names must be distinct.');
  }
  const canonicalContext = await resolvedDeps.prepareReviewContext({
    repoRoot: params.snapshot.plan_host_root,
    storyNumber: params.snapshot.story_id,
    planPath: params.snapshot.plan_path,
    branch: primary.branch,
    signal: params.signal,
  });
  const targets = await Promise.all(
    params.snapshot.targets.map((target) =>
      prepareOneTarget({
        target,
        snapshot: params.snapshot,
        canonicalContext: canonicalContext.artifact,
        signal: params.signal,
        deps: resolvedDeps,
      }),
    ),
  );
  const expectedJobs = [
    ...params.snapshot.targets.flatMap((target) =>
      params.reviewFlowNames.map((flowName) => ({
        instance_id: `${target.target_id}--${flowName}`,
        flow_name: flowName,
        target_id: target.target_id,
        kind: 'target_review' as const,
      })),
    ),
    {
      instance_id: `story--${params.crossRepositoryFlowName}`,
      flow_name: params.crossRepositoryFlowName,
      target_id: null,
      kind: 'cross_repository_review' as const,
    },
  ];
  const invalidTargets = targets.filter(
    (target) => target.status === 'invalid',
  ).length;
  const manifest: ReviewSetManifest = {
    schema_version: REVIEW_SET_SCHEMA_VERSION,
    story_id: params.snapshot.story_id,
    review_wave_id: params.snapshot.review_wave_id,
    parent_execution_id: params.snapshot.parent_execution_id,
    targets_sha256: params.snapshot.targets_sha256,
    plan_host_root: params.snapshot.plan_host_root,
    target_count: targets.length,
    expected_job_count: expectedJobs.length,
    expected_jobs: expectedJobs,
    targets,
    coverage: {
      prepared_targets: targets.length - invalidTargets,
      invalid_targets: invalidTargets,
      completed_jobs: 0,
      failed_jobs: 0,
      missing_jobs: expectedJobs.length,
    },
    status: invalidTargets ? 'completed_with_invalid_targets' : 'prepared',
    created_at: resolvedDeps.now().toISOString(),
  };
  const reviewRoot = path.join(
    params.snapshot.plan_host_root,
    'codeInfoTmp',
    'reviews',
  );
  const versionedPath = path.join(
    reviewRoot,
    `${params.snapshot.review_wave_id}-review-set.json`,
  );
  const stablePath = buildReviewArtifactPath({
    repoRoot: params.snapshot.plan_host_root,
    storyId: params.snapshot.story_id,
    outputKey: 'current-review-set',
  });
  const atomicDeps = {
    mkdir: resolvedDeps.mkdir,
    rename: resolvedDeps.rename,
    writeFile: resolvedDeps.writeFile,
  };
  await atomicWriteJson(versionedPath, manifest, atomicDeps);
  const stableUpdated = await targetSnapshotIsCurrent(
    params.snapshot,
    resolvedDeps,
  );
  if (stableUpdated) {
    await atomicWriteJson(stablePath, manifest, atomicDeps);
  }
  return { manifest, stablePath, versionedPath, stableUpdated };
}
