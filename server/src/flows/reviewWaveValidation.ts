import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeFlowInput } from './flowInput.js';
import {
  atomicWriteJson,
  buildReviewArtifactPath,
  resolveContainedReviewArtifactPath,
} from './reviewIdentity.js';
import type {
  AggregatedReviewFinding,
  ReviewSetManifest,
  ReviewWaveJobResult,
} from './reviewSet.js';
import type { ReviewTargetSnapshot } from './reviewTargets.js';
import type { FlowJsonObject, FlowJsonValue } from './types.js';

export const REVIEW_WAVE_VALIDATION_SCHEMA_VERSION =
  'codeinfo-review-wave-validation/v1';

type ValidationDeps = {
  readFile: typeof fs.readFile;
  mkdir: typeof fs.mkdir;
  rename: typeof fs.rename;
  writeFile: typeof fs.writeFile;
  now: () => Date;
};

const defaultDeps: ValidationDeps = {
  readFile: fs.readFile,
  mkdir: fs.mkdir,
  rename: fs.rename,
  writeFile: fs.writeFile,
  now: () => new Date(),
};

const isObject = (value: unknown): value is FlowJsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const pointerKeyForFlow = (flowName: string) => {
  if (flowName === 'review_artifacts_main') return 'artifact';
  if (flowName === 'codex_review') return 'codex';
  if (flowName === 'open_code_review') return 'open_code';
  return null;
};

const pointerIdentityError = (params: {
  pointer: FlowJsonObject;
  snapshot: ReviewTargetSnapshot;
  target: ReviewTargetSnapshot['targets'][number];
}) => {
  const expected: Record<string, string> = {
    story_id: params.snapshot.story_id,
    parent_execution_id: params.snapshot.parent_execution_id,
    review_wave_id: params.snapshot.review_wave_id,
    target_id: params.target.target_id,
    head_commit: params.target.head_commit,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (params.pointer[field] !== value) {
      return `${field} does not match the review wave.`;
    }
  }
  return null;
};

const jobStatusFromPointer = (
  pointer: FlowJsonObject,
): ReviewWaveJobResult['status'] => {
  const status = pointer.status;
  if (status === 'failed' || status === 'invalid') return 'failed';
  if (
    pointer.partial === true ||
    status === 'partial' ||
    status === 'completed_partial'
  ) {
    return 'partial';
  }
  return status === 'completed' ? 'completed' : 'invalid';
};

const readPointer = async (
  pointerPath: string,
  deps: ValidationDeps,
): Promise<FlowJsonObject | null> => {
  try {
    const value = JSON.parse(
      await deps.readFile(pointerPath, 'utf8'),
    ) as unknown;
    return isObject(value) ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

const findingValues = async (params: {
  pointer: FlowJsonObject;
  repoRoot: string;
  deps: ValidationDeps;
}): Promise<FlowJsonValue[]> => {
  if (Array.isArray(params.pointer.findings)) return params.pointer.findings;
  if (typeof params.pointer.findings_file !== 'string') return [];
  try {
    const findingsPath = resolveContainedReviewArtifactPath({
      repoRoot: params.repoRoot,
      relativePath: params.pointer.findings_file,
    });
    const parsed = JSON.parse(
      await params.deps.readFile(findingsPath, 'utf8'),
    ) as unknown;
    if (Array.isArray(parsed)) return parsed as FlowJsonValue[];
    if (isObject(parsed) && Array.isArray(parsed.findings)) {
      return parsed.findings;
    }
  } catch {
    return [];
  }
  return [];
};

const findingDescriptor = (finding: FlowJsonValue) => {
  const source = isObject(finding) ? finding : { detail: finding };
  const title =
    typeof source.title === 'string'
      ? source.title
      : typeof source.message === 'string'
        ? source.message
        : 'Untitled review finding';
  const findingPath =
    typeof source.path === 'string'
      ? source.path
      : typeof source.file === 'string'
        ? source.file
        : null;
  const line = typeof source.line === 'number' ? source.line : null;
  const severity =
    typeof source.severity === 'string' ? source.severity : 'unspecified';
  return { source, title, path: findingPath, line, severity };
};

const aggregateFindings = (
  entries: Array<{
    finding: FlowJsonValue;
    instanceId: string;
    targetIds: string[];
  }>,
): AggregatedReviewFinding[] => {
  const aggregated = new Map<string, AggregatedReviewFinding>();
  for (const entry of entries) {
    const descriptor = findingDescriptor(entry.finding);
    const targetIds = [...new Set(entry.targetIds)].sort();
    const fingerprint = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          targetIds,
          title: descriptor.title.trim().toLowerCase(),
          path: descriptor.path,
          line: descriptor.line,
        }),
      )
      .digest('hex');
    const existing = aggregated.get(fingerprint);
    if (existing) {
      existing.target_ids = [
        ...new Set([...existing.target_ids, ...targetIds]),
      ].sort();
      existing.severities = [
        ...new Set([...existing.severities, descriptor.severity]),
      ].sort();
      existing.severity_conflict = existing.severities.length > 1;
      existing.sources.push({
        instance_id: entry.instanceId,
        severity: descriptor.severity,
      });
      continue;
    }
    aggregated.set(fingerprint, {
      fingerprint,
      target_ids: targetIds,
      title: descriptor.title,
      path: descriptor.path,
      line: descriptor.line,
      severities: [descriptor.severity],
      severity_conflict: false,
      sources: [
        { instance_id: entry.instanceId, severity: descriptor.severity },
      ],
      detail: normalizeFlowInput(descriptor.source),
    });
  }
  return [...aggregated.values()];
};

