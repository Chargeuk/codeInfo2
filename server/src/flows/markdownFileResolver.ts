import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import {
  type RepoEntry,
  listIngestedRepositories,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import {
  buildRepositoryCandidateLookupSummary,
  buildRepositoryCandidateOrder,
  DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER,
  normalizeRepositoryCandidateLabel,
  type RepositoryCandidateLookupSummary,
  type RepositoryCandidateOrderEntry,
} from './repositoryCandidateOrder.js';

export const DEV_0000048_T3_MARKDOWN_RESOLUTION_ORDER =
  'DEV_0000048_T3_MARKDOWN_RESOLUTION_ORDER';

export type MarkdownFileResolutionParams = {
  markdownFile: string;
  workingRepositoryPath?: string;
  sourceId?: string;
  flowSourceId?: string;
};

export type ResolvedMarkdownFile = {
  content: string;
  lookupSummary: RepositoryCandidateLookupSummary;
  resolvedSourceId: string;
  resolvedRepositoryLabel: string;
  resolvedPath: string;
};

type MarkdownResolutionCandidate = RepositoryCandidateOrderEntry & {
  markdownRoot: string;
};

type MarkdownFileResolverDeps = {
  listIngestedRepositories: typeof listIngestedRepositories;
  readFile: (filePath: string) => Promise<Buffer>;
  append: typeof append;
  getCodeInfo2Root: () => string;
};

const decoder = new TextDecoder('utf-8', { fatal: true });

const defaultDeps: MarkdownFileResolverDeps = {
  listIngestedRepositories,
  readFile: (filePath) => fs.readFile(filePath),
  append,
  getCodeInfo2Root: () => {
    const agentsHome = process.env.CODEINFO_CODEX_AGENT_HOME?.trim();
    if (agentsHome) {
      return path.resolve(agentsHome, '..');
    }
    return path.resolve(process.cwd());
  },
};

let resolverDeps: MarkdownFileResolverDeps = defaultDeps;

export const normalizeSourceLabel = (params: {
  sourceId: string;
  sourceLabel?: string;
}) => normalizeRepositoryCandidateLabel(params);

const getResolutionScope = (
  params: MarkdownFileResolutionParams,
): 'direct-command' | 'flow-llm' | 'flow-command' => {
  if (params.flowSourceId?.trim()) {
    return params.sourceId?.trim() ? 'flow-command' : 'flow-llm';
  }
  return 'direct-command';
};

const normalizeMarkdownFile = (markdownFile: string) => {
  const trimmed = markdownFile.trim();
  if (!trimmed) {
    throw new Error('markdownFile must not be empty');
  }
  if (path.posix.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
    throw new Error(
      'markdownFile must be a relative path under codeinfo_markdown',
    );
  }

  const segments = trimmed.split(/[\\/]+/);
  if (segments.some((segment) => segment === '..')) {
    throw new Error('markdownFile must not use parent-directory traversal');
  }

  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'));
  if (!normalized || normalized === '.' || normalized.startsWith('../')) {
    throw new Error('markdownFile must resolve inside codeinfo_markdown');
  }

  return normalized;
};

const assertPathWithinRoot = (targetPath: string, rootPath: string) => {
  const relative = path.relative(rootPath, targetPath);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('markdownFile must resolve inside codeinfo_markdown');
  }
};

const buildMarkdownResolutionCandidates = (params: {
  codeInfo2Root: string;
  repos: RepoEntry[];
  ownerSourceId?: string;
  ownerSourceLabel?: string;
  resolutionScope: 'direct-command' | 'flow-llm' | 'flow-command';
  workingRepositoryPath?: string;
}) => {
  const orderedCandidates = buildRepositoryCandidateOrder({
    caller: params.resolutionScope,
    workingRepositoryPath: params.workingRepositoryPath,
    ownerRepositoryPath: params.ownerSourceId,
    ownerRepositoryLabel: params.ownerSourceLabel,
    codeInfo2Root: params.codeInfo2Root,
    otherRepositoryRoots: params.repos.map((repo) => ({
      sourceId: repo.containerPath,
      sourceLabel: repo.id,
    })),
  });

  return {
    orderedCandidates,
    candidates: orderedCandidates.candidates.map((candidate) => ({
      ...candidate,
      markdownRoot: path.join(candidate.sourceId, 'codeinfo_markdown'),
    })),
  };
};

const decodeUtf8Strict = (bytes: Uint8Array) => {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    throw new Error(
      `Invalid UTF-8 markdown content: ${(error as Error).message || 'decode failed'}`,
    );
  }
};

const isMissingFileError = (error: unknown) =>
  (error as { code?: string }).code === 'ENOENT';

const mapCandidateForLog = (candidate: RepositoryCandidateOrderEntry) => ({
  sourceId: candidate.sourceId,
  sourceLabel: candidate.sourceLabel,
  slot: candidate.slot,
});

