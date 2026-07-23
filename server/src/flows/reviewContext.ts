import { execFile as execFileCb } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export const REVIEW_CONTEXT_SCHEMA_VERSION = 'codeinfo-review-context/v1';
export const REVIEW_CONTEXT_EXCLUDED_PATHS = ['planning/**'] as const;

export type PreparedReviewContextSection = {
  source_heading: string;
  markdown: string;
};

export type PreparedReviewContext = {
  schema_version: typeof REVIEW_CONTEXT_SCHEMA_VERSION;
  story_id: string;
  plan_path: string;
  branch: string;
  source_plan_sha256: string;
  context_sha256: string;
  sections: {
    overview: PreparedReviewContextSection;
    acceptance_criteria: PreparedReviewContextSection;
    out_of_scope: PreparedReviewContextSection | null;
  };
  excluded_paths: string[];
  warnings: string[];
  status: 'completed';
};

export type PrepareReviewContextResult = {
  artifactPath: string;
  artifact: PreparedReviewContext;
};

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options?: {
    cwd?: string;
    signal?: AbortSignal;
    timeout?: number;
    killSignal?: NodeJS.Signals | number;
    encoding?: BufferEncoding;
  },
) => Promise<{ stdout: string; stderr: string }>;

type ReviewContextDeps = {
  execFile: ExecFileLike;
  readFile: typeof fs.readFile;
};

export type PreparedReviewContextReference = {
  story_id: string;
  plan_path: string;
  branch: string;
  review_context_file: string;
  review_context_sha256: string;
  review_context_source_plan_sha256: string;
  review_excluded_paths: string[];
  plan_host_root?: string;
};

const defaultDeps: ReviewContextDeps = {
  execFile: (file, args, options) =>
    execFile(file, args, { encoding: 'utf8', ...options }),
  readFile: fs.readFile,
};

const REVIEW_CONTEXT_TIMEOUT_MS = 120_000;
const PROCESS_KILL_SIGNAL: NodeJS.Signals = 'SIGTERM';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const resolveHarnessRoot = () => {
  const configured = process.env.CODEINFO_ROOT?.trim();
  if (configured && path.isAbsolute(configured)) return configured;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
};

export const resolvePreparedReviewContextPath = (
  repoRoot: string,
  storyNumber: string,
) =>
  path.join(
    path.resolve(repoRoot),
    'codeInfoTmp',
    'reviews',
    `${storyNumber}-current-review-context.json`,
  );

const isSection = (value: unknown): value is PreparedReviewContextSection => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.source_heading === 'string' &&
    candidate.source_heading.trim().length > 0 &&
    typeof candidate.markdown === 'string' &&
    candidate.markdown.trim().length > 0
  );
};

export const parsePreparedReviewContext = (
  value: unknown,
): PreparedReviewContext => {
  if (!value || typeof value !== 'object') {
    throw new Error('Prepared review context must be a JSON object.');
  }
  const candidate = value as Record<string, unknown>;
  const sections = candidate.sections as Record<string, unknown> | undefined;
  if (
    candidate.schema_version !== REVIEW_CONTEXT_SCHEMA_VERSION ||
    typeof candidate.story_id !== 'string' ||
    typeof candidate.plan_path !== 'string' ||
    typeof candidate.branch !== 'string' ||
    typeof candidate.source_plan_sha256 !== 'string' ||
    !SHA256_PATTERN.test(candidate.source_plan_sha256) ||
    typeof candidate.context_sha256 !== 'string' ||
    !SHA256_PATTERN.test(candidate.context_sha256) ||
    !sections ||
    !isSection(sections.overview) ||
    !isSection(sections.acceptance_criteria) ||
    !(sections.out_of_scope === null || isSection(sections.out_of_scope)) ||
    !Array.isArray(candidate.excluded_paths) ||
    !candidate.excluded_paths.every((item) => typeof item === 'string') ||
    !Array.isArray(candidate.warnings) ||
    !candidate.warnings.every((item) => typeof item === 'string') ||
    candidate.status !== 'completed'
  ) {
    throw new Error('Prepared review context failed schema validation.');
  }
  return candidate as PreparedReviewContext;
};

