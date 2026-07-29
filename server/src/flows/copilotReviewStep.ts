import fs from 'node:fs/promises';
import path from 'node:path';

import {
  resolveCopilotReviewWorkspacePaths,
  runCopilotReview,
  type CopilotReviewLauncherOptions,
  type CopilotReviewLauncherResult,
} from '../copilot/reviewLauncher.js';
import {
  COPILOT_REVIEW_REASONING_EFFORTS,
  type CopilotReviewReasoningEffort,
  type ResolvedCopilotReviewSpec,
} from './copilotReviewModels.js';
import { hashFlowInput, normalizeFlowInput } from './flowInput.js';
import type { FlowJsonObject, FlowJsonValue } from './types.js';

type ReviewJobInput = {
  batchId: string;
  instanceId: string;
  reviewerFlow: string;
  targetId: string;
  inputDir: string;
  jobDir: string;
  workDir: string;
  outputDir: string;
  verificationDir: string;
};

type ReviewTargetInput = {
  target_id: string;
  repo_root: string;
  head_commit: string;
  comparison_base_commit: string;
};

const REASONING_EFFORTS = new Set<string>(COPILOT_REVIEW_REASONING_EFFORTS);

const requireRecord = (
  value: FlowJsonValue | undefined,
  label: string,
): FlowJsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
};

const requireString = (
  record: FlowJsonObject,
  key: string,
  label: string,
): string => {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}.${key} must be a non-empty string.`);
  }
  return value.trim();
};

const optionalString = (
  record: FlowJsonObject,
  key: string,
  label: string,
): string | undefined => {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      `${label}.${key} must be a non-empty string when supplied.`,
    );
  }
  return value.trim();
};

const requireBoolean = (
  record: FlowJsonObject,
  key: string,
  label: string,
): boolean => {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${label}.${key} must be a boolean.`);
  }
  return value;
};

const parseReviewJob = (value: FlowJsonValue | undefined): ReviewJobInput => {
  const job = requireRecord(value, 'review_job');
  return {
    batchId: requireString(job, 'batch_id', 'review_job'),
    instanceId: requireString(job, 'instance_id', 'review_job'),
    reviewerFlow: requireString(job, 'reviewer_flow', 'review_job'),
    targetId: requireString(job, 'target_id', 'review_job'),
    inputDir: requireString(job, 'input_dir', 'review_job'),
    jobDir: requireString(job, 'job_dir', 'review_job'),
    workDir: requireString(job, 'work_dir', 'review_job'),
    outputDir: requireString(job, 'output_dir', 'review_job'),
    verificationDir: requireString(job, 'verification_dir', 'review_job'),
  };
};

const parseTarget = (value: FlowJsonValue | undefined): ReviewTargetInput => {
  const target = requireRecord(value, 'target');
  return {
    target_id: requireString(target, 'target_id', 'target'),
    repo_root: requireString(target, 'repo_root', 'target'),
    head_commit: requireString(target, 'head_commit', 'target'),
    comparison_base_commit: requireString(
      target,
      'comparison_base_commit',
      'target',
    ),
  };
};

const parseSpec = (
  value: FlowJsonValue | undefined,
): ResolvedCopilotReviewSpec => {
  const spec = requireRecord(value, 'copilot_review_spec');
  const mode = requireString(spec, 'mode', 'copilot_review_spec');
  if (mode !== 'native' && mode !== 'external') {
    throw new Error('copilot_review_spec.mode must be "native" or "external".');
  }
  const reasoningEffort = requireString(
    spec,
    'reasoningEffort',
    'copilot_review_spec',
  );
  if (!REASONING_EFFORTS.has(reasoningEffort)) {
    throw new Error('copilot_review_spec.reasoningEffort is unsupported.');
  }
  const endpointLabel = optionalString(
    spec,
    'endpointLabel',
    'copilot_review_spec',
  );
  const endpointId = optionalString(spec, 'endpointId', 'copilot_review_spec');
  const unavailableReason = optionalString(
    spec,
    'unavailableReason',
    'copilot_review_spec',
  );
  if (mode === 'native' && (endpointLabel || endpointId)) {
    throw new Error(
      'Native copilot_review_spec must not contain an external endpoint.',
    );
  }
  if (mode === 'external' && !endpointLabel) {
    throw new Error(
      'External copilot_review_spec.endpointLabel must be supplied.',
    );
  }
  const available = requireBoolean(spec, 'available', 'copilot_review_spec');
  if (available && mode === 'external' && !endpointId) {
    throw new Error(
      'Available external copilot_review_spec.endpointId must be supplied.',
    );
  }
  return {
    selector: requireString(spec, 'selector', 'copilot_review_spec'),
    mode,
    modelId: requireString(spec, 'modelId', 'copilot_review_spec'),
    reasoningEffort: reasoningEffort as CopilotReviewReasoningEffort,
    stableId: requireString(spec, 'stableId', 'copilot_review_spec'),
    available,
    ...(endpointLabel ? { endpointLabel } : {}),
    ...(endpointId ? { endpointId } : {}),
    ...(unavailableReason ? { unavailableReason } : {}),
  };
};

const requireSameRealPath = async (
  actualPath: string,
  expectedPath: string,
  label: string,
) => {
  const [actual, expected] = await Promise.all([
    fs.realpath(actualPath),
    fs.realpath(expectedPath),
  ]);
  if (actual !== expected) {
    throw new Error(`${label} does not match the assigned review workspace.`);
  }
};

const atomicWrite = async (filePath: string, contents: string) => {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, contents, 'utf8');
  await fs.rename(temporaryPath, filePath);
};

