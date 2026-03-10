import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import {
  listIngestedRepositories,
  type RepoEntry,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';

export type MarkdownFileResolutionParams = {
  markdownFile: string;
  sourceId?: string;
  flowSourceId?: string;
};

type SourceCandidate = {
  sourceId: string;
  sourceLabel: string;
};

type MarkdownResolutionCandidate = SourceCandidate & {
  rank: 'same_source' | 'codeinfo2' | 'other';
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

const normalizeAsciiLower = (value: string) => value.toLowerCase();

export const normalizeSourceLabel = (params: {
  sourceId: string;
  sourceLabel?: string;
}) => {
  const trimmed = params.sourceLabel?.trim();
  if (trimmed) return trimmed;
  return path.posix.basename(params.sourceId.replace(/\\/g, '/'));
};

export const compareSourceCandidates = (
  left: SourceCandidate,
  right: SourceCandidate,
) => {
  const leftLabel = normalizeAsciiLower(left.sourceLabel);
  const rightLabel = normalizeAsciiLower(right.sourceLabel);
  if (leftLabel < rightLabel) return -1;
  if (leftLabel > rightLabel) return 1;

  const leftPath = normalizeAsciiLower(left.sourceId);
  const rightPath = normalizeAsciiLower(right.sourceId);
  if (leftPath < rightPath) return -1;
  if (leftPath > rightPath) return 1;
  return 0;
};

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
  sameSourceId?: string;
}) => {
  const candidates: MarkdownResolutionCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (
    sourceId: string,
    sourceLabel: string | undefined,
    rank: MarkdownResolutionCandidate['rank'],
  ) => {
    const resolvedSourceId = path.resolve(sourceId);
    const key = normalizeAsciiLower(resolvedSourceId);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      sourceId: resolvedSourceId,
      sourceLabel: normalizeSourceLabel({
        sourceId: resolvedSourceId,
        sourceLabel,
      }),
      rank,
      markdownRoot: path.join(resolvedSourceId, 'codeinfo_markdown'),
    });
  };

  const resolvedCodeInfo2Root = path.resolve(params.codeInfo2Root);
  const sameSourceId = params.sameSourceId?.trim()
    ? path.resolve(params.sameSourceId)
    : undefined;
  if (sameSourceId) {
    const sameSourceRepo = params.repos.find(
      (repo) => path.resolve(repo.containerPath) === sameSourceId,
    );
    addCandidate(sameSourceId, sameSourceRepo?.id, 'same_source');
  }

  addCandidate(resolvedCodeInfo2Root, undefined, 'codeinfo2');

  const sortedOthers = params.repos
    .map((repo) => ({
      sourceId: path.resolve(repo.containerPath),
      sourceLabel: normalizeSourceLabel({
        sourceId: repo.containerPath,
        sourceLabel: repo.id,
      }),
    }))
    .filter((repo) => {
      const repoId = normalizeAsciiLower(repo.sourceId);
      return (
        repoId !== normalizeAsciiLower(resolvedCodeInfo2Root) &&
        repoId !== normalizeAsciiLower(sameSourceId ?? '')
      );
    })
    .sort(compareSourceCandidates);

  for (const repo of sortedOthers) {
    addCandidate(repo.sourceId, repo.sourceLabel, 'other');
  }

  return candidates;
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

export async function resolveMarkdownFile(
  params: MarkdownFileResolutionParams,
): Promise<string> {
  const normalizedMarkdownFile = normalizeMarkdownFile(params.markdownFile);
  const resolutionScope = getResolutionScope(params);
  const sameSourceId = params.flowSourceId?.trim() || params.sourceId?.trim();
  const codeInfo2Root = resolverDeps.getCodeInfo2Root();
  const { repos } = await resolverDeps.listIngestedRepositories();
  const candidates = buildMarkdownResolutionCandidates({
    codeInfo2Root,
    repos,
    sameSourceId,
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
      throw new Error(
        `Failed to read markdownFile ${normalizedMarkdownFile} from ${candidate.sourceId}: ${(error as Error).message}`,
      );
    }

    const content = decodeUtf8Strict(bytes);
    resolverDeps.append({
      level: 'info',
      message: 'DEV-0000045:T3:markdown_file_resolved',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        markdownFile: normalizedMarkdownFile,
        resolutionScope,
        resolvedSourceId: candidate.sourceId,
        resolvedRepositoryLabel: candidate.sourceLabel,
        resolvedPath,
      },
    });
    return content;
  }

  throw new Error(
    `markdownFile ${normalizedMarkdownFile} was not found in any codeinfo_markdown repository candidate`,
  );
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
