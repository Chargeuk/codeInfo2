import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveReviewRepositoryRoot } from './reviewBase.js';
import { atomicWriteJson, deriveCanonicalStoryId } from './reviewIdentity.js';

export const ACTIVE_REVIEW_CYCLE_SCHEMA_VERSION =
  'codeinfo-active-review-cycle/v1';

export type ReviewCycleMode = 'final' | 'diagnostic';

export type ActiveReviewCycle = {
  schema_version: typeof ACTIVE_REVIEW_CYCLE_SCHEMA_VERSION;
  review_cycle_id: string;
  review_mode: ReviewCycleMode;
  story_id: string;
  plan_path: string;
  parent_execution_id: string;
  created_at: string;
};

export type ReviewPlanReadiness = {
  eligible: boolean;
  task_count: number;
  incomplete_tasks: Array<{ number: number; status: string | null }>;
  unchecked_work: Array<{ task_number: number; section: string; text: string }>;
};

type ReviewCycleLifecycleDeps = {
  readFile: typeof fs.readFile;
  mkdir: typeof fs.mkdir;
  rename: typeof fs.rename;
  writeFile: typeof fs.writeFile;
  unlink: typeof fs.unlink;
  now: () => Date;
  randomHex: () => string;
};

const defaultDeps: ReviewCycleLifecycleDeps = {
  readFile: fs.readFile,
  mkdir: fs.mkdir,
  rename: fs.rename,
  writeFile: fs.writeFile,
  unlink: fs.unlink,
  now: () => new Date(),
  randomHex: () => crypto.randomBytes(4).toString('hex'),
};

const taskHeadingPattern = /^### Task (\d+)\.[^\n]*$/gmu;
const reviewCycleIdPattern = /^\d{7}-rc-[A-Za-z0-9._-]+$/u;