const appendMarkdownResolutionLog = (params: {
  level: 'info' | 'warn';
  markdownFile: string;
  resolutionScope: 'direct-command' | 'flow-llm' | 'flow-command';
  flowSourceId?: string;
  ownerSourceId?: string;
  decision: 'selected' | 'fail_fast' | 'not_found';
  orderedCandidates: ReturnType<typeof buildRepositoryCandidateOrder>;
  selectedCandidate?: MarkdownResolutionCandidate;
  resolvedPath?: string;
  failureReason?: string;
  failureMessage?: string;
}) => {
  append({
    level: params.level,
    message: DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      referenceType: 'markdownFile',
      caller: params.orderedCandidates.caller,
      workingRepositoryAvailable:
        params.orderedCandidates.workingRepositoryAvailable,
      candidateRepositories:
        params.orderedCandidates.candidates.map(mapCandidateForLog),
    },
  });

  const lookupSummary = params.selectedCandidate
    ? buildRepositoryCandidateLookupSummary({
        orderedCandidates: params.orderedCandidates,
        selectedRepositoryPath: params.selectedCandidate.sourceId,
      })
    : undefined;

  append({
    level: params.level,
    message: DEV_0000048_T3_MARKDOWN_RESOLUTION_ORDER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      referenceType: 'markdownFile',
      markdownFile: params.markdownFile,
      resolutionScope: params.resolutionScope,
      flowSourceId: params.flowSourceId ?? null,
      ownerSourceId: params.ownerSourceId ?? null,
      decision: params.decision,
      selectedRepositoryPath: lookupSummary?.selectedRepositoryPath ?? null,
      selectedRepositoryLabel: params.selectedCandidate?.sourceLabel ?? null,
      selectedRepositorySlot: params.selectedCandidate?.slot ?? null,
      fallbackUsed: lookupSummary?.fallbackUsed ?? false,
      workingRepositoryAvailable:
        params.orderedCandidates.workingRepositoryAvailable,
      candidateRepositories:
        params.orderedCandidates.candidates.map(mapCandidateForLog),
      ...(params.resolvedPath ? { resolvedPath: params.resolvedPath } : {}),
      ...(params.failureReason ? { failureReason: params.failureReason } : {}),
      ...(params.failureMessage
        ? { failureMessage: params.failureMessage }
        : {}),
    },
  });
};

export async function resolveMarkdownFileWithMetadata(
  params: MarkdownFileResolutionParams,
): Promise<ResolvedMarkdownFile> {
  const normalizedMarkdownFile = normalizeMarkdownFile(params.markdownFile);
  const resolutionScope = getResolutionScope(params);
  const ownerSourceId = params.sourceId?.trim() || params.flowSourceId?.trim();
  const codeInfo2Root = resolverDeps.getCodeInfo2Root();
  const { repos } = await resolverDeps.listIngestedRepositories();
  const ownerSourceLabel = ownerSourceId
    ? repos.find(
        (repo) =>
          path.resolve(repo.containerPath) === path.resolve(ownerSourceId),
      )?.id
    : undefined;
  const { orderedCandidates, candidates } = buildMarkdownResolutionCandidates({
    codeInfo2Root,
    repos,
    ownerSourceId,
    ownerSourceLabel,
    resolutionScope,
    workingRepositoryPath: params.workingRepositoryPath,
  });

  for (const candidate of candidates) {
    const resolvedPath = path.join(
      candidate.markdownRoot,
      normalizedMarkdownFile,
    );
    assertPathWithinRoot(resolvedPath, candidate.markdownRoot);

    let bytes: Buffer;
    try {
      bytes = await resolverDeps.readFile(resolvedPath);
    } catch (error) {
      if (isMissingFileError(error)) continue;
      appendMarkdownResolutionLog({
        level: 'warn',
        markdownFile: normalizedMarkdownFile,
        resolutionScope,
        flowSourceId: params.flowSourceId,
        ownerSourceId,
        decision: 'fail_fast',
        orderedCandidates,
        selectedCandidate: candidate,
        failureReason: 'READ_FAILED',
        failureMessage: `Failed to read markdownFile ${normalizedMarkdownFile} from ${candidate.sourceId}: ${(error as Error).message}`,
      });
      throw new Error(
        `Failed to read markdownFile ${normalizedMarkdownFile} from ${candidate.sourceId}: ${(error as Error).message}`,
      );
    }

    let content: string;
    try {
      content = decodeUtf8Strict(bytes);
    } catch (error) {
      appendMarkdownResolutionLog({
        level: 'warn',
        markdownFile: normalizedMarkdownFile,
        resolutionScope,
        flowSourceId: params.flowSourceId,
        ownerSourceId,
        decision: 'fail_fast',
        orderedCandidates,
        selectedCandidate: candidate,
        failureReason: 'INVALID_UTF8',
        failureMessage:
          error instanceof Error
            ? error.message
            : 'Invalid UTF-8 markdown content',
      });
      throw error;
    }

    const lookupSummary = buildRepositoryCandidateLookupSummary({
      orderedCandidates,
      selectedRepositoryPath: candidate.sourceId,
    });
    appendMarkdownResolutionLog({
      level: 'info',
      markdownFile: normalizedMarkdownFile,
      resolutionScope,
      flowSourceId: params.flowSourceId,
      ownerSourceId,
      decision: 'selected',
      orderedCandidates,
      selectedCandidate: candidate,
      resolvedPath,
    });
    return {
      content,
      lookupSummary,
      resolvedSourceId: candidate.sourceId,
      resolvedRepositoryLabel: candidate.sourceLabel,
      resolvedPath,
    };
  }

  appendMarkdownResolutionLog({
    level: 'warn',
    markdownFile: normalizedMarkdownFile,
    resolutionScope,
    flowSourceId: params.flowSourceId,
    ownerSourceId,
    decision: 'not_found',
    orderedCandidates,
  });

  throw new Error(
    `markdownFile ${normalizedMarkdownFile} was not found in any codeinfo_markdown repository candidate`,
  );
}

export async function resolveMarkdownFile(
  params: MarkdownFileResolutionParams,
): Promise<string> {
  const resolved = await resolveMarkdownFileWithMetadata(params);
  return resolved.content;
}

export function __setMarkdownFileResolverDepsForTests(
  overrides: Partial<MarkdownFileResolverDeps>,
) {
  resolverDeps = {
    ...resolverDeps,
    ...overrides,
  };
}

export function __resetMarkdownFileResolverDepsForTests() {
  resolverDeps = defaultDeps;
}
