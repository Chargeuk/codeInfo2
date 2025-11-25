import path from 'path';
import {
  getLockedModel,
  getRootsCollection,
  getVectorsCollection,
} from '../ingest/chromaClient.js';
import { mapIngestPath } from '../ingest/pathMap.js';

export type ToolDeps = {
  getRootsCollection: typeof getRootsCollection;
  getVectorsCollection: typeof getVectorsCollection;
  getLockedModel: typeof getLockedModel;
};

export type RepoEntry = {
  id: string;
  description: string | null;
  containerPath: string;
  hostPath: string;
  hostPathWarning?: string;
  lastIngestAt: string | null;
  modelId: string;
  counts: { files: number; chunks: number; embedded: number };
  lastError: string | null;
};

export type ListReposResult = {
  repos: RepoEntry[];
  lockedModelId: string | null;
};

export type VectorSearchParams = {
  query: string;
  repository?: string;
  limit?: number;
};

export type VectorSearchResult = {
  results: {
    repo: string;
    relPath: string;
    containerPath: string;
    hostPath: string;
    hostPathWarning?: string;
    score: number | null;
    chunk: string;
    chunkId: string;
    modelId: string;
  }[];
  modelId: string | null;
};

export class RepoNotFoundError extends Error {
  code = 'REPO_NOT_FOUND' as const;
  constructor(public repo: string) {
    super('REPO_NOT_FOUND');
    this.name = 'RepoNotFoundError';
  }
}

export class ValidationError extends Error {
  code = 'VALIDATION_FAILED' as const;
  constructor(public details: string[]) {
    super('VALIDATION_FAILED');
    this.name = 'ValidationError';
  }
}

export function validateVectorSearch(body: {
  query?: unknown;
  repository?: unknown;
  limit?: unknown;
}): { query: string; repository?: string; limit: number } {
  const errors: string[] = [];
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) errors.push('query is required');

  let repository: string | undefined;
  if (body.repository !== undefined) {
    if (typeof body.repository === 'string' && body.repository.trim()) {
      repository = body.repository.trim();
    } else {
      errors.push('repository must be a non-empty string when provided');
    }
  }

  let limit = 5;
  if (body.limit !== undefined) {
    if (typeof body.limit === 'number' && Number.isInteger(body.limit)) {
      limit = Math.min(Math.max(body.limit, 1), 20);
    } else {
      errors.push('limit must be an integer');
    }
  }

  if (errors.length) {
    throw new ValidationError(errors);
  }

  return { query, repository, limit };
}

function buildRepoId(
  name: string | null,
  containerPath: string,
  fallback: string,
): string {
  if (name?.trim()) return name.trim();
  const normalized = containerPath.replace(/\\/g, '/');
  const base = path.posix.basename(normalized);
  return base || fallback;
}

type RootsGetter = {
  get: (opts: {
    include?: string[];
    limit?: number;
    where?: Record<string, unknown>;
  }) => Promise<{
    ids?: string[];
    metadatas?: Record<string, unknown>[];
  }>;
};

type ChromaQueryable = {
  query: (opts: {
    queryTexts: string[];
    where?: Record<string, unknown>;
    nResults?: number;
  }) => Promise<{
    ids?: string[][];
    distances?: number[][];
    documents?: string[][];
    metadatas?: Record<string, unknown>[][];
    scores?: number[][];
  }>;
};

function resolveDeps(partial: Partial<ToolDeps>): ToolDeps {
  return {
    getRootsCollection,
    getVectorsCollection,
    getLockedModel,
    ...partial,
  } satisfies ToolDeps;
}

export async function listIngestedRepositories(
  deps: Partial<ToolDeps> = {},
): Promise<ListReposResult> {
  const { getRootsCollection: rootsCollection, getLockedModel: lockedModel } =
    resolveDeps(deps);

  const collection = await rootsCollection();
  const raw = await (collection as unknown as RootsGetter).get({
    include: ['metadatas'],
    limit: 1000,
  });

  const metadatas = Array.isArray(raw?.metadatas) ? raw.metadatas : [];
  const ids = Array.isArray(raw?.ids) ? raw.ids : [];

  const repos: RepoEntry[] = metadatas
    .map((meta, idx) => {
      const m = (meta ?? {}) as Record<string, unknown>;
      const rawPath = typeof m.root === 'string' ? m.root : '';
      const mapped = mapIngestPath(rawPath);
      const repoId = buildRepoId(
        typeof m.name === 'string' ? m.name : null,
        rawPath,
        typeof ids[idx] === 'string' ? ids[idx] : `repo-${idx}`,
      );
      return {
        id: repoId,
        description: typeof m.description === 'string' ? m.description : null,
        containerPath: mapped.containerPath,
        hostPath: mapped.hostPath,
        ...(mapped.hostPathWarning
          ? { hostPathWarning: mapped.hostPathWarning }
          : {}),
        lastIngestAt:
          typeof m.lastIngestAt === 'string' ? m.lastIngestAt : null,
        modelId: typeof m.model === 'string' ? m.model : '',
        counts: {
          files: Number(m.files ?? 0),
          chunks: Number(m.chunks ?? 0),
          embedded: Number(m.embedded ?? 0),
        },
        lastError:
          typeof m.lastError === 'string'
            ? m.lastError
            : m.lastError === null
              ? null
              : null,
      } satisfies RepoEntry;
    })
    .sort((a, b) => {
      const aTs = a.lastIngestAt ? Date.parse(a.lastIngestAt) : 0;
      const bTs = b.lastIngestAt ? Date.parse(b.lastIngestAt) : 0;
      return bTs - aTs;
    });

  const lockedModelId = (await lockedModel()) ?? null;
  return { repos, lockedModelId };
}