const sectionBody = (taskText: string, heading: string): string => {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const start = taskText.search(new RegExp(`^#### ${escaped}\\s*$`, 'mu'));
  if (start < 0) return '';
  const bodyStart = taskText.indexOf('\n', start);
  if (bodyStart < 0) return '';
  const remainder = taskText.slice(bodyStart + 1);
  const next = remainder.search(/^#### /mu);
  return next < 0 ? remainder : remainder.slice(0, next);
};

export const inspectFinalReviewReadiness = (
  planMarkdown: string,
): ReviewPlanReadiness => {
  const headings = [...planMarkdown.matchAll(taskHeadingPattern)];
  const incompleteTasks: ReviewPlanReadiness['incomplete_tasks'] = [];
  const uncheckedWork: ReviewPlanReadiness['unchecked_work'] = [];
  for (const [index, heading] of headings.entries()) {
    const taskNumber = Number(heading[1]);
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? planMarkdown.length;
    const taskText = planMarkdown.slice(start, end);
    const status =
      /^- Task Status: `([^`]+)`\s*$/mu.exec(taskText)?.[1] ?? null;
    if (status !== '__done__') {
      incompleteTasks.push({ number: taskNumber, status });
    }
    for (const section of ['Subtasks', 'Testing']) {
      const body = sectionBody(taskText, section);
      for (const match of body.matchAll(/^\s*\d+\. \[ \] (.+)$/gmu)) {
        uncheckedWork.push({
          task_number: taskNumber,
          section,
          text: (match[1] ?? '').trim(),
        });
      }
    }
  }
  return {
    eligible:
      headings.length > 0 &&
      incompleteTasks.length === 0 &&
      uncheckedWork.length === 0,
    task_count: headings.length,
    incomplete_tasks: incompleteTasks,
    unchecked_work: uncheckedWork,
  };
};

const readJsonIfPresent = async (
  filePath: string,
  deps: ReviewCycleLifecycleDeps,
): Promise<Record<string, unknown> | null> => {
  try {
    const parsed: unknown = JSON.parse(await deps.readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

const unlinkIfPresent = async (
  filePath: string,
  deps: ReviewCycleLifecycleDeps,
) => {
  try {
    await deps.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

const timestampId = (value: Date) =>
  value
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}Z$/u, 'Z');

export async function initializeReviewCycle(
  params: {
    workingRepositoryPath: string;
    parentExecutionId: string;
    mode: ReviewCycleMode;
    signal?: AbortSignal;
  },
  deps: Partial<ReviewCycleLifecycleDeps> = {},
) {
  const resolvedDeps = { ...defaultDeps, ...deps };
  params.signal?.throwIfAborted();
  const repoRoot = await resolveReviewRepositoryRoot(
    params.workingRepositoryPath,
    undefined,
    params.signal,
  );
  const flowStateRoot = path.join(repoRoot, 'codeInfoStatus', 'flow-state');
  const currentPlanPath = path.join(flowStateRoot, 'current-plan.json');
  const currentPlan = await readJsonIfPresent(currentPlanPath, resolvedDeps);
  const planPath =
    typeof currentPlan?.plan_path === 'string' && currentPlan.plan_path.trim()
      ? currentPlan.plan_path.trim()
      : null;
  if (!planPath)
    throw new Error('current-plan.json lacked a usable plan_path.');
  const storyId = deriveCanonicalStoryId(planPath);
  const resolvedPlanPath = path.resolve(repoRoot, planPath);
  const relativePlanPath = path.relative(repoRoot, resolvedPlanPath);
  if (
    relativePlanPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePlanPath)
  ) {
    throw new Error(
      'current-plan.json plan_path resolves outside the repository.',
    );
  }
  const planMarkdown = await resolvedDeps.readFile(resolvedPlanPath, 'utf8');
  const readiness = inspectFinalReviewReadiness(planMarkdown);
  const activePath = path.join(flowStateRoot, 'active-review-cycle.json');
  const active = await readJsonIfPresent(activePath, resolvedDeps);
  if (
    params.mode === 'final' &&
    active?.schema_version === ACTIVE_REVIEW_CYCLE_SCHEMA_VERSION &&
    active.parent_execution_id === params.parentExecutionId &&
    active.story_id === storyId &&
    active.plan_path === planPath &&
    active.review_mode === 'final' &&
    typeof active.review_cycle_id === 'string'
  ) {
    return {
      action: 'resumed' as const,
      repoRoot,
      storyId,
      planPath,
      readiness,
      cycle: active as ActiveReviewCycle,
    };
  }
  if (params.mode === 'final' && !readiness.eligible) {
    return {
      action: 'skipped_incomplete_story' as const,
      repoRoot,
      storyId,
      planPath,
      readiness,
      cycle: null,
    };
  }
  if (params.mode === 'diagnostic') {
    return {
      action: 'diagnostic' as const,
      repoRoot,
      storyId,
      planPath,
      readiness,
      cycle: null,
    };
  }

  const dispositionPath = path.join(
    flowStateRoot,
    'review-disposition-state.json',
  );
  let priorDisposition: Record<string, unknown> | null = null;
  try {
    priorDisposition = await readJsonIfPresent(dispositionPath, resolvedDeps);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const priorCycleId =
    typeof priorDisposition?.review_cycle_id === 'string' &&
    priorDisposition.review_cycle_id.trim()
      ? priorDisposition.review_cycle_id.trim()
      : typeof active?.review_cycle_id === 'string' &&
          active.review_cycle_id.trim()
        ? active.review_cycle_id.trim()
        : null;
  if (
    priorDisposition &&
    priorCycleId &&
    reviewCycleIdPattern.test(priorCycleId)
  ) {
    await atomicWriteJson(
      path.join(
        flowStateRoot,
        'review-cycles',
        priorCycleId,
        'review-disposition-state.json',
      ),
      priorDisposition,
      resolvedDeps,
    );
  }
  await unlinkIfPresent(dispositionPath, resolvedDeps);
  await unlinkIfPresent(
    path.join(flowStateRoot, 'minor-review-fix-result.json'),
    resolvedDeps,
  );

  const createdAt = resolvedDeps.now();
  const cycle: ActiveReviewCycle = {
    schema_version: ACTIVE_REVIEW_CYCLE_SCHEMA_VERSION,
    review_cycle_id: `${storyId}-rc-${timestampId(createdAt)}-${resolvedDeps.randomHex()}`,
    review_mode: 'final',
    story_id: storyId,
    plan_path: planPath,
    parent_execution_id: params.parentExecutionId,
    created_at: createdAt.toISOString(),
  };
  await atomicWriteJson(activePath, cycle, resolvedDeps);
  return {
    action: 'initialized' as const,
    repoRoot,
    storyId,
    planPath,
    readiness,
    cycle,
  };
}
