import { Router } from 'express';
import { LogEntry } from '@codeinfo2/common';
import { getLockedModel, getRootsCollection } from '../ingest/chromaClient.js';
import { append as appendLog } from '../logStore.js';
import { baseLogger } from '../logger.js';

type RootEntry = {
  runId: string;
  name: string;
  description: string | null;
  path: string;
  model: string;
  status: string;
  lastIngestAt: string | null;
  counts: { files: number; chunks: number; embedded: number };
  lastError: string | null;
};

function logLifecycle(message: string, context: Record<string, unknown>) {
  const entry: LogEntry = {
    level: 'info',
    source: 'server',
    message,
    timestamp: new Date().toISOString(),
    context,
  };
  appendLog(entry);
  baseLogger.info({ ...context }, message);
}

function toTimestamp(value: string | null): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

export function dedupeRootsByPath(roots: RootEntry[]): RootEntry[] {
  const bestByPath = new Map<string, RootEntry>();
  for (const root of roots) {
    const existing = bestByPath.get(root.path);
    if (!existing) {
      bestByPath.set(root.path, root);
      continue;
    }

    const rootTs = toTimestamp(root.lastIngestAt);
    const existingTs = toTimestamp(existing.lastIngestAt);
    if (rootTs > existingTs) {
      bestByPath.set(root.path, root);
      continue;
    }
    if (rootTs === existingTs && root.runId > existing.runId) {
      bestByPath.set(root.path, root);
    }
  }

  return [...bestByPath.values()].sort((a, b) => {
    const aTs = toTimestamp(a.lastIngestAt);
    const bTs = toTimestamp(b.lastIngestAt);
    if (aTs !== bTs) return bTs - aTs;
    return b.runId.localeCompare(a.runId);
  });
}

export function createIngestRootsRouter() {
  const router = Router();

  router.get('/ingest/roots', async (_req, res) => {
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

      const roots: RootEntry[] = metadatas
        .map((meta, idx) => {
          const m = (meta ?? {}) as Record<string, unknown>;
          const lastIngestAt =
            typeof m.lastIngestAt === 'string' ? m.lastIngestAt : null;
          return {
            runId: typeof ids[idx] === 'string' ? ids[idx] : `run-${idx}`,
            name: typeof m.name === 'string' ? m.name : '',
            description:
              typeof m.description === 'string' ? m.description : null,
            path: typeof m.root === 'string' ? m.root : '',
            model: typeof m.model === 'string' ? m.model : '',
            status: typeof m.state === 'string' ? m.state : 'unknown',
            lastIngestAt,
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
          } satisfies RootEntry;
        })
        .sort((a, b) => {
          const aTs = a.lastIngestAt ? Date.parse(a.lastIngestAt) : 0;
          const bTs = b.lastIngestAt ? Date.parse(b.lastIngestAt) : 0;
          return bTs - aTs;
        });

      const before = roots.length;
      const deduped = dedupeRootsByPath(roots);
      const after = deduped.length;
      if (after !== before) {
        logLifecycle('0000020 ingest roots dedupe applied', { before, after });
      }

      res.json({ roots: deduped, lockedModelId });
    } catch (err) {
      res
        .status(502)
        .json({ status: 'error', message: (err as Error).message });
    }
  });

  return router;
}
