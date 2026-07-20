import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const CANONICAL_STORY_ID_PATTERN = /^\d{7}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const PLAN_STORY_PATTERN = /^(\d{7})-/u;
const SAFE_OUTPUT_KEY_PATTERN = /^[A-Za-z0-9._-]+$/u;

export const ReviewIdentitySchema = z
  .object({
    story_id: z.string().regex(CANONICAL_STORY_ID_PATTERN),
    plan_path: z.string().trim().min(1),
    review_session_id: z.string().regex(SAFE_ID_PATTERN),
    review_pass_id: z.string().regex(SAFE_ID_PATTERN),
    head_commit: z.string().regex(FULL_COMMIT_PATTERN),
    comparison_base_commit: z.string().regex(FULL_COMMIT_PATTERN),
  })
  .strict();

export type ReviewIdentity = z.infer<typeof ReviewIdentitySchema>;

export type ReviewIdentitySource = Partial<ReviewIdentity> & {
  canonical_review_pass_id?: unknown;
};

type AtomicWriteDeps = Pick<typeof fs, 'mkdir' | 'rename' | 'writeFile'>;

const defaultAtomicWriteDeps: AtomicWriteDeps = {
  mkdir: fs.mkdir,
  rename: fs.rename,
  writeFile: fs.writeFile,
};

export const deriveCanonicalStoryId = (planPath: string): string => {
  const match = path.basename(planPath).match(PLAN_STORY_PATTERN);
  if (!match) {
    throw new Error(
      `Plan path "${planPath}" does not encode a canonical 7-digit story ID.`,
    );
  }
  return match[1];
};

export const ensureCanonicalStoryId = (storyId: string): string => {
  if (!CANONICAL_STORY_ID_PATTERN.test(storyId)) {
    throw new Error(`Invalid canonical story ID "${storyId}".`);
  }
  return storyId;
};

export const ensureSafeReviewId = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (!trimmed || !SAFE_ID_PATTERN.test(trimmed)) {
    throw new Error(`Invalid ${label} "${value}".`);
  }
  return trimmed;
};

export const buildReviewArtifactPath = (params: {
  repoRoot: string;
  storyId: string;
  outputKey: string;
}): string => {
  const storyId = ensureCanonicalStoryId(params.storyId);
  const outputKey = params.outputKey.trim();
  if (!outputKey || !SAFE_OUTPUT_KEY_PATTERN.test(outputKey)) {
    throw new Error(
      `Invalid review artifact output key "${params.outputKey}".`,
    );
  }
  return path.join(
    path.resolve(params.repoRoot),
    'codeInfoTmp',
    'reviews',
    `${storyId}-${outputKey}.json`,
  );
};

export const resolveContainedReviewArtifactPath = (params: {
  repoRoot: string;
  relativePath: string;
}): string => {
  const reviewRoot = path.resolve(params.repoRoot, 'codeInfoTmp', 'reviews');
  const resolved = path.resolve(params.repoRoot, params.relativePath);
  const relative = path.relative(reviewRoot, resolved);
  if (
    relative === '' ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Review artifact path "${params.relativePath}" is outside codeInfoTmp/reviews.`,
    );
  }
  return resolved;
};

export const formatReviewTimestamp = (value: Date): string =>
  value
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}Z$/u, 'Z');

export const createReviewIdentity = (params: {
  planPath: string;
  headCommit: string;
  comparisonBaseCommit: string;
  now: Date;
  randomHex?: string;
}): ReviewIdentity => {
  const storyId = deriveCanonicalStoryId(params.planPath);
  const timestamp = formatReviewTimestamp(params.now);
  const shortHead = params.headCommit.slice(0, 10);
  const suffix = ensureSafeReviewId(
    params.randomHex ?? crypto.randomBytes(4).toString('hex'),
    'review identity suffix',
  );
  return ReviewIdentitySchema.parse({
    story_id: storyId,
    plan_path: params.planPath,
    review_session_id: `${storyId}-rs-${timestamp}-${shortHead}-${suffix}`,
    review_pass_id: `${storyId}-${timestamp}-${shortHead}-${suffix}`,
    head_commit: params.headCommit,
    comparison_base_commit: params.comparisonBaseCommit,
  });
};

export const readReviewIdentity = (
  source: ReviewIdentitySource,
  options?: { canonicalPassField?: boolean },
): ReviewIdentity =>
  ReviewIdentitySchema.parse({
    story_id: source.story_id,
    plan_path: source.plan_path,
    review_session_id: source.review_session_id,
    review_pass_id: options?.canonicalPassField
      ? source.canonical_review_pass_id
      : source.review_pass_id,
    head_commit: source.head_commit,
    comparison_base_commit: source.comparison_base_commit,
  });

export const assertReviewIdentityMatches = (
  expected: ReviewIdentity,
  actual: ReviewIdentity,
  label: string,
): void => {
  const mismatches = Object.entries(expected).flatMap(([key, value]) =>
    actual[key as keyof ReviewIdentity] === value
      ? []
      : [
          `${key}: expected ${JSON.stringify(value)}, received ${JSON.stringify(actual[key as keyof ReviewIdentity])}`,
        ],
  );
  if (mismatches.length > 0) {
    throw new Error(
      `${label} review identity mismatch: ${mismatches.join('; ')}`,
    );
  }
};

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
  deps: AtomicWriteDeps = defaultAtomicWriteDeps,
): Promise<void> {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  await deps.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  try {
    await deps.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await deps.rename(temporaryPath, target);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export const REVIEW_IDENTITY_CONSTANTS = {
  CANONICAL_STORY_ID_PATTERN,
  SAFE_ID_PATTERN,
  FULL_COMMIT_PATTERN,
};
