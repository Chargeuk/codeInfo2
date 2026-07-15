import { execFile as execFileCb } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';

import { resolveWorkingFolderWorkingDirectory } from '../workingFolders/executionContext.js';
import {
  readPreparedReviewBase,
  resolveReviewRepositoryRoot,
  type PreparedReviewBase,
} from './reviewBase.js';
import { loadPreparedReviewContext } from './reviewContext.js';
import {
  assertReviewIdentityMatches,
  atomicWriteJson,
  buildReviewArtifactPath,
  deriveCanonicalStoryId,
  readReviewIdentity,
  resolveContainedReviewArtifactPath,
  type ReviewIdentity,
} from './reviewIdentity.js';

const execFile = promisify(execFileCb);
type ReviewPointer = Record<string, unknown>;

type OcrCommandRunner = (params: {
  args: string[];
  signal?: AbortSignal;
}) => Promise<void>;

type ReviewArtifactsDeps = {
  runOcrCommand: OcrCommandRunner;
};

const defaultDeps: ReviewArtifactsDeps = {
  runOcrCommand: async ({ args, signal }) => {
    await execFile('ocr', args, {
      encoding: 'utf8',
      signal,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  },
};

export type ReviewPointerValidationStatus =
  | 'passed'
  | 'partial'
  | 'failed'
  | 'missing'
  | 'stale';

export type ReviewPointerValidationResult = {
  pointer_key: string;
  pointer_file: string;
  status: ReviewPointerValidationStatus;
  usable: boolean;
  errors: string[];
  warnings: string[];
  validated_artifact_files: string[];
  usable_bundle_ids: string[];
};

export type ReviewArtifactsValidationResult = {
  schema_version: 2;
  story_id: string;
  plan_path: string;
  review_session_id: string;
  review_pass_id: string;
  head_commit: string;
  comparison_base_commit: string;
  parent_execution_id: string;
  pointer_files: string[];
  pointer_results: ReviewPointerValidationResult[];
  validated_artifact_files: string[];
  fallback_findings_file?: string;
  status: 'passed' | 'partial' | 'blocked';
  errors: string[];
  warnings: string[];
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

const displayArtifactPath = (
  repoRoot: string,
  absolutePath: string,
): string => {
  const relative = path.relative(repoRoot, absolutePath);
  return relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
    ? absolutePath
    : relative.split(path.sep).join('/');
};

const assertRealPathContained = async (
  allowedRoot: string,
  artifactPath: string,
): Promise<void> => {
  const [resolvedRoot, resolvedArtifact] = await Promise.all([
    fs.realpath(allowedRoot),
    fs.realpath(artifactPath),
  ]);
  const relative = path.relative(resolvedRoot, resolvedArtifact);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${artifactPath} resolves outside ${allowedRoot}.`);
  }
};

const resolveReviewArtifact = async (params: {
  repoRoot: string;
  artifactPath: unknown;
  fieldName: string;
  allowOcrLog?: boolean;
}): Promise<string> => {
  if (
    typeof params.artifactPath !== 'string' ||
    params.artifactPath.trim() === ''
  ) {
    throw new Error(`${params.fieldName} is missing.`);
  }
  const supplied = params.artifactPath.trim();
  let absolutePath: string;
  let allowedRoot: string;
  if (path.isAbsolute(supplied)) {
    if (!params.allowOcrLog) {
      throw new Error(`${params.fieldName} must be repository-relative.`);
    }
    absolutePath = path.resolve(supplied);
    allowedRoot = '/app/logs/open-code-review';
    const lexicalRelative = path.relative(allowedRoot, absolutePath);
    if (
      lexicalRelative === '..' ||
      lexicalRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(lexicalRelative)
    ) {
      throw new Error(`${params.fieldName} is outside the OCR log root.`);
    }
  } else {
    absolutePath = resolveContainedReviewArtifactPath({
      repoRoot: params.repoRoot,
      relativePath: supplied,
    });
    allowedRoot = path.join(params.repoRoot, 'codeInfoTmp', 'reviews');
  }
  await fs.access(absolutePath, fsConstants.R_OK);
  await assertRealPathContained(allowedRoot, absolutePath);
  return absolutePath;
};

const referencedArtifactFields = (pointerKey: string): string[] => {
  if (pointerKey === 'current-review') {
    return ['evidence_file', 'findings_file'];
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

const CURRENT_REPOSITORY_FIELDS = [
  'repo_alias',
  'repo_root',
  'branch',
  'logical_base_branch',
  'resolved_base_branch',
  'resolved_base_source',
  'remote_name',
  'remote_fetch_status',
  'local_fallback_reason',
  'comparison_base_ref',
  'comparison_base_commit',
  'comparison_head_ref',
  'comparison_rule',
  'head_commit',
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

type DeclaredRepositoryScope = {
  resolvedPaths: string[];
  unresolvedPaths: string[];
  errors: string[];
};

const readAdditionalRepositoryPaths = (
  currentPlan: ReviewPointer,
): { paths: string[]; errors: string[] } => {
  const additional = currentPlan.additional_repositories;
  if (additional === undefined) return { paths: [], errors: [] };
  if (!Array.isArray(additional)) {
    return {
      paths: [],
      errors: ['current-plan.additional_repositories must be an array.'],
    };
  }
  const paths: string[] = [];
  const errors: string[] = [];
  additional.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(
        `current-plan.additional_repositories[${index}] must be an object.`,
      );
      return;
    }
    const repositoryPath = (entry as ReviewPointer).path;
    if (typeof repositoryPath !== 'string' || repositoryPath.trim() === '') {
      errors.push(
        `current-plan.additional_repositories[${index}].path is missing.`,
      );
      return;
    }
    paths.push(repositoryPath.trim());
  });
  return { paths, errors };
};

const resolveDeclaredRepositoryScope = async (
  repoRoot: string,
  currentPlan: ReviewPointer,
): Promise<DeclaredRepositoryScope> => {
  const currentRepositoryPath = await fs.realpath(repoRoot);
  const additional = readAdditionalRepositoryPaths(currentPlan);
  const resolvedPaths = [currentRepositoryPath];
  const unresolvedPaths: string[] = [];
  const errors = [...additional.errors];
  for (const repositoryPath of additional.paths) {
    try {
      const mappedPath =
        await resolveWorkingFolderWorkingDirectory(repositoryPath);
      if (!mappedPath) {
        throw new Error('repository path could not be resolved');
      }
      resolvedPaths.push(await fs.realpath(mappedPath));
    } catch (error) {
      unresolvedPaths.push(repositoryPath);
      const reason =
        typeof (error as { reason?: unknown } | undefined)?.reason === 'string'
          ? (error as { reason: string }).reason
          : error instanceof Error
            ? error.message
            : 'repository path could not be resolved';
      errors.push(
        `current-plan additional repository ${repositoryPath} could not be resolved: ${reason}.`,
      );
    }
  }
  return {
    resolvedPaths: [...new Set(resolvedPaths)],
    unresolvedPaths: [...new Set(unresolvedPaths)],
    errors,
  };
};

const assertAdditionalRepositoryScope = async (params: {
  repositoryPath: string;
  pointer: ReviewPointer;
  signal?: AbortSignal;
}): Promise<void> => {
  const [branch, headCommit] = await Promise.all([
    gitStdout(
      params.repositoryPath,
      ['branch', '--show-current'],
      params.signal,
    ),
    gitStdout(
      params.repositoryPath,
      ['rev-parse', 'HEAD^{commit}'],
      params.signal,
    ),
  ]);
  if (params.pointer.branch !== branch) {
    throw new Error(
      `current-review repository ${params.repositoryPath} branch does not match Git.`,
    );
  }
  if (params.pointer.head_commit !== headCommit) {
    throw new Error(
      `current-review repository ${params.repositoryPath} head_commit does not match Git.`,
    );
  }
  const comparisonBaseCommit = nonEmptyString(
    params.pointer.comparison_base_commit,
    `current-review repository ${params.repositoryPath}.comparison_base_commit`,
  );
  const comparisonBaseRef = nonEmptyString(
    params.pointer.comparison_base_ref,
    `current-review repository ${params.repositoryPath}.comparison_base_ref`,
  );
  const resolvedBaseBranch = nonEmptyString(
    params.pointer.resolved_base_branch,
    `current-review repository ${params.repositoryPath}.resolved_base_branch`,
  );
  nonEmptyString(
    params.pointer.logical_base_branch,
    `current-review repository ${params.repositoryPath}.logical_base_branch`,
  );
  const resolvedBaseSource = nonEmptyString(
    params.pointer.resolved_base_source,
    `current-review repository ${params.repositoryPath}.resolved_base_source`,
  );
  const remoteName = nonEmptyString(
    params.pointer.remote_name,
    `current-review repository ${params.repositoryPath}.remote_name`,
  );
  const remoteFetchStatus = nonEmptyString(
    params.pointer.remote_fetch_status,
    `current-review repository ${params.repositoryPath}.remote_fetch_status`,
  );
  if (
    resolvedBaseSource !== 'remote' &&
    resolvedBaseSource !== 'local_fallback'
  ) {
    throw new Error(
      `current-review repository ${params.repositoryPath} resolved_base_source is invalid.`,
    );
  }
  if (
    resolvedBaseSource === 'remote' &&
    ((remoteFetchStatus !== 'success' &&
      remoteFetchStatus !== 'fetch_failed') ||
      params.pointer.local_fallback_reason !== null)
  ) {
    throw new Error(
      `current-review repository ${params.repositoryPath} remote base metadata is invalid.`,
    );
  }
  if (
    resolvedBaseSource === 'local_fallback' &&
    (params.pointer.local_fallback_reason !== remoteFetchStatus ||
      (remoteFetchStatus !== 'missing_remote' &&
        remoteFetchStatus !== 'fetch_failed' &&
        remoteFetchStatus !== 'missing_remote_ref'))
  ) {
    throw new Error(
      `current-review repository ${params.repositoryPath} local fallback metadata is invalid.`,
    );
  }
  const reviewedBranchRefs = new Set([
    'HEAD',
    branch,
    `refs/heads/${branch}`,
    `${remoteName}/${branch}`,
    `refs/remotes/${remoteName}/${branch}`,
  ]);
  if (reviewedBranchRefs.has(comparisonBaseRef)) {
    throw new Error(
      `current-review repository ${params.repositoryPath} comparison_base_ref points at the reviewed branch.`,
    );
  }
  const resolvedBaseRefs =
    resolvedBaseSource === 'remote'
      ? new Set([
          `${remoteName}/${resolvedBaseBranch}`,
          `refs/remotes/${remoteName}/${resolvedBaseBranch}`,
        ])
      : new Set([resolvedBaseBranch, `refs/heads/${resolvedBaseBranch}`]);
  if (!resolvedBaseRefs.has(comparisonBaseRef)) {
    throw new Error(
      `current-review repository ${params.repositoryPath} comparison_base_ref does not match resolved_base_branch.`,
    );
  }
  if (params.pointer.comparison_head_ref !== 'HEAD') {
    throw new Error(
      `current-review repository ${params.repositoryPath} comparison_head_ref must be HEAD.`,
    );
  }
  if (params.pointer.comparison_rule !== 'local_head_vs_resolved_base') {
    throw new Error(
      `current-review repository ${params.repositoryPath} comparison_rule is invalid.`,
    );
  }
  const resolvedComparisonBaseCommit = await gitStdout(
    params.repositoryPath,
    [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${comparisonBaseRef}^{commit}`,
    ],
    params.signal,
  );
  if (resolvedComparisonBaseCommit !== comparisonBaseCommit) {
    throw new Error(
      `current-review repository ${params.repositoryPath} comparison_base_commit does not match comparison_base_ref.`,
    );
  }
};

const assertMainRepositoryScope = async (params: {
  expected: PreparedReviewBase;
  pointer: ReviewPointer;
  repoRoot: string;
  declaredRepositoryScope: DeclaredRepositoryScope;
  signal?: AbortSignal;
}): Promise<void> => {
  const { expected, pointer } = params;
  if (params.declaredRepositoryScope.errors.length > 0) {
    throw new Error(params.declaredRepositoryScope.errors.join(' '));
  }
  if (!Array.isArray(pointer.repos) || pointer.repos.length === 0) {
    throw new Error('current-review.repos must contain current_repository.');
  }
  const repositoryEntries = await Promise.all(
    pointer.repos.map(async (entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`current-review.repos[${index}] is malformed.`);
      }
      const candidate = entry as ReviewPointer;
      const repositoryRoot = nonEmptyString(
        candidate.repo_root,
        `current-review.repos[${index}].repo_root`,
      );
      return {
        pointer: candidate,
        realPath: await fs.realpath(repositoryRoot),
      };
    }),
  );
  const entriesByPath = new Map<string, ReviewPointer>();
  for (const entry of repositoryEntries) {
    if (entriesByPath.has(entry.realPath)) {
      throw new Error(
        `current-review.repos contains duplicate repository ${entry.realPath}.`,
      );
    }
    entriesByPath.set(entry.realPath, entry.pointer);
  }
  if (
    entriesByPath.size !==
      params.declaredRepositoryScope.resolvedPaths.length ||
    params.declaredRepositoryScope.resolvedPaths.some(
      (repositoryPath) => !entriesByPath.has(repositoryPath),
    )
  ) {
    throw new Error(
      'current-review.repos does not match the repositories declared by current-plan.',
    );
  }
  const currentRepositoryPath = await fs.realpath(params.repoRoot);
  const currentRepository = entriesByPath.get(currentRepositoryPath);
  if (!currentRepository) {
    throw new Error('current-review.repos is missing current_repository.');
  }
  for (const field of CURRENT_REPOSITORY_FIELDS) {
    if (!valuesEqual(expected[field], currentRepository[field])) {
      throw new Error(
        `current-review.repos.current_repository.${field} does not match the prepared review scope.`,
      );
    }
  }
  await Promise.all(
    params.declaredRepositoryScope.resolvedPaths
      .filter((repositoryPath) => repositoryPath !== currentRepositoryPath)
      .map((repositoryPath) =>
        assertAdditionalRepositoryScope({
          repositoryPath,
          pointer: entriesByPath.get(repositoryPath)!,
          signal: params.signal,
        }),
      ),
  );
};

