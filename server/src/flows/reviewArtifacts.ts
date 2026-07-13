import { execFile as execFileCb } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

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

const assertMainRepositoryScope = (
  expected: PreparedReviewBase,
  pointer: ReviewPointer,
): void => {
  if (!Array.isArray(pointer.repos) || pointer.repos.length === 0) {
    throw new Error('current-review.repos must contain current_repository.');
  }
  const currentRepository = pointer.repos.find(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      (entry as ReviewPointer).repo_alias === 'current_repository',
  ) as ReviewPointer | undefined;
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

const validateOcrArtifacts = async (params: {
  repoRoot: string;
  pointer: ReviewPointer;
  expected: PreparedReviewBase;
  validatedArtifactFiles: string[];
  warnings: string[];
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
  if (manifest.schema_version !== 'codex-review-manifest/v1') {
    throw new Error('OCR manifest has an unsupported schema.');
  }
  if (!Array.isArray(manifest.bundles)) {
    throw new Error('OCR manifest bundles are missing.');
  }
  if (typeof manifest.partial !== 'boolean') {
    throw new Error('OCR manifest partial flag is missing.');
  }
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
      targetRecord.base_sha !== params.expected.comparison_base_commit ||
      targetRecord.head_sha !== params.expected.head_commit
    ) {
      throw new Error(`OCR manifest bundle ${bundleId} is stale.`);
    }
    return bundleId;
  });

  if (!Array.isArray(params.pointer.bundles)) {
    throw new Error('current-open-code-review.bundles is missing.');
  }
  const pointerBundleIds: string[] = [];
  const usableBundleIds: string[] = [];
  for (const [index, bundle] of params.pointer.bundles.entries()) {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      throw new Error(
        `current-open-code-review.bundles[${index}] is malformed.`,
      );
    }
    const candidate = bundle as ReviewPointer;
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
      if (
        validation.schema_version !== 'codex-review-validation/v1' ||
        validation.bundle_id !== bundleId ||
        validation.valid !== true
      ) {
        throw new Error('deterministic validation failed');
      }
      usableBundleIds.push(bundleId);
    } catch (error) {
      params.warnings.push(
        `OCR bundle ${bundleId} is unusable: ${
          error instanceof Error ? error.message : 'artifact validation failed'
        }.`,
      );
    }
  }
  if (JSON.stringify(pointerBundleIds) !== JSON.stringify(manifestBundleIds)) {
    throw new Error('OCR pointer bundles do not match the manifest.');
  }

  const coverage = params.pointer.coverage;
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
    throw new Error('current-open-code-review.coverage is missing.');
  }
  const coverageRecord = coverage as ReviewPointer;
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
    reviewableFiles > totalFiles ||
    reviewedFiles > reviewableFiles ||
    excludedFiles > totalFiles
  ) {
    throw new Error('current-open-code-review.coverage counts conflict.');
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
    reviewedFiles !== reviewableFiles ||
    skippedFiles > 0 ||
    failedFiles > 0;
  if (partial) {
    params.warnings.push(
      `OCR coverage is partial: ${reviewedFiles}/${reviewableFiles} reviewable files, ${skippedFiles} skipped, ${failedFiles} failed.`,
    );
  }
  if (reviewableFiles > 0 && usableBundleIds.length === 0) {
    throw new Error('OCR produced no usable validated bundles.');
  }
  return { partial, usableBundleIds };
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
}): Promise<string> => {
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
      ...params.mainResult.errors.map((error) => `- Main review: ${error}`),
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
      main_review_status: 'unavailable',
      review_coverage_warnings: params.mainResult.errors,
      status: 'partial',
    },
  );
  return relativeFindingsPath;
};

export async function validateReviewArtifacts(params: {
  workingRepositoryPath: string;
  pointerKeys: string[];
  signal?: AbortSignal;
}): Promise<ReviewArtifactsValidationResult> {
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
        assertMainRepositoryScope(prepared.artifact, pointer);
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
    fallbackFindingsFile = await createFallbackCanonicalFindings({
      repoRoot,
      prepared: prepared.artifact,
      mainResult,
    });
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
  await Promise.all([
    atomicWriteJson(stablePath, result),
    atomicWriteJson(versionedPath, result),
  ]);
  return result;
}
