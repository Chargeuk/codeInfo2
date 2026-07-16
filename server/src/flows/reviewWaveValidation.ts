import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeFlowInput } from './flowInput.js';
import {
  validateReviewArtifacts,
  type ReviewArtifactsValidationResult,
  type ReviewPointerValidationResult,
} from './reviewArtifacts.js';
import { atomicWriteJson, buildReviewArtifactPath } from './reviewIdentity.js';
import type {
  AggregatedReviewFinding,
  ReviewPhase,
  ReviewSourceIdentity,
  ReviewSetManifest,
  ReviewWaveJobResult,
} from './reviewSet.js';
import type { ReviewTargetSnapshot } from './reviewTargets.js';
import type { FlowJsonObject, FlowJsonValue } from './types.js';

export const REVIEW_WAVE_VALIDATION_SCHEMA_VERSION =
  'codeinfo-review-wave-validation/v2';

type ValidationDeps = {
  readFile: typeof fs.readFile;
  mkdir: typeof fs.mkdir;
  rename: typeof fs.rename;
  writeFile: typeof fs.writeFile;
  now: () => Date;
  validateReviewArtifacts: typeof validateReviewArtifacts;
};

const defaultDeps: ValidationDeps = {
  readFile: fs.readFile,
  mkdir: fs.mkdir,
  rename: fs.rename,
  writeFile: fs.writeFile,
  now: () => new Date(),
  validateReviewArtifacts,
};

const isObject = (value: unknown): value is FlowJsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const pointerKeyForFlow = (flowName: string) => {
  if (flowName === 'review_artifacts_main') return 'artifact';
  if (flowName === 'codex_review') return 'codex';
  if (flowName === 'open_code_review') return 'open_code';
  return null;
};

const jobStatusFromValidation = (
  validation: ReviewPointerValidationResult,
): ReviewWaveJobResult['status'] => {
  if (validation.usable) {
    return validation.status === 'partial' ? 'partial' : 'completed';
  }
  return validation.status === 'passed' ? 'failed' : validation.status;
};

type TargetValidation = {
  result: ReviewArtifactsValidationResult | null;
  validationFile: string;
  error: string | null;
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

const findingValues = (pointer: FlowJsonObject): FlowJsonValue[] => {
  if (Array.isArray(pointer.findings)) return pointer.findings;
  return isObject(pointer.findings) && Array.isArray(pointer.findings.findings)
    ? pointer.findings.findings
    : [];
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

const REVIEW_NAMES: Record<string, string> = {
  codex_review: 'Codex Review',
  cross_repository_review: 'Cross-Repository Review',
  open_code_review: 'Open Code Review',
  review_artifacts_main: 'Main Review',
};

const humanReadableReviewName = (flowName: string) =>
  REVIEW_NAMES[flowName] ??
  flowName
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

const sourceIdentityForJob = (params: {
  instanceId: string;
  flowName: string;
  reviewPhase: ReviewPhase;
  targetId: string | null;
  repoAlias: string | null;
}): Omit<ReviewSourceIdentity, 'severity'> => ({
  instance_id: params.instanceId,
  flow_name: params.flowName,
  review_phase: params.reviewPhase,
  target_id: params.targetId,
  repo_alias: params.repoAlias,
  review_name: humanReadableReviewName(params.flowName),
});

const aggregateFindings = (
  entries: Array<{
    finding: FlowJsonValue;
    source: Omit<ReviewSourceIdentity, 'severity'>;
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
      if (
        !existing.sources.some(
          (source) =>
            source.instance_id === entry.source.instance_id &&
            source.severity === descriptor.severity,
        )
      ) {
        existing.sources.push({
          ...entry.source,
          severity: descriptor.severity,
        });
        existing.sources.sort(
          (left, right) =>
            left.instance_id.localeCompare(right.instance_id) ||
            left.severity.localeCompare(right.severity),
        );
      }
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
      sources: [{ ...entry.source, severity: descriptor.severity }],
      detail: normalizeFlowInput(descriptor.source),
    });
  }
  return [...aggregated.values()];
};