const integerField = (
  value: unknown,
  fieldName: string,
  minimum = 0,
): number => {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${fieldName} must be an integer of at least ${minimum}.`);
  }
  return value as number;
};

const nonEmptyString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} is missing.`);
  }
  return value.trim();
};

const OCR_COVERAGE_FIELDS = [
  'total_files',
  'reviewable_files',
  'reviewed_files',
  'excluded_files',
  'skipped_files',
  'failed_files',
] as const;

const resolveOcrCoverage = (params: {
  pointer: ReviewPointer;
  warnings: string[];
}): ReviewPointer => {
  const coverage = params.pointer.coverage;
  const topLevelFields = OCR_COVERAGE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(params.pointer, field),
  );
  if (coverage !== undefined) {
    if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
      throw new Error('current-open-code-review.coverage is missing.');
    }
    const coverageRecord = coverage as ReviewPointer;
    const conflictingFields = topLevelFields.filter(
      (field) =>
        !isDeepStrictEqual(params.pointer[field], coverageRecord[field]),
    );
    if (conflictingFields.length > 0) {
      throw new Error(
        `current-open-code-review coverage is ambiguous because nested and top-level values conflict for ${conflictingFields.join(', ')}.`,
      );
    }
    if (topLevelFields.length > 0) {
      params.warnings.push(
        'current-open-code-review duplicates coverage fields at the top level; nested coverage is authoritative.',
      );
    }
    return coverageRecord;
  }
  if (topLevelFields.length !== OCR_COVERAGE_FIELDS.length) {
    throw new Error('current-open-code-review.coverage is missing.');
  }
  params.warnings.push(
    'current-open-code-review uses transitional top-level coverage fields; publish them under coverage.',
  );
  return Object.fromEntries(
    OCR_COVERAGE_FIELDS.map((field) => [field, params.pointer[field]]),
  );
};

