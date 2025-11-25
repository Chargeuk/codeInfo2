import path from 'path';
import { Router } from 'express';
import { getLockedModel, getRootsCollection } from '../ingest/chromaClient.js';
import { mapIngestPath } from '../ingest/pathMap.js';

type RepoEntry = {
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

export function createToolsIngestedReposRouter() {
  const router = Router();

  router.get('/tools/ingested-repos', async (_req, res) => {
    try {
      const collection = await getRootsCollection();
      const lockedModelId = await getLockedModel();

      type CollectionGetter = {
        get: (opts: {
          include?: string[];
          limit?: number;
          where?: Record<string, unknown>;
        }) => Promise<{
          ids?: string[];
          metadatas?: Record<string, unknown>[];
        }>;
      };

      const raw = await (collection as unknown as CollectionGetter).get({
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
            description:
              typeof m.description === 'string' ? m.description : null,
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

      res.json({ repos, lockedModelId });
    } catch (err) {
      res.status(502).json({ error: 'CHROMA_UNAVAILABLE', message: `${err}` });
    }
  });

  return router;
}
