import fs from 'node:fs/promises';
import path from 'node:path';

import type { TurnStatus, TurnUsageMetadata } from '../mongo/turn.js';
import type { FlowJsonObject } from './types.js';

export type ReviewUsageWriteResult =
  | { status: 'written'; artifactPath: string }
  | { status: 'skipped'; reason: string };

const recordValue = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? String(Math.trunc(value))
    : 'Not reported';

const safeSegment = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || 'review-step';
};

const isContained = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
};

const reviewJobPaths = (
  input?: FlowJsonObject,
): { jobDir: string; workDir: string } | undefined => {
  const reviewJob = input?.review_job;
  if (!reviewJob || typeof reviewJob !== 'object' || Array.isArray(reviewJob)) {
    return undefined;
  }
  const jobDir = reviewJob.job_dir;
  const workDir = reviewJob.work_dir;
  if (
    typeof jobDir !== 'string' ||
    typeof workDir !== 'string' ||
    !path.isAbsolute(jobDir) ||
    !path.isAbsolute(workDir)
  ) {
    return undefined;
  }
  return { jobDir, workDir };
};

export const writeReviewUsageArtifact = async (params: {
  input?: FlowJsonObject;
  flowName: string;
  stepIndex: number;
  stepLabel?: string;
  stepIdentifier: string;
  invocation: number;
  attempt: number;
  providerId: string;
  modelId: string;
  status: TurnStatus;
  usage?: TurnUsageMetadata;
}): Promise<ReviewUsageWriteResult> => {
  try {
    const assigned = reviewJobPaths(params.input);
    if (!assigned) {
      return {
        status: 'skipped',
        reason: 'assigned review job paths are unavailable',
      };
    }

    const [jobDir, workDir] = await Promise.all([
      fs.realpath(assigned.jobDir),
      fs.realpath(assigned.workDir),
    ]);
    if (!isContained(jobDir, workDir)) {
      return {
        status: 'skipped',
        reason: 'assigned review work directory escapes its job directory',
      };
    }

    const usageDir = path.join(workDir, 'review-usage');
    await fs.mkdir(usageDir, { recursive: true });
    const resolvedUsageDir = await fs.realpath(usageDir);
    if (!isContained(workDir, resolvedUsageDir)) {
      return {
        status: 'skipped',
        reason: 'review usage directory escapes its assigned work directory',
      };
    }

    const artifactPath = path.join(
      resolvedUsageDir,
      [
        String(params.stepIndex).padStart(4, '0'),
        safeSegment(params.stepIdentifier),
        `invocation-${params.invocation}`,
        `attempt-${params.attempt}.md`,
      ].join('-'),
    );
    const content = `${[
      '# Actual review usage',
      '',
      'This optional factual artifact records only an explicitly designated reviewing-model invocation.',
      '',
      `- Flow: ${params.flowName}`,
      `- Step: ${params.stepLabel?.trim() || params.stepIdentifier}`,
      `- Identifier: ${params.stepIdentifier}`,
      `- Invocation: ${params.invocation}`,
      `- Attempt: ${params.attempt}`,
      `- Status: ${params.status}`,
      `- Provider: ${params.providerId}`,
      `- Model: ${params.modelId}`,
      `- Input tokens: ${recordValue(params.usage?.inputTokens)}`,
      `- Cached input tokens: ${recordValue(params.usage?.cachedInputTokens)}`,
      `- Output tokens: ${recordValue(params.usage?.outputTokens)}`,
      `- Provider total tokens: ${recordValue(params.usage?.totalTokens)}`,
      '',
      'Cached input tokens are preserved separately and are not an additional amount to add to input tokens.',
    ].join('\n')}\n`;
    const temporaryPath = `${artifactPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, artifactPath);
    return { status: 'written', artifactPath };
  } catch (error) {
    return {
      status: 'skipped',
      reason:
        error instanceof Error
          ? error.message
          : 'review usage evidence could not be written',
    };
  }
};