const normalizeOcrBundles = (
  value: unknown,
  fieldName: string,
  legacy: boolean,
): ReviewPointer[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} is missing.`);
  }
  return value.map((bundle, index) => {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      throw new Error(`${fieldName}[${index}] is malformed.`);
    }
    const candidate = bundle as ReviewPointer;
    return {
      bundle_id: candidate.bundle_id,
      comments_path: legacy
        ? candidate.comments_file
        : candidate.comments_path,
      validation_path: legacy
        ? candidate.validation_file
        : candidate.validation_path,
      report_path: legacy ? candidate.report_file : candidate.report_path,
    };
  });
};

const resolveOcrBundles = (params: {
  pointer: ReviewPointer;
  warnings: string[];
}): ReviewPointer[] => {
  const hasCanonical = params.pointer.bundles !== undefined;
  const hasLegacy = params.pointer.bundle_artifacts !== undefined;
  if (!hasCanonical && !hasLegacy) {
    throw new Error('current-open-code-review.bundles is missing.');
  }
  const canonical = hasCanonical
    ? normalizeOcrBundles(
        params.pointer.bundles,
        'current-open-code-review.bundles',
        false,
      )
    : undefined;
  const legacy = hasLegacy
    ? normalizeOcrBundles(
        params.pointer.bundle_artifacts,
        'current-open-code-review.bundle_artifacts',
        true,
      )
    : undefined;
  if (
    canonical !== undefined &&
    legacy !== undefined &&
    !isDeepStrictEqual(canonical, legacy)
  ) {
    throw new Error(
      'current-open-code-review bundle representations conflict.',
    );
  }
  if (legacy !== undefined) {
    params.warnings.push(
      'current-open-code-review uses transitional bundle_artifacts fields; publish canonical bundles with *_path fields.',
    );
  }
  return canonical ?? legacy ?? [];
};

const validateOcrArtifacts = async (params: {
  repoRoot: string;
  pointer: ReviewPointer;
  expected: PreparedReviewBase;
  validatedArtifactFiles: string[];
  warnings: string[];
  runOcrCommand: OcrCommandRunner;
  signal?: AbortSignal;
}): Promise<{ partial: boolean; usableBundleIds: string[] }> => {
  if (params.pointer.schema_version !== 'codeinfo-open-code-review/v1') {
    throw new Error('current-open-code-review has an unsupported schema.');
  }
  nonEmptyString(
    params.pointer.open_code_review_pass_id,
    'current-open-code-review.open_code_review_pass_id',
  );
  const manifestPath = await resolveReviewArtifact({
    repoRoot: params.repoRoot,
    artifactPath: params.pointer.manifest_path,
    fieldName: 'current-open-code-review.manifest_path',
    allowOcrLog: true,
  });
  params.validatedArtifactFiles.push(
    displayArtifactPath(params.repoRoot, manifestPath),
  );
  const manifest = await readJsonObject(manifestPath);
  const verificationDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo-ocr-validation-'),
  );
  const canonicalManifestPath = path.join(
    verificationDirectory,
    'bundle-manifest.json',
  );
  try {
    await params.runOcrCommand({
      args: [
        'agent',
        'prepare',
        '--repo',
        params.repoRoot,
        '--from',
        params.expected.comparison_base_commit,
        '--to',
        params.expected.head_commit,
        '--exclude',
        'planning/**',
        '--split',
        '--output',
        canonicalManifestPath,
      ],
      signal: params.signal,
    });
    const canonicalManifest = await readJsonObject(canonicalManifestPath);
    const manifestId = nonEmptyString(
      manifest.manifest_id,
      'OCR manifest manifest_id',
    );
    const canonicalManifestId = nonEmptyString(
      canonicalManifest.manifest_id,
      'server-generated OCR manifest manifest_id',
    );
    if (
      manifestId !== canonicalManifestId ||
      !isDeepStrictEqual(manifest, canonicalManifest)
    ) {
      throw new Error(
        'OCR manifest does not match the server-generated Git diff and exclusions.',
      );
    }
    if (manifest.schema_version !== 'codex-review-manifest/v1') {
      throw new Error('OCR manifest has an unsupported schema.');
    }
    if (!Array.isArray(manifest.bundles)) {
      throw new Error('OCR manifest bundles are missing.');
    }
    if (typeof manifest.partial !== 'boolean') {
      throw new Error('OCR manifest partial flag is missing.');
    }
    const manifestSummary = manifest.summary;
    if (
      !manifestSummary ||
      typeof manifestSummary !== 'object' ||
      Array.isArray(manifestSummary)
    ) {
      throw new Error('OCR manifest summary is missing.');
    }
    const manifestSummaryRecord = manifestSummary as ReviewPointer;
    const manifestTotalFiles = integerField(
      manifestSummaryRecord.total_files,
      'OCR manifest summary.total_files',
    );
    const manifestReviewableFiles = integerField(
      manifestSummaryRecord.reviewable_files,
      'OCR manifest summary.reviewable_files',
    );
    const manifestExcludedFiles = integerField(
      manifestSummaryRecord.excluded_files,
      'OCR manifest summary.excluded_files',
    );
    if (
      manifestReviewableFiles + manifestExcludedFiles !==
      manifestTotalFiles
    ) {
      throw new Error('OCR manifest summary counts conflict.');
    }
    if (!Array.isArray(manifest.skipped_files)) {
      throw new Error('OCR manifest skipped_files is missing.');
    }
    const expectedMergeBase = await gitStdout(
      params.repoRoot,
      [
        'merge-base',
        '--end-of-options',
        params.expected.comparison_base_commit,
        params.expected.head_commit,
      ],
      params.signal,
    );
    const manifestBundlesById = new Map<string, { reviewableFiles: number }>();
    const manifestFilePaths = new Set<string>();
    let bundleTotalFiles = 0;
    let bundleReviewableFiles = 0;
    let bundleExcludedFiles = 0;
    const manifestBundleIds = manifest.bundles.map((bundle, index) => {
      if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
        throw new Error(`OCR manifest bundle ${index} is malformed.`);
      }
      const candidate = bundle as ReviewPointer;
      const bundleId = nonEmptyString(
        candidate.bundle_id,
        `OCR manifest bundle ${index}.bundle_id`,
      );
      const target = candidate.target;
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        throw new Error(`OCR manifest bundle ${index}.target is malformed.`);
      }
      const targetRecord = target as ReviewPointer;
      if (
        targetRecord.mode !== 'range' ||
        targetRecord.from !== params.expected.comparison_base_commit ||
        targetRecord.to !== params.expected.head_commit ||
        targetRecord.base_sha !== expectedMergeBase ||
        targetRecord.merge_base_sha !== expectedMergeBase ||
        targetRecord.head_sha !== params.expected.head_commit
      ) {
        throw new Error(`OCR manifest bundle ${bundleId} is stale.`);
      }
      const summary = candidate.summary;
      if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
        throw new Error(
          `OCR manifest bundle ${bundleId}.summary is malformed.`,
        );
      }
      const summaryRecord = summary as ReviewPointer;
      const totalFiles = integerField(
        summaryRecord.total_files,
        `OCR manifest bundle ${bundleId}.summary.total_files`,
      );
      const reviewableFiles = integerField(
        summaryRecord.reviewable_files,
        `OCR manifest bundle ${bundleId}.summary.reviewable_files`,
      );
      const excludedFiles = integerField(
        summaryRecord.excluded_files,
        `OCR manifest bundle ${bundleId}.summary.excluded_files`,
      );
      if (reviewableFiles + excludedFiles !== totalFiles) {
        throw new Error(`OCR manifest bundle ${bundleId} summary conflicts.`);
      }
      if (
        !Array.isArray(candidate.files) ||
        candidate.files.length !== totalFiles
      ) {
        throw new Error(`OCR manifest bundle ${bundleId} files conflict.`);
      }
      let actualReviewableFiles = 0;
      for (const [fileIndex, file] of candidate.files.entries()) {
        if (!file || typeof file !== 'object' || Array.isArray(file)) {
          throw new Error(
            `OCR manifest bundle ${bundleId}.files[${fileIndex}] is malformed.`,
          );
        }
        const fileRecord = file as ReviewPointer;
        const filePath = nonEmptyString(
          fileRecord.path,
          `OCR manifest bundle ${bundleId}.files[${fileIndex}].path`,
        );
        if (manifestFilePaths.has(filePath)) {
          throw new Error(`OCR manifest contains duplicate file ${filePath}.`);
        }
        manifestFilePaths.add(filePath);
        if (typeof fileRecord.reviewable !== 'boolean') {
          throw new Error(
            `OCR manifest bundle ${bundleId}.files[${fileIndex}].reviewable is missing.`,
          );
        }
        const normalizedFilePath = filePath.replace(/\\/gu, '/');
        if (normalizedFilePath.startsWith('planning/')) {
          if (fileRecord.reviewable) {
            throw new Error(
              `OCR manifest marks excluded planning file ${filePath} as reviewable.`,
            );
          }
          if (
            fileRecord.patch !== '' ||
            (Array.isArray(fileRecord.hunks) && fileRecord.hunks.length > 0)
          ) {
            throw new Error(
              `OCR manifest exposes patch content for excluded planning file ${filePath}.`,
            );
          }
        }
        if (fileRecord.reviewable) actualReviewableFiles += 1;
      }
      if (actualReviewableFiles !== reviewableFiles) {
        throw new Error(
          `OCR manifest bundle ${bundleId} reviewable file count conflicts.`,
        );
      }
      if (manifestBundlesById.has(bundleId)) {
        throw new Error(`OCR manifest contains duplicate bundle ${bundleId}.`);
      }
      manifestBundlesById.set(bundleId, { reviewableFiles });
      bundleTotalFiles += totalFiles;
      bundleReviewableFiles += reviewableFiles;
      bundleExcludedFiles += excludedFiles;
      return bundleId;
    });
    if (
      bundleTotalFiles !== manifestTotalFiles ||
      bundleReviewableFiles !== manifestReviewableFiles ||
      bundleExcludedFiles !== manifestExcludedFiles
    ) {
      throw new Error(
        'OCR manifest bundle summaries conflict with its summary.',
      );
    }

    const pointerBundles = resolveOcrBundles({
      pointer: params.pointer,
      warnings: params.warnings,
    });
    const pointerBundleIds: string[] = [];
    const usableBundleIds: string[] = [];
    for (const [index, candidate] of pointerBundles.entries()) {
      const bundleId = nonEmptyString(
        candidate.bundle_id,
        `current-open-code-review.bundles[${index}].bundle_id`,
      );
      pointerBundleIds.push(bundleId);
      try {
        const commentsPath = await resolveReviewArtifact({
          repoRoot: params.repoRoot,
          artifactPath: candidate.comments_path,
          fieldName: `OCR bundle ${bundleId}.comments_path`,
          allowOcrLog: true,
        });
        const validationPath = await resolveReviewArtifact({
          repoRoot: params.repoRoot,
          artifactPath: candidate.validation_path,
          fieldName: `OCR bundle ${bundleId}.validation_path`,
          allowOcrLog: true,
        });
        const reportPath = await resolveReviewArtifact({
          repoRoot: params.repoRoot,
          artifactPath: candidate.report_path,
          fieldName: `OCR bundle ${bundleId}.report_path`,
          allowOcrLog: true,
        });
        params.validatedArtifactFiles.push(
          displayArtifactPath(params.repoRoot, commentsPath),
          displayArtifactPath(params.repoRoot, validationPath),
          displayArtifactPath(params.repoRoot, reportPath),
        );
        const [comments, validation] = await Promise.all([
          readJsonObject(commentsPath),
          readJsonObject(validationPath),
        ]);
        if (
          comments.schema_version !== 'codex-review-comments/v1' ||
          comments.bundle_id !== bundleId
        ) {
          throw new Error('comments failed schema or identity validation');
        }
        const commentsSummary = comments.summary;
        if (
          !commentsSummary ||
          typeof commentsSummary !== 'object' ||
          Array.isArray(commentsSummary)
        ) {
          throw new Error('comments summary is missing');
        }
        const reviewedFiles = integerField(
          (commentsSummary as ReviewPointer).files_reviewed,
          `OCR bundle ${bundleId}.comments.summary.files_reviewed`,
        );
        if (
          reviewedFiles !== manifestBundlesById.get(bundleId)?.reviewableFiles
        ) {
          throw new Error(
            'comments reviewed-file coverage does not match bundle',
          );
        }
        const freshValidationPath = path.join(
          verificationDirectory,
          `validation-${index}.json`,
        );
        await params.runOcrCommand({
          args: [
            'agent',
            'validate-comments',
            '--repo',
            params.repoRoot,
            '--bundle',
            canonicalManifestPath,
            '--comments',
            commentsPath,
            '--output',
            freshValidationPath,
          ],
          signal: params.signal,
        });
        const freshValidation = await readJsonObject(freshValidationPath);
        if (
          validation.schema_version !== 'codex-review-validation/v1' ||
          validation.bundle_id !== bundleId ||
          validation.valid !== true ||
          freshValidation.schema_version !== 'codex-review-validation/v1' ||
          freshValidation.bundle_id !== bundleId ||
          freshValidation.valid !== true
        ) {
          throw new Error('deterministic validation failed');
        }
        if (JSON.stringify(validation) !== JSON.stringify(freshValidation)) {
          throw new Error(
            'published validation does not match fresh server validation',
          );
        }
        const freshReportPath = path.join(
          verificationDirectory,
          `report-${index}.md`,
        );
        await params.runOcrCommand({
          args: [
            'agent',
            'report',
            '--repo',
            params.repoRoot,
            '--bundle',
            canonicalManifestPath,
            '--comments',
            commentsPath,
            '--validation',
            freshValidationPath,
            '--format',
            'markdown',
            '--output',
            freshReportPath,
          ],
          signal: params.signal,
        });
        const [publishedReport, freshReport] = await Promise.all([
          fs.readFile(reportPath, 'utf8'),
          fs.readFile(freshReportPath, 'utf8'),
        ]);
        if (publishedReport !== freshReport) {
          throw new Error(
            'published report does not match the server-rendered bundle report',
          );
        }
        usableBundleIds.push(bundleId);
      } catch (error) {
        params.warnings.push(
          `OCR bundle ${bundleId} is unusable: ${
            error instanceof Error
              ? error.message
              : 'artifact validation failed'
          }.`,
        );
      }
    }
    if (
      JSON.stringify(pointerBundleIds) !== JSON.stringify(manifestBundleIds)
    ) {
      throw new Error('OCR pointer bundles do not match the manifest.');
    }

    const coverageRecord = resolveOcrCoverage({
      pointer: params.pointer,
      warnings: params.warnings,
    });
    const totalFiles = integerField(
      coverageRecord.total_files,
      'current-open-code-review.coverage.total_files',
    );
    const reviewableFiles = integerField(
      coverageRecord.reviewable_files,
      'current-open-code-review.coverage.reviewable_files',
    );
    const reviewedFiles = integerField(
      coverageRecord.reviewed_files,
      'current-open-code-review.coverage.reviewed_files',
    );
    const excludedFiles = integerField(
      coverageRecord.excluded_files,
      'current-open-code-review.coverage.excluded_files',
    );
    const skippedFiles = integerField(
      coverageRecord.skipped_files,
      'current-open-code-review.coverage.skipped_files',
    );
    const failedFiles = integerField(
      coverageRecord.failed_files,
      'current-open-code-review.coverage.failed_files',
    );
    if (
      totalFiles !== manifestTotalFiles ||
      reviewableFiles !== manifestReviewableFiles ||
      excludedFiles !== manifestExcludedFiles ||
      skippedFiles !== manifest.skipped_files.length
    ) {
      throw new Error(
        'current-open-code-review.coverage does not match the OCR manifest.',
      );
    }
    const validatedReviewedFiles = usableBundleIds.reduce(
      (total, bundleId) =>
        total + (manifestBundlesById.get(bundleId)?.reviewableFiles ?? 0),
      0,
    );
    const validatedFailedFiles = Math.max(
      0,
      reviewableFiles - validatedReviewedFiles - skippedFiles,
    );
    const reportedCoverageMatchesValidated =
      reviewedFiles === validatedReviewedFiles &&
      failedFiles === validatedFailedFiles;
    if (!reportedCoverageMatchesValidated) {
      params.warnings.push(
        `OCR reported coverage did not match server-validated bundles; using ${validatedReviewedFiles}/${reviewableFiles} reviewed and ${validatedFailedFiles} failed.`,
      );
    }
    if (
      params.pointer.overall_validation_status !== 'valid' &&
      params.pointer.overall_validation_status !== 'partial' &&
      params.pointer.overall_validation_status !== 'invalid'
    ) {
      throw new Error(
        'current-open-code-review.overall_validation_status is invalid.',
      );
    }
    const partial =
      params.pointer.partial === true ||
      manifest.partial === true ||
      usableBundleIds.length !== pointerBundleIds.length ||
      !reportedCoverageMatchesValidated ||
      validatedReviewedFiles !== reviewableFiles ||
      skippedFiles > 0 ||
      validatedFailedFiles > 0;
    const expectedOverallStatus =
      reviewableFiles > 0 && usableBundleIds.length === 0
        ? 'invalid'
        : partial
          ? 'partial'
          : 'valid';
    if (params.pointer.overall_validation_status !== expectedOverallStatus) {
      params.warnings.push(
        `OCR overall validation status ${String(params.pointer.overall_validation_status)} conflicts with server-validated status ${expectedOverallStatus}; using ${expectedOverallStatus}.`,
      );
    }
    if (partial) {
      params.warnings.push(
        `OCR coverage is partial: ${validatedReviewedFiles}/${reviewableFiles} reviewable files, ${skippedFiles} skipped, ${validatedFailedFiles} failed.`,
      );
    }
    if (reviewableFiles > 0 && usableBundleIds.length === 0) {
      throw new Error('OCR produced no usable validated bundles.');
    }
    return { partial, usableBundleIds };
  } finally {
    await fs.rm(verificationDirectory, { recursive: true, force: true });
  }
};

const classifyFailureStatus = (
  error: unknown,
): ReviewPointerValidationStatus => {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return 'missing';
  }
  const message = error instanceof Error ? error.message : String(error);
  return /stale|does not match|mismatch|review_session_id|head_commit|branch/iu.test(
    message,
  )
    ? 'stale'
    : 'failed';
};

const gitStdout = async (
  repoRoot: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> =>
  (
    await execFile('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      signal,
    })
  ).stdout.trim();

const assertPreparedStateIsCurrent = async (params: {
  repoRoot: string;
  prepared: PreparedReviewBase;
  signal?: AbortSignal;
}): Promise<void> => {
  const [currentBranch, headCommit, resolvedRepoRoot] = await Promise.all([
    gitStdout(params.repoRoot, ['branch', '--show-current'], params.signal),
    gitStdout(params.repoRoot, ['rev-parse', 'HEAD^{commit}'], params.signal),
    fs.realpath(params.repoRoot),
  ]);
  const preparedRepoRoot = await fs.realpath(params.prepared.repo_root);
  if (
    currentBranch !== params.prepared.branch ||
    headCommit !== params.prepared.head_commit ||
    preparedRepoRoot !== resolvedRepoRoot
  ) {
    throw new Error('Prepared review base is stale or mismatched with Git.');
  }
  await loadPreparedReviewContext({
    repoRoot: params.repoRoot,
    preparedBase: params.prepared,
  });
};

const atomicWriteText = async (filePath: string, contents: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporaryPath, contents, 'utf8');
  await fs.rename(temporaryPath, filePath);
};

const createFallbackCanonicalFindings = async (params: {
  repoRoot: string;
  prepared: PreparedReviewBase;
  mainResult: ReviewPointerValidationResult;
  declaredRepositoryScope: DeclaredRepositoryScope;
}): Promise<string> => {
  const currentRepositoryPath = await fs.realpath(params.repoRoot);
  const unreviewedRepositories = [
    ...params.declaredRepositoryScope.resolvedPaths.filter(
      (repositoryPath) => repositoryPath !== currentRepositoryPath,
    ),
    ...params.declaredRepositoryScope.unresolvedPaths,
  ];
  const coverageWarnings = [
    ...params.mainResult.errors,
    ...unreviewedRepositories.map(
      (repositoryPath) =>
        `Additional repository was not covered by the surviving Codex/OCR reviews: ${repositoryPath}`,
    ),
  ];
  const relativeFindingsPath = `codeInfoTmp/reviews/${params.prepared.review_session_id}-fallback-findings.md`;
  const findingsPath = path.join(params.repoRoot, relativeFindingsPath);
  await atomicWriteText(
    findingsPath,
    [
      '# Review findings',
      '',
      'The main review pass was unavailable. This server-owned fallback remains the canonical merge target for usable Codex and Open Code Review findings.',
      '',
      '## Review coverage warnings',
      '',
      ...coverageWarnings.map((error) => `- Main review: ${error}`),
      '',
    ].join('\n'),
  );
  const currentRepository = Object.fromEntries(
    CURRENT_REPOSITORY_FIELDS.map((field) => [field, params.prepared[field]]),
  );
  await atomicWriteJson(
    buildReviewArtifactPath({
      repoRoot: params.repoRoot,
      storyId: params.prepared.story_id,
      outputKey: 'current-review',
    }),
    {
      ...params.prepared,
      schema_version: 2,
      evidence_file: null,
      findings_file: relativeFindingsPath,
      repos: [currentRepository],
      declared_repository_scope: params.declaredRepositoryScope.resolvedPaths,
      unreviewed_repositories: unreviewedRepositories,
      main_review_status: 'unavailable',
      review_coverage_warnings: coverageWarnings,
      status: 'partial',
    },
  );
  return relativeFindingsPath;
};

export async function validateReviewArtifacts(
  params: {
    workingRepositoryPath: string;
    pointerKeys: string[];
    signal?: AbortSignal;
  },
  deps: Partial<ReviewArtifactsDeps> = {},
): Promise<ReviewArtifactsValidationResult> {
  const resolvedDeps = { ...defaultDeps, ...deps };
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
  const declaredRepositoryScope = await resolveDeclaredRepositoryScope(
    repoRoot,
    currentPlan,
  );
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
  let preparedStateError: string | undefined;
  try {
    await assertPreparedStateIsCurrent({
      repoRoot,
      prepared: prepared.artifact,
      signal: params.signal,
    });
  } catch (error) {
    params.signal?.throwIfAborted();
    preparedStateError =
      error instanceof Error
        ? error.message
        : 'Prepared review state validation failed unexpectedly.';
  }

  const pointerResults: ReviewPointerValidationResult[] = [];
  for (const pointerKey of params.pointerKeys) {
    params.signal?.throwIfAborted();
    const pointerPath = buildReviewArtifactPath({
      repoRoot,
      storyId,
      outputKey: pointerKey,
    });
    const result: ReviewPointerValidationResult = {
      pointer_key: pointerKey,
      pointer_file: toPosixRelative(repoRoot, pointerPath),
      status: 'failed',
      usable: false,
      errors: [],
      warnings: [],
      validated_artifact_files: [],
      usable_bundle_ids: [],
    };
    try {
      if (preparedStateError) {
        throw new Error(preparedStateError);
      }
      const pointer = await readJsonObject(pointerPath);
      assertReviewIdentityMatches(
        expected,
        pointerIdentity(pointer, pointerKey),
        pointerKey,
      );
      assertReviewScopeMatches(prepared.artifact, pointer, pointerKey);
      if (pointer.status !== 'completed') {
        throw new Error(
          `${pointerKey} has non-complete status ${String(pointer.status)}.`,
        );
      }
      if (pointerKey === 'current-review') {
        await assertMainRepositoryScope({
          expected: prepared.artifact,
          pointer,
          repoRoot,
          declaredRepositoryScope,
          signal: params.signal,
        });
      }
      for (const field of referencedArtifactFields(pointerKey)) {
        const artifactPath = await resolveReviewArtifact({
          repoRoot,
          artifactPath: pointer[field],
          fieldName: `${pointerKey}.${field}`,
        });
        result.validated_artifact_files.push(
          displayArtifactPath(repoRoot, artifactPath),
        );
      }
      if (pointerKey === 'current-open-code-review') {
        const ocr = await validateOcrArtifacts({
          repoRoot,
          pointer,
          expected: prepared.artifact,
          validatedArtifactFiles: result.validated_artifact_files,
          warnings: result.warnings,
          runOcrCommand: resolvedDeps.runOcrCommand,
          signal: params.signal,
        });
        result.usable_bundle_ids = ocr.usableBundleIds;
        result.status = ocr.partial ? 'partial' : 'passed';
      } else {
        result.status = 'passed';
      }
      result.usable = true;
    } catch (error) {
      params.signal?.throwIfAborted();
      result.status = classifyFailureStatus(error);
      result.errors.push(
        error instanceof Error
          ? error.message
          : `${pointerKey} validation failed unexpectedly.`,
      );
    }
    pointerResults.push(result);
  }

  const usableResults = pointerResults.filter((result) => result.usable);
  const allPassed =
    pointerResults.length > 0 &&
    pointerResults.every((result) => result.status === 'passed');
  const status = allPassed
    ? 'passed'
    : usableResults.length > 0
      ? 'partial'
      : 'blocked';
  const errors = pointerResults.flatMap((result) =>
    result.errors.map((error) => `${result.pointer_key}: ${error}`),
  );
  const warnings = pointerResults.flatMap((result) =>
    result.warnings.map((warning) => `${result.pointer_key}: ${warning}`),
  );
  let fallbackFindingsFile: string | undefined;
  const mainResult = pointerResults.find(
    (result) => result.pointer_key === 'current-review',
  );
  if (
    mainResult &&
    !mainResult.usable &&
    usableResults.some((result) => result.pointer_key !== 'current-review')
  ) {
    params.signal?.throwIfAborted();
    fallbackFindingsFile = await createFallbackCanonicalFindings({
      repoRoot,
      prepared: prepared.artifact,
      mainResult,
      declaredRepositoryScope,
    });
    params.signal?.throwIfAborted();
  }

  const result: ReviewArtifactsValidationResult = {
    schema_version: 2,
    ...expected,
    pointer_files: pointerResults.map((entry) => entry.pointer_file),
    pointer_results: pointerResults,
    validated_artifact_files: [
      ...new Set(
        pointerResults.flatMap((entry) => entry.validated_artifact_files),
      ),
    ],
    ...(fallbackFindingsFile
      ? { fallback_findings_file: fallbackFindingsFile }
      : {}),
    status,
    errors,
    warnings,
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
  params.signal?.throwIfAborted();
  await Promise.all([
    atomicWriteJson(stablePath, result),
    atomicWriteJson(versionedPath, result),
  ]);
  return result;
}