export const formatPreparedReviewContext = (context: PreparedReviewContext) =>
  [
    context.sections.overview.markdown,
    context.sections.acceptance_criteria.markdown,
    context.sections.out_of_scope?.markdown,
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n\n');

export async function loadPreparedReviewContext(params: {
  repoRoot: string;
  preparedBase: PreparedReviewContextReference;
  readFile?: typeof fs.readFile;
}): Promise<PreparedReviewContext> {
  const readFile = params.readFile ?? fs.readFile;
  const expectedPath = resolvePreparedReviewContextPath(
    params.repoRoot,
    params.preparedBase.story_id,
  );
  if (
    params.preparedBase.review_context_file !==
    path.relative(params.repoRoot, expectedPath).split(path.sep).join('/')
  ) {
    throw new Error(
      'Prepared review base references an unexpected context path.',
    );
  }
  const context = parsePreparedReviewContext(
    JSON.parse(await readFile(expectedPath, 'utf8')),
  );
  const planHostRoot = params.preparedBase.plan_host_root ?? params.repoRoot;
  const resolvedPlanPath = path.resolve(
    planHostRoot,
    params.preparedBase.plan_path,
  );
  const planRelative = path.relative(planHostRoot, resolvedPlanPath);
  if (
    planRelative === '..' ||
    planRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(planRelative)
  ) {
    throw new Error('Prepared review plan path escapes the repository.');
  }
  const currentPlanSha256 = crypto
    .createHash('sha256')
    .update(await readFile(resolvedPlanPath))
    .digest('hex');
  const currentContextSha256 = crypto
    .createHash('sha256')
    .update(formatPreparedReviewContext(context))
    .digest('hex');
  if (
    context.story_id !== params.preparedBase.story_id ||
    context.plan_path !== params.preparedBase.plan_path ||
    context.branch !== params.preparedBase.branch ||
    context.context_sha256 !== params.preparedBase.review_context_sha256 ||
    context.source_plan_sha256 !==
      params.preparedBase.review_context_source_plan_sha256 ||
    context.source_plan_sha256 !== currentPlanSha256 ||
    context.context_sha256 !== currentContextSha256 ||
    JSON.stringify(context.excluded_paths) !==
      JSON.stringify(params.preparedBase.review_excluded_paths)
  ) {
    throw new Error('Prepared review context is stale or mismatched.');
  }
  return context;
}

export async function prepareReviewContext(
  params: {
    repoRoot: string;
    storyNumber: string;
    planPath: string;
    branch: string;
    signal?: AbortSignal;
  },
  deps?: Partial<ReviewContextDeps>,
): Promise<PrepareReviewContextResult> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const artifactPath = resolvePreparedReviewContextPath(
    params.repoRoot,
    params.storyNumber,
  );
  const scriptPath = path.join(
    resolveHarnessRoot(),
    'scripts',
    'prepare_review_context.py',
  );
  await resolvedDeps.execFile(
    process.env.PYTHON?.trim() || 'python3',
    [
      scriptPath,
      '--repo-root',
      params.repoRoot,
      '--output',
      artifactPath,
      '--branch',
      params.branch,
    ],
    {
      cwd: params.repoRoot,
      signal: params.signal,
      timeout: REVIEW_CONTEXT_TIMEOUT_MS,
      killSignal: PROCESS_KILL_SIGNAL,
      encoding: 'utf8',
    },
  );
  const artifact = parsePreparedReviewContext(
    JSON.parse(await resolvedDeps.readFile(artifactPath, 'utf8')),
  );
  if (
    artifact.story_id !== params.storyNumber ||
    artifact.plan_path !== params.planPath ||
    artifact.branch !== params.branch
  ) {
    throw new Error(
      'Prepared review context does not match current review scope.',
    );
  }
  if (
    artifact.excluded_paths.length !== 1 ||
    artifact.excluded_paths[0] !== REVIEW_CONTEXT_EXCLUDED_PATHS[0]
  ) {
    throw new Error('Prepared review context lacks the planning exclusion.');
  }
  return { artifactPath, artifact };
}
