import path from 'path';
import { Router } from 'express';
import {
  getLockedModel,
  getRootsCollection,
  getVectorsCollection,
} from '../ingest/chromaClient.js';
import { mapIngestPath } from '../ingest/pathMap.js';
import { baseLogger } from '../logger.js';

type Deps = {
  getRootsCollection: typeof getRootsCollection;
  getVectorsCollection: typeof getVectorsCollection;
  getLockedModel: typeof getLockedModel;
};

type RepoMeta = {
  id: string;
  root: string;
  modelId: string;
};

type VectorSearchBody = {
  query?: unknown;
  repository?: unknown;
  limit?: unknown;
};

type QueryResult = {
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

async function loadRepoMeta(
  getRoots: typeof getRootsCollection,
): Promise<RepoMeta[]> {
  const roots = await getRoots();
  const raw = await (roots as unknown as RootsGetter).get({
    include: ['metadatas'],
    limit: 1000,
  });

  const metadatas = Array.isArray(raw?.metadatas) ? raw.metadatas : [];
  const ids = Array.isArray(raw?.ids) ? raw.ids : [];

  return metadatas.map((meta, idx) => {
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
    } satisfies RepoMeta;
  });
}

function validateBody(body: VectorSearchBody): {
  errors: string[];
  query?: string;
  repository?: string;
  limit: number;
} {
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

  return { errors, query, repository, limit };
}

export function createToolsVectorSearchRouter(
  deps: Deps = {
    getRootsCollection,
    getVectorsCollection,
    getLockedModel,
  },
) {
  const router = Router();

  router.post('/tools/vector-search', async (req, res) => {
    const validation = validateBody(req.body as VectorSearchBody);
    if (validation.errors.length > 0) {
      return res
        .status(400)
        .json({ error: 'VALIDATION_FAILED', details: validation.errors });
    }

    try {
      const repoMeta = await loadRepoMeta(deps.getRootsCollection);
      const repoMap = new Map(repoMeta.map((r) => [r.id, r]));

      let whereClause: Record<string, unknown> | undefined;
      if (validation.repository) {
        const repo = repoMap.get(validation.repository);
        if (!repo) {
          return res.status(404).json({ error: 'REPO_NOT_FOUND' });
        }
        whereClause = { root: repo.root };
      }

      const collection =
        (await deps.getVectorsCollection()) as unknown as ChromaQueryable;
      const queryResult = await collection.query({
        queryTexts: [validation.query ?? ''],
        where: whereClause,
        nResults: Math.min(validation.limit ?? 5, 20),
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
      const ids = Array.isArray(queryResult.ids?.[0]) ? queryResult.ids[0] : [];

      const rootLookup = new Map<string, string>();
      repoMeta.forEach((r) => {
        if (r.root) rootLookup.set(r.root, r.id);
      });

      const results: QueryResult['results'] = metas.map((meta, idx) => {
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
            : typeof ids[idx] === 'string'
              ? ids[idx]
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

      const modelId = (await deps.getLockedModel()) ?? null;
      const requestId =
        (res.locals?.requestId as string | undefined) ?? undefined;
      baseLogger.info(
        {
          requestId,
          repository: validation.repository ?? 'all',
          limit: validation.limit,
          results: results.length,
          modelId,
        },
        'tools vector search',
      );
      const payload: QueryResult = { results, modelId };
      return res.json(payload);
    } catch (err) {
      return res
        .status(502)
        .json({ error: 'CHROMA_UNAVAILABLE', message: `${err}` });
    }
  });

  return router;
}