export async function validateReviewWave(
  params: {
    snapshot: ReviewTargetSnapshot;
    reviewSet: ReviewSetManifest;
    signal?: AbortSignal;
  },
  deps: Partial<ValidationDeps> = {},
) {
  const resolvedDeps = { ...defaultDeps, ...deps };
  params.signal?.throwIfAborted();
  if (
    params.reviewSet.review_wave_id !== params.snapshot.review_wave_id ||
    params.reviewSet.targets_sha256 !== params.snapshot.targets_sha256 ||
    params.reviewSet.expected_job_count !==
      params.reviewSet.expected_jobs.length
  ) {
    throw new Error('Review-set identity or expected job count is invalid.');
  }
  const findings: Array<{
    finding: FlowJsonValue;
    instanceId: string;
    targetIds: string[];
  }> = [];
  const results: ReviewWaveJobResult[] = [];
  for (const job of params.reviewSet.expected_jobs) {
    params.signal?.throwIfAborted();
    if (job.kind === 'cross_repository_review') {
      const pointerPath = buildReviewArtifactPath({
        repoRoot: params.snapshot.plan_host_root,
        storyId: params.snapshot.story_id,
        outputKey: 'current-cross-repository-review',
      });
      const pointer = await readPointer(pointerPath, resolvedDeps);
      if (!pointer) {
        results.push({
          ...job,
          status: 'missing',
          pointer_path: null,
          error: 'Cross-repository pointer is missing.',
        });
        continue;
      }
      const identityMatches =
        pointer.story_id === params.snapshot.story_id &&
        pointer.review_wave_id === params.snapshot.review_wave_id &&
        pointer.targets_sha256 === params.snapshot.targets_sha256;
      const status = !identityMatches
        ? 'stale'
        : pointer.status === 'completed'
          ? 'completed'
          : pointer.status === 'completed_partial'
            ? 'partial'
            : pointer.status === 'not_applicable' &&
                params.snapshot.targets.length === 1
              ? 'completed'
              : 'invalid';
      results.push({
        ...job,
        status,
        pointer_path: pointerPath,
        error: identityMatches
          ? null
          : 'Cross-repository pointer identity is stale.',
      });
      for (const finding of await findingValues({
        pointer,
        repoRoot: params.snapshot.plan_host_root,
        deps: resolvedDeps,
      })) {
        const source = isObject(finding) ? finding : {};
        const targetIds = Array.isArray(source.target_ids)
          ? source.target_ids.filter(
              (value): value is string => typeof value === 'string',
            )
          : params.snapshot.targets.map((target) => target.target_id);
        findings.push({ finding, instanceId: job.instance_id, targetIds });
      }
      continue;
    }
    const target = params.snapshot.targets.find(
      (candidate) => candidate.target_id === job.target_id,
    );
    const reviewTarget = params.reviewSet.targets.find(
      (candidate) => candidate.target_id === job.target_id,
    );
    const key = pointerKeyForFlow(job.flow_name);
    if (!target || !reviewTarget || !key) {
      results.push({
        ...job,
        status: 'invalid',
        pointer_path: null,
        error: 'Expected target review job is malformed.',
      });
      continue;
    }
    if (reviewTarget.status === 'invalid') {
      results.push({
        ...job,
        status: 'invalid',
        pointer_path: null,
        error: reviewTarget.error ?? 'Target base is invalid.',
      });
      continue;
    }
    const relativePointer = reviewTarget.review_pointers[key];
    const pointerPath = relativePointer
      ? path.resolve(target.repo_root, relativePointer)
      : null;
    const pointer = pointerPath
      ? await readPointer(pointerPath, resolvedDeps)
      : null;
    if (!pointer || !pointerPath) {
      results.push({
        ...job,
        status: 'missing',
        pointer_path: pointerPath,
        error: 'Target review pointer is missing.',
      });
      continue;
    }
    const identityError = pointerIdentityError({
      pointer,
      snapshot: params.snapshot,
      target,
    });
    const status = identityError ? 'stale' : jobStatusFromPointer(pointer);
    results.push({
      ...job,
      status,
      pointer_path: pointerPath,
      error: identityError,
    });
    if (status === 'completed' || status === 'partial') {
      for (const finding of await findingValues({
        pointer,
        repoRoot: target.repo_root,
        deps: resolvedDeps,
      })) {
        findings.push({
          finding,
          instanceId: job.instance_id,
          targetIds: [target.target_id],
        });
      }
    }
  }
  const completedJobs = results.filter(
    (result) => result.status === 'completed',
  ).length;
  const failedJobs = results.filter((result) =>
    ['failed', 'stale', 'invalid'].includes(result.status),
  ).length;
  const missingJobs = results.filter(
    (result) => result.status === 'missing',
  ).length;
  const partialJobs = results.filter(
    (result) => result.status === 'partial',
  ).length;
  const crossResult = results.find((result) => result.target_id === null);
  const closeoutAllowed =
    results.length === params.reviewSet.expected_job_count &&
    results.every((result) => result.status === 'completed') &&
    Boolean(crossResult);
  const finalized: ReviewSetManifest = {
    ...params.reviewSet,
    coverage: {
      ...params.reviewSet.coverage,
      completed_jobs: completedJobs,
      failed_jobs: failedJobs,
      missing_jobs: missingJobs,
    },
    job_results: results,
    cross_repository_status: crossResult?.status ?? 'missing',
    aggregated_findings: aggregateFindings(findings),
    closeout_allowed: closeoutAllowed,
    status:
      completedJobs === 0
        ? 'invalid'
        : failedJobs || missingJobs || partialJobs
          ? 'completed_partial'
          : 'completed',
  };
  const validation = normalizeFlowInput({
    schema_version: REVIEW_WAVE_VALIDATION_SCHEMA_VERSION,
    story_id: params.snapshot.story_id,
    review_wave_id: params.snapshot.review_wave_id,
    targets_sha256: params.snapshot.targets_sha256,
    expected_job_count: params.reviewSet.expected_job_count,
    completed_jobs: completedJobs,
    partial_jobs: partialJobs,
    failed_jobs: failedJobs,
    missing_jobs: missingJobs,
    closeout_allowed: closeoutAllowed,
    status: finalized.status,
    completed_at: resolvedDeps.now().toISOString(),
  });
  const reviewRoot = path.join(
    params.snapshot.plan_host_root,
    'codeInfoTmp',
    'reviews',
  );
  const validationPath = buildReviewArtifactPath({
    repoRoot: params.snapshot.plan_host_root,
    storyId: params.snapshot.story_id,
    outputKey: 'current-review-wave-validation',
  });
  const versionedValidationPath = path.join(
    reviewRoot,
    `${params.snapshot.review_wave_id}-review-wave-validation.json`,
  );
  const reviewSetPath = buildReviewArtifactPath({
    repoRoot: params.snapshot.plan_host_root,
    storyId: params.snapshot.story_id,
    outputKey: 'current-review-set',
  });
  const versionedReviewSetPath = path.join(
    reviewRoot,
    `${params.snapshot.review_wave_id}-review-set-final.json`,
  );
  const atomicDeps = {
    mkdir: resolvedDeps.mkdir,
    rename: resolvedDeps.rename,
    writeFile: resolvedDeps.writeFile,
  };
  await Promise.all([
    atomicWriteJson(validationPath, validation, atomicDeps),
    atomicWriteJson(versionedValidationPath, validation, atomicDeps),
    atomicWriteJson(reviewSetPath, finalized, atomicDeps),
    atomicWriteJson(versionedReviewSetPath, finalized, atomicDeps),
  ]);
  return {
    finalized,
    validation,
    validationPath,
    versionedValidationPath,
    reviewSetPath,
    versionedReviewSetPath,
  };
}