const buildInstructions = (params: {
  target: ReviewTargetInput;
  spec: ResolvedCopilotReviewSpec;
  targetBrief: string;
  storyContext: string;
}) =>
  `${[
    '# Pinned Copilot review instructions',
    '',
    'This file was generated from the immutable scheduler-owned review input. Review the committed implementation changes only and do not modify source files, planning files, Git state, branches, commits, remotes, or review artifacts.',
    '',
    `- Repository: \`${params.target.repo_root}\``,
    `- Range: \`${params.target.comparison_base_commit}...${params.target.head_commit}\``,
    `- Model: \`${params.spec.selector}\``,
    `- Reasoning effort: \`${params.spec.reasoningEffort}\``,
    '- Excluded path: `planning/**`',
    '',
    'Do not create a remote pull-request review, publish comments, export a session, or delegate to a remote coding agent.',
    '',
    'Do not inspect, read, summarize, cite, or report findings for changed repository-root-relative files under `planning/**`. Use the pinned story context below as the requirements source. Inspect implementation changes with:',
    '',
    '```sh',
    `git diff ${params.target.comparison_base_commit}...${params.target.head_commit} -- . ':(exclude)planning/**'`,
    '```',
    '',
    'If no non-planning implementation changes remain, report that honestly instead of inventing findings. Otherwise report only concrete, evidence-backed review findings with file and line evidence where available.',
    '',
    '## Pinned review target',
    '',
    params.targetBrief.trim(),
    '',
    '## Pinned story context',
    '',
    params.storyContext.trim(),
    '',
  ].join('\n')}\n`;

export async function prepareCopilotReviewLaunch(
  input: FlowJsonObject,
): Promise<CopilotReviewLauncherOptions> {
  const reviewJob = parseReviewJob(input.review_job);
  const target = parseTarget(input.target);
  const spec = parseSpec(input.copilot_review_spec);
  const reviewWave = requireRecord(input.review_wave, 'review_wave');
  const reviewWaveId = requireString(
    reviewWave,
    'review_wave_id',
    'review_wave',
  );
  if (reviewJob.reviewerFlow !== 'copilot_review') {
    throw new Error('review_job.reviewer_flow must be "copilot_review".');
  }
  if (
    reviewJob.targetId !== target.target_id ||
    reviewJob.batchId !== reviewWaveId
  ) {
    throw new Error(
      'Copilot review job identity does not match its target and review wave.',
    );
  }
  const waveTargets = reviewWave.targets;
  if (!Array.isArray(waveTargets)) {
    throw new Error('review_wave.targets must be an array.');
  }
  const pinnedTarget = waveTargets.find(
    (candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      candidate.target_id === target.target_id,
  );
  if (
    !pinnedTarget ||
    hashFlowInput(normalizeFlowInput(pinnedTarget)) !==
      hashFlowInput(normalizeFlowInput(input.target))
  ) {
    throw new Error(
      'Copilot review target does not match the immutable review-wave target.',
    );
  }

  const workspacePaths = await resolveCopilotReviewWorkspacePaths(
    reviewJob.jobDir,
  );
  await Promise.all([
    requireSameRealPath(
      reviewJob.inputDir,
      path.dirname(workspacePaths.availabilitySpecPath),
      'review_job.input_dir',
    ),
    requireSameRealPath(
      reviewJob.workDir,
      path.dirname(workspacePaths.instructionsPath),
      'review_job.work_dir',
    ),
    requireSameRealPath(
      reviewJob.outputDir,
      path.dirname(workspacePaths.normalizedResultPath),
      'review_job.output_dir',
    ),
    requireSameRealPath(
      reviewJob.verificationDir,
      path.join(workspacePaths.workspacePath, 'verification'),
      'review_job.verification_dir',
    ),
  ]);

  const pinnedSpec = normalizeFlowInput(
    JSON.parse(
      await fs.readFile(workspacePaths.availabilitySpecPath, 'utf8'),
    ) as unknown,
  );
  if (
    hashFlowInput(pinnedSpec) !==
    hashFlowInput(normalizeFlowInput(input.copilot_review_spec))
  ) {
    throw new Error(
      'Copilot review model does not match the immutable workspace snapshot.',
    );
  }

  const [targetBrief, storyContext] = await Promise.all([
    fs.readFile(
      path.join(
        path.dirname(workspacePaths.availabilitySpecPath),
        'review-target.md',
      ),
      'utf8',
    ),
    fs.readFile(
      path.join(
        path.dirname(workspacePaths.availabilitySpecPath),
        'story-context.md',
      ),
      'utf8',
    ),
  ]);
  await atomicWrite(
    workspacePaths.instructionsPath,
    buildInstructions({ target, spec, targetBrief, storyContext }),
  );

  return {
    repositoryPath: target.repo_root,
    workspacePath: workspacePaths.workspacePath,
    targetId: target.target_id,
    reviewWaveId,
    jobInstanceId: reviewJob.instanceId,
    baseCommit: target.comparison_base_commit,
    headCommit: target.head_commit,
    modelId: spec.modelId,
    reasoningEffort: spec.reasoningEffort,
    ...(spec.endpointLabel ? { endpointLabel: spec.endpointLabel } : {}),
    ...(spec.endpointId ? { endpointId: spec.endpointId } : {}),
  };
}

export async function executeCopilotReviewStep(
  input: FlowJsonObject,
  signal: AbortSignal,
  deps: {
    runCopilotReview: (
      options: CopilotReviewLauncherOptions,
    ) => Promise<CopilotReviewLauncherResult>;
  } = { runCopilotReview },
): Promise<CopilotReviewLauncherResult> {
  const options = await prepareCopilotReviewLaunch(input);
  return deps.runCopilotReview({ ...options, signal });
}