export async function validateReviewWave(
  params: {
    snapshot: ReviewTargetSnapshot;
    reviewSet: ReviewSetManifest;
    expectedReviewPhase?: ReviewPhase;
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
      params.reviewSet.expected_jobs.length ||
    (params.expectedReviewPhase !== undefined &&
      params.reviewSet.review_phase !== params.expectedReviewPhase)
  ) {
    throw new Error(
      'Review-set identity, phase, or expected job count is invalid.',
    );
  }
  const findings: Array<{
    finding: FlowJsonValue;
    source: Omit<ReviewSourceIdentity, 'severity'>;
    targetIds: string[];
  }> = [];
  const targetValidations = new Map<string, TargetValidation>();
  for (const target of params.snapshot.targets) {
    params.signal?.throwIfAborted();
    const reviewTarget = params.reviewSet.targets.find(
      (candidate) => candidate.target_id === target.target_id,
    );
    const validationFile = buildReviewArtifactPath({
      repoRoot: target.repo_root,
      storyId: params.snapshot.story_id,
      outputKey: 'current-review-validation',
    });
    if (!reviewTarget || reviewTarget.status === 'invalid') {
      targetValidations.set(target.target_id, {
        result: null,
        validationFile,
        error: reviewTarget?.error ?? 'Target review base is unavailable.',
      });
      continue;
    }
    const pointerKeys = params.reviewSet.expected_jobs
      .filter(
        (job) =>
          job.kind === 'target_review' && job.target_id === target.target_id,
      )
      .map((job) => pointerKeyForFlow(job.flow_name))
      .filter(
        (key): key is Exclude<ReturnType<typeof pointerKeyForFlow>, null> =>
          key !== null,
      )
      .map((key) =>
        key === 'artifact'
          ? 'current-review'
          : key === 'codex'
            ? 'current-codex-review'
            : 'current-open-code-review',
      );
    try {
      const result = await resolvedDeps.validateReviewArtifacts({
        workingRepositoryPath: target.repo_root,
        pointerKeys,
        validationMode: 'wave_target',
        storyId: params.snapshot.story_id,
        ensureCanonicalFallback: true,
        signal: params.signal,
      });
      targetValidations.set(target.target_id, {
        result,
        validationFile,
        error: null,
      });
    } catch (error) {
      params.signal?.throwIfAborted();
      targetValidations.set(target.target_id, {
        result: null,
        validationFile,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
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
          validation_file: null,
          validation: null,
          error: 'Cross-repository pointer is missing.',
        });
        continue;
      }
      const identityMatches =
        pointer.story_id === params.snapshot.story_id &&
        pointer.review_wave_id === params.snapshot.review_wave_id &&
        pointer.parent_execution_id === params.snapshot.parent_execution_id &&
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
        validation_file: null,
        validation: null,
        error: identityMatches
          ? null
          : 'Cross-repository pointer identity is stale.',
      });
      if (status === 'completed' || status === 'partial') {
        for (const finding of findingValues(pointer)) {
          const source = isObject(finding) ? finding : {};
          const targetIds = Array.isArray(source.target_ids)
            ? source.target_ids.filter(
                (value): value is string => typeof value === 'string',
              )
            : params.snapshot.targets.map((target) => target.target_id);
          findings.push({
            finding,
            source: sourceIdentityForJob({
              instanceId: job.instance_id,
              flowName: job.flow_name,
              reviewPhase: params.reviewSet.review_phase ?? 'standalone',
              targetId: null,
              repoAlias: null,
            }),
            targetIds,
          });
        }
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
        validation_file: null,
        validation: null,
        error: 'Expected target review job is malformed.',
      });
      continue;
    }
    if (reviewTarget.status === 'invalid') {
      results.push({
        ...job,
        status: 'invalid',
        pointer_path: null,
        validation_file:
          targetValidations.get(target.target_id)?.validationFile ?? null,
        validation: null,
        error: reviewTarget.error ?? 'Target base is invalid.',
      });
      continue;
    }
    const relativePointer = reviewTarget.review_pointers[key];
    const pointerPath = relativePointer
      ? path.resolve(target.repo_root, relativePointer)
      : null;
    const targetValidation = targetValidations.get(target.target_id);
    const pointerKey =
      key === 'artifact'
        ? 'current-review'
        : key === 'codex'
          ? 'current-codex-review'
          : 'current-open-code-review';
    const pointerValidation = targetValidation?.result?.pointer_results.find(
      (candidate) => candidate.pointer_key === pointerKey,
    );
    if (!pointerValidation) {
      results.push({
        ...job,
        status: targetValidation?.error ? 'failed' : 'missing',
        pointer_path: pointerPath,
        validation_file: targetValidation?.validationFile ?? null,
        validation: null,
        error:
          targetValidation?.error ?? 'Target review validation is missing.',
      });
      continue;
    }
    if (!targetValidation?.result) {
      results.push({
        ...job,
        status: 'failed',
        pointer_path: pointerPath,
        validation_file: targetValidation?.validationFile ?? null,
        validation: null,
        error: 'Target review validation result is unavailable.',
      });
      continue;
    }
    const targetResult = targetValidation.result;
    const targetIdentityMatches =
      targetResult.validation_mode === 'wave_target' &&
      targetResult.story_id === params.snapshot.story_id &&
      targetResult.plan_path === params.snapshot.plan_path &&
      targetResult.parent_execution_id ===
        params.snapshot.parent_execution_id &&
      targetResult.target_id === target.target_id &&
      targetResult.repo_alias === target.repo_alias &&
      targetResult.review_wave_id === params.snapshot.review_wave_id &&
      targetResult.plan_host_root === params.snapshot.plan_host_root &&
      targetResult.head_commit === target.head_commit;
    if (!targetIdentityMatches) {
      results.push({
        ...job,
        status: 'stale',
        pointer_path: pointerPath,
        validation_file: targetValidation.validationFile,
        validation: null,
        error: 'Target review validation identity is stale.',
      });
      continue;
    }
    const status = jobStatusFromValidation(pointerValidation);
    results.push({
      ...job,
      status,
      pointer_path: pointerPath,
      validation_file: targetValidation?.validationFile ?? null,
      validation: {
        ...pointerValidation,
        validation_mode: 'wave_target',
        story_id: targetResult.story_id,
        plan_path: targetResult.plan_path,
        review_session_id: targetResult.review_session_id,
        review_pass_id: targetResult.review_pass_id,
        head_commit: targetResult.head_commit,
        comparison_base_commit: targetResult.comparison_base_commit,
        parent_execution_id: targetResult.parent_execution_id,
        target_id: target.target_id,
        repo_alias: target.repo_alias,
        review_wave_id: params.snapshot.review_wave_id,
        plan_host_root: params.snapshot.plan_host_root,
      },
      error:
        pointerValidation.errors.length > 0
          ? pointerValidation.errors.join(' ')
          : null,
    });
    if (status === 'completed' || status === 'partial') {
      for (const finding of pointerValidation.validated_findings ?? []) {
        findings.push({
          finding,
          source: sourceIdentityForJob({
            instanceId: job.instance_id,
            flowName: job.flow_name,
            reviewPhase: params.reviewSet.review_phase ?? 'standalone',
            targetId: target.target_id,
            repoAlias: target.repo_alias,
          }),
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
  const crossRepositoryRequired =
    params.reviewSet.cross_repository_required ??
    params.reviewSet.expected_jobs.some(
      (job) => job.kind === 'cross_repository_review',
    );
  const closeoutAllowed =
    results.length === params.reviewSet.expected_job_count &&
    results.every((result) => result.status === 'completed') &&
    (!crossRepositoryRequired || Boolean(crossResult));
  const finalized: ReviewSetManifest = {
    ...params.reviewSet,
    coverage: {
      ...params.reviewSet.coverage,
      completed_jobs: completedJobs,
      failed_jobs: failedJobs,
      missing_jobs: missingJobs,
    },
    job_results: results,
    cross_repository_status: crossResult?.status ?? 'not_expected',
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
    plan_path: params.snapshot.plan_path,
    review_wave_id: params.snapshot.review_wave_id,
    parent_execution_id: params.snapshot.parent_execution_id,
    targets_sha256: params.snapshot.targets_sha256,
    review_phase: params.reviewSet.review_phase ?? 'standalone',
    cross_repository_required: crossRepositoryRequired,
    expected_job_count: params.reviewSet.expected_job_count,
    completed_jobs: completedJobs,
    partial_jobs: partialJobs,
    failed_jobs: failedJobs,
    missing_jobs: missingJobs,
    closeout_allowed: closeoutAllowed,
    status: finalized.status,
    job_results: results,
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
    atomicWriteJson(versionedValidationPath, validation, atomicDeps),
    atomicWriteJson(versionedReviewSetPath, finalized, atomicDeps),
    ...(closeoutAllowed
      ? [
          atomicWriteJson(validationPath, validation, atomicDeps),
          atomicWriteJson(reviewSetPath, finalized, atomicDeps),
        ]
      : []),
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