export async function vectorSearch(
  params: VectorSearchParams,
  deps: Partial<ToolDeps> = {},
): Promise<VectorSearchResult> {
  const { query, repository, limit } = params;
  const resolvedLimit = Math.min(Math.max(limit ?? 5, 1), 20);
  const {
    getRootsCollection: rootsCollection,
    getVectorsCollection,
    getLockedModel,
  } = resolveDeps(deps);

  const roots = await rootsCollection();
  const rawRoots = await (roots as unknown as RootsGetter).get({
    include: ['metadatas'],
    limit: 1000,
  });

  const metadatas = Array.isArray(rawRoots?.metadatas)
    ? rawRoots.metadatas
    : [];
  const ids = Array.isArray(rawRoots?.ids) ? rawRoots.ids : [];

  const repoMeta = metadatas.map((meta, idx) => {
    const m = (meta ?? {}) as Record<string, unknown>;
    const rootPath = typeof m.root === 'string' ? m.root : '';
    const repoId = buildRepoId(
      typeof m.name === 'string' ? m.name : null,
      rootPath,
      typeof ids[idx] === 'string' ? ids[idx] : `repo-${idx}`,
    );
    return {
      id: repoId,
      root: rootPath,
      modelId: typeof m.model === 'string' ? m.model : '',
    };
  });

  let whereClause: Record<string, unknown> | undefined;
  if (repository) {
    const match = repoMeta.find((r) => r.id === repository);
    if (!match) {
      throw new RepoNotFoundError(repository);
    }
    whereClause = { root: match.root };
  }

  const collection =
    (await getVectorsCollection()) as unknown as ChromaQueryable;
  const queryResult = await collection.query({
    queryTexts: [query],
    where: whereClause,
    nResults: resolvedLimit,
  });

  const docs = Array.isArray(queryResult.documents?.[0])
    ? queryResult.documents[0]
    : [];
  const metas = Array.isArray(queryResult.metadatas?.[0])
    ? queryResult.metadatas[0]
    : [];
  const scores = Array.isArray(queryResult.distances?.[0])
    ? queryResult.distances[0]
    : Array.isArray(queryResult.scores?.[0])
      ? queryResult.scores[0]
      : [];
  const resultIds = Array.isArray(queryResult.ids?.[0])
    ? queryResult.ids[0]
    : [];

  const rootLookup = new Map<string, string>();
  repoMeta.forEach((r) => {
    if (r.root) rootLookup.set(r.root, r.id);
  });

  const results: VectorSearchResult['results'] = metas.map((meta, idx) => {
    const m = (meta ?? {}) as Record<string, unknown>;
    const rootPath = typeof m.root === 'string' ? m.root : '';
    const relPath = typeof m.relPath === 'string' ? m.relPath : '';
    const containerPath = relPath
      ? path.posix.join(
          rootPath.replace(/\\/g, '/'),
          relPath.replace(/\\/g, '/'),
        )
      : rootPath;
    const mapped = mapIngestPath(containerPath);

    const repoId = rootLookup.get(rootPath) ?? mapped.repo;
    const chunkId =
      typeof m.chunkHash === 'string'
        ? m.chunkHash
        : typeof resultIds[idx] === 'string'
          ? resultIds[idx]
          : `chunk-${idx}`;

    return {
      repo: repoId,
      relPath: mapped.relPath || relPath,
      containerPath: mapped.containerPath || containerPath,
      hostPath: mapped.hostPath,
      ...(mapped.hostPathWarning
        ? { hostPathWarning: mapped.hostPathWarning }
        : {}),
      score: typeof scores[idx] === 'number' ? scores[idx] : null,
      chunk: typeof docs[idx] === 'string' ? docs[idx] : '',
      chunkId,
      modelId: typeof m.model === 'string' ? m.model : '',
    };
  });

  const modelId = (await getLockedModel()) ?? null;
  return { results, modelId };
}
