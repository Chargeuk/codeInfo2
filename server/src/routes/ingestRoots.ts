import { LogEntry } from '@codeinfo2/common';
import { Router } from 'express';
import {
  type EmbeddingProviderId,
  getLockedEmbeddingModel,
  getLockedModel,
  getRootsCollection,
} from '../ingest/chromaClient.js';
import {
  appendIngestFailureLog,
  classifyIngestFailure,
} from '../ingest/providers/index.js';
import { getActiveRunContexts } from '../ingest/ingestJob.js';
import {
  INGEST_REPO_SCHEMA_VERSION,
  mapInternalStateToExternal,
} from '../lmstudio/toolService.js';
import { append as appendLog } from '../logStore.js';
import { baseLogger } from '../logger.js';

type LockEnvelope = {
  embeddingProvider: EmbeddingProviderId;
  embeddingModel: string;
  embeddingDimensions: number;
  lockedModelId: string;
  modelId: string;
};

type RootEntry = {
  runId: string;
  name: string;
  description: string | null;
  path: string;
  embeddingProvider: EmbeddingProviderId;
  embeddingModel: string;
  embeddingDimensions: number;
  model: string;
  modelId: string;
  lock: LockEnvelope;
  status: string;
  phase?: string;
  lastIngestAt: string | null;
  counts: { files: number; chunks: number; embedded: number };
  lastError: string | null;
  error?: {
    error: string;
    message: string;
    retryable: boolean;
    provider: 'lmstudio' | 'openai';
    upstreamStatus?: number;
    retryAfterMs?: number;
  } | null;
  ast?: {
    supportedFileCount: number;
    skippedFileCount: number;
    failedFileCount: number;
    lastIndexedAt: string | null;
  };
};

type Deps = {
  getLockedModel: typeof getLockedModel;
  getLockedEmbeddingModel?: typeof getLockedEmbeddingModel;
  getRootsCollection: typeof getRootsCollection;
};

const DEFAULT_DEPS: Deps = {
  getLockedModel,
  getLockedEmbeddingModel,
  getRootsCollection,
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

function logLockResolverState(
  requestId: string | undefined,
  surface: string,
  lock: LockEnvelope | null,
) {
  const lockedModelId = lock?.lockedModelId ?? null;
  appendLog({
    level: 'info',
    source: 'server',
    message: 'DEV-0000036:T2:lock_resolver_source_selected',
    timestamp: new Date().toISOString(),
    context: {
      surface,
      source: 'canonical',
      lockedModelId,
    },
    requestId,
  });
  appendLog({
    level: 'info',
    source: 'server',
    message: 'DEV-0000036:T2:lock_resolver_surface_parity',
    timestamp: new Date().toISOString(),
    context: {
      surface,
      embeddingProvider: lock?.embeddingProvider ?? null,
      embeddingModel: lock?.embeddingModel ?? null,
      embeddingDimensions: lock?.embeddingDimensions ?? null,
    },
    requestId,
  });
  baseLogger.info(
    {
      requestId,
      surface,
      source: 'canonical',
      lockedModelId,
      embeddingProvider: lock?.embeddingProvider ?? null,
      embeddingModel: lock?.embeddingModel ?? null,
      embeddingDimensions: lock?.embeddingDimensions ?? null,
    },
    'lock resolver parity baseline',
  );
}

function toTimestamp(value: string | null): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function parseAstMetadata(
  meta: Record<string, unknown>,
): RootEntry['ast'] | undefined {
  const astRaw = meta.ast;
  const ast =
    astRaw && typeof astRaw === 'object'
      ? (astRaw as Record<string, unknown>)
      : {
          supportedFileCount: meta.astSupportedFileCount,
          skippedFileCount: meta.astSkippedFileCount,
          failedFileCount: meta.astFailedFileCount,
          lastIndexedAt: meta.astLastIndexedAt,
        };
  const hasAstFields =
    ast.supportedFileCount !== undefined ||
    ast.skippedFileCount !== undefined ||
    ast.failedFileCount !== undefined ||
    ast.lastIndexedAt !== undefined;
  if (!hasAstFields) return undefined;

  return {
    supportedFileCount: Number(ast.supportedFileCount ?? 0),
    skippedFileCount: Number(ast.skippedFileCount ?? 0),
    failedFileCount: Number(ast.failedFileCount ?? 0),
    lastIndexedAt:
      typeof ast.lastIndexedAt === 'string' ? ast.lastIndexedAt : null,
  };
}

function parseNormalizedError(meta: Record<string, unknown>) {
  const candidate = (
    meta.error && typeof meta.error === 'object'
      ? meta.error
      : meta.lastError && typeof meta.lastError === 'object'
        ? meta.lastError
        : null
  ) as Record<string, unknown> | null;
  if (!candidate) return null;
  const provider = candidate.provider;
  const error = candidate.error;
  const message = candidate.message;
  const retryable = candidate.retryable;
  if (
    (provider === 'openai' || provider === 'lmstudio') &&
    typeof error === 'string' &&
    typeof message === 'string' &&
    typeof retryable === 'boolean'
  ) {
    return {
      error,
      message,
      retryable,
      provider,
      ...(typeof candidate.upstreamStatus === 'number'
        ? { upstreamStatus: candidate.upstreamStatus }
        : {}),
      ...(typeof candidate.retryAfterMs === 'number'
        ? { retryAfterMs: candidate.retryAfterMs }
        : {}),
    } as RootEntry['error'];
  }
  return null;
}

function normalizeEmbeddingProvider(
  value: unknown,
): EmbeddingProviderId | null {
  if (value === 'lmstudio' || value === 'openai') return value;
  return null;
}

function normalizeEmbeddingModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmbeddingDimensions(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
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

export function createIngestRootsRouter(deps: Partial<Deps> = {}) {
  const resolved = {
    ...DEFAULT_DEPS,
    ...deps,
  };
  const router = Router();

  router.get('/ingest/roots', async (_req, res) => {
    try {
      const collection = await resolved.getRootsCollection();
      const requestId =
        (res.locals?.requestId as string | undefined) ?? undefined;
      const useCanonicalResolver =
        typeof deps.getLockedEmbeddingModel === 'function' ||
        deps.getLockedModel === undefined;
      const canonicalLock =
        useCanonicalResolver &&
        typeof resolved.getLockedEmbeddingModel === 'function'
          ? await resolved.getLockedEmbeddingModel()
          : null;
      const lockedModelId =
        canonicalLock?.embeddingModel ?? (await resolved.getLockedModel());
      const lock = lockedModelId
        ? {
            embeddingProvider: canonicalLock?.embeddingProvider ?? 'lmstudio',
            embeddingModel: lockedModelId,
            embeddingDimensions: canonicalLock?.embeddingDimensions ?? 0,
            lockedModelId,
            modelId: lockedModelId,
          }
        : null;
      logLockResolverState(requestId, 'ingest/roots', lock);
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
          const ast = parseAstMetadata(m);
          const normalizedError = parseNormalizedError(m);
          const legacyLastError =
            typeof m.lastError === 'string'
              ? m.lastError
              : typeof normalizedError?.message === 'string'
                ? normalizedError.message
                : m.lastError === null
                  ? null
                  : null;
          const embeddingModel =
            normalizeEmbeddingModel(m.embeddingModel) ??
            normalizeEmbeddingModel(m.model) ??
            lock?.embeddingModel ??
            '';
          const embeddingProvider =
            normalizeEmbeddingProvider(m.embeddingProvider) ??
            (lock &&
            lock.embeddingModel === embeddingModel &&
            embeddingModel.length > 0
              ? lock.embeddingProvider
              : 'lmstudio');
          const embeddingDimensions =
            normalizeEmbeddingDimensions(m.embeddingDimensions) ??
            (lock &&
            lock.embeddingProvider === embeddingProvider &&
            lock.embeddingModel === embeddingModel
              ? lock.embeddingDimensions
              : 0);
          const rootLock: LockEnvelope = {
            embeddingProvider,
            embeddingModel,
            embeddingDimensions,
            lockedModelId: embeddingModel,
            modelId: embeddingModel,
          };
          const external = mapInternalStateToExternal(m.state);
          baseLogger.info(
            {
              sourceId: typeof m.root === 'string' ? m.root : '',
              internal: typeof m.state === 'string' ? m.state : 'unknown',
              status: external.status,
              phase: external.phase ?? 'none',
            },
            '[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED',
          );
          return {
            runId: typeof ids[idx] === 'string' ? ids[idx] : `run-${idx}`,
            name: typeof m.name === 'string' ? m.name : '',
            description:
              typeof m.description === 'string' ? m.description : null,
            path: typeof m.root === 'string' ? m.root : '',
            embeddingProvider,
            embeddingModel,
            embeddingDimensions,
            model: embeddingModel,
            modelId: embeddingModel,
            lock: rootLock,
            status: external.status,
            ...(external.phase ? { phase: external.phase } : {}),
            lastIngestAt,
            counts: {
              files: Number(m.files ?? 0),
              chunks: Number(m.chunks ?? 0),
              embedded: Number(m.embedded ?? 0),
            },
            lastError: legacyLastError,
            error: normalizedError,
            ast,
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

      const activeByPath = new Map(
        getActiveRunContexts()
          .filter((entry) => entry.sourceId)
          .map((entry) => [entry.sourceId as string, entry]),
      );
      for (const root of deduped) {
        const active = activeByPath.get(root.path);
        if (!active) continue;
        const rootIsTerminal = root.status !== 'ingesting';
        if (rootIsTerminal && root.runId === active.runId) {
          activeByPath.delete(root.path);
          continue;
        }
        const mapped = mapInternalStateToExternal(active.state);
        root.status = mapped.status;
        if (mapped.phase) {
          root.phase = mapped.phase;
        } else {
          delete root.phase;
        }
        root.counts = { ...active.counts };
        root.runId = active.runId;
        baseLogger.info(
          {
            sourceId: root.path,
            internal: active.state,
            status: mapped.status,
            phase: mapped.phase ?? 'none',
          },
          '[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED',
        );
        baseLogger.info(
          { sourceId: root.path, synthesized: false },
          '[DEV-0000038][T5] INGEST_ACTIVE_OVERLAY_APPLIED',
        );
        activeByPath.delete(root.path);
      }

      for (const [sourceId, active] of activeByPath.entries()) {
        const mapped = mapInternalStateToExternal(active.state);
        const embeddingModel = lock?.embeddingModel ?? '';
        const embeddingProvider = lock?.embeddingProvider ?? 'lmstudio';
        const embeddingDimensions = lock?.embeddingDimensions ?? 0;
        deduped.push({
          runId: active.runId,
          name: active.name ?? '',
          description: active.description ?? null,
          path: sourceId,
          embeddingProvider,
          embeddingModel,
          embeddingDimensions,
          model: embeddingModel,
          modelId: embeddingModel,
          lock: {
            embeddingProvider,
            embeddingModel,
            embeddingDimensions,
            lockedModelId: embeddingModel,
            modelId: embeddingModel,
          },
          status: mapped.status,
          ...(mapped.phase ? { phase: mapped.phase } : {}),
          lastIngestAt: null,
          counts: { ...active.counts },
          lastError: null,
        });
        baseLogger.info(
          {
            sourceId,
            internal: active.state,
            status: mapped.status,
            phase: mapped.phase ?? 'none',
          },
          '[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED',
        );
        baseLogger.info(
          { sourceId, synthesized: true },
          '[DEV-0000038][T5] INGEST_ACTIVE_OVERLAY_APPLIED',
        );
      }
      deduped.sort((a, b) => {
        const aTs = a.lastIngestAt ? Date.parse(a.lastIngestAt) : 0;
        const bTs = b.lastIngestAt ? Date.parse(b.lastIngestAt) : 0;
        if (aTs !== bTs) return bTs - aTs;
        return b.runId.localeCompare(a.runId);
      });

      appendLog({
        level: 'info',
        source: 'server',
        message: 'DEV-0000036:T10:ingest_repo_payload_emitted',
        timestamp: new Date().toISOString(),
        requestId,
        context: {
          surface: 'ingest/roots',
          repoCount: deduped.length,
          embeddingProvider: lock?.embeddingProvider ?? null,
          embeddingModel: lock?.embeddingModel ?? null,
          embeddingDimensions: lock?.embeddingDimensions ?? null,
          aliasLockedModelIdPresent: lock?.lockedModelId != null,
          aliasModelIdPresent: lock?.modelId != null,
        },
      });
      appendLog({
        level: 'info',
        source: 'server',
        message: 'DEV-0000036:T10:ingest_repo_schema_version_emitted',
        timestamp: new Date().toISOString(),
        requestId,
        context: {
          surface: 'ingest/roots',
          schemaVersion: INGEST_REPO_SCHEMA_VERSION,
        },
      });

      res.json({
        roots: deduped,
        lock,
        lockedModelId: lock?.lockedModelId ?? null,
        schemaVersion: INGEST_REPO_SCHEMA_VERSION,
      });
    } catch (err) {
      const classified = classifyIngestFailure(err, {
        surface: 'ingest/roots',
        defaultCode: 'INGEST_ROOTS_LOOKUP_FAILED',
      });
      appendIngestFailureLog(classified.severity, {
        provider: classified.provider,
        code: classified.code,
        retryable: classified.retryable,
        message: classified.message,
        stage: 'terminal',
        surface: classified.surface,
        operation: 'roots',
        ...(typeof classified.upstreamStatus === 'number'
          ? { upstreamStatus: classified.upstreamStatus }
          : {}),
        ...(typeof classified.retryAfterMs === 'number'
          ? { retryAfterMs: classified.retryAfterMs }
          : {}),
      });
      baseLogger.error({ err }, 'ingest roots failed');
      res.status(502).json({
        status: 'error',
        code: classified.code,
        message: classified.message,
      });
    }
  });

  return router;
}
