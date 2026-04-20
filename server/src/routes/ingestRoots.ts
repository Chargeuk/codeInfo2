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
import {
  INGEST_REPO_SCHEMA_VERSION,
  listIngestedRepositories,
} from '../lmstudio/toolService.js';
import { baseLogger } from '../logger.js';

type LockEnvelope = {
  embeddingProvider: EmbeddingProviderId;
  embeddingModel: string;
  embeddingDimensions: number;
  lockedModelId: string;
  modelId: string;
};

type RootEntry = {
  id: string;
  requestId?: string | null;
  runId?: string | null;
  queuePosition?: number | null;
  queueState?: 'waiting' | 'running' | 'cleanup-blocked' | null;
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
    provider: 'lmstudio' | 'openai' | 'ingest';
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

function logLockResolverState(
  requestId: string | undefined,
  surface: string,
  lock: LockEnvelope | null,
) {
  const lockedModelId = lock?.lockedModelId ?? null;
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

function resolveRootEmbeddingModel(
  repo: {
    queueState?: RootEntry['queueState'];
    embeddingModel?: string;
    model?: string;
  },
  lock: LockEnvelope | null,
): string {
  if (repo.queueState === 'waiting') {
    if (typeof repo.embeddingModel === 'string') {
      return repo.embeddingModel;
    }
    if (typeof repo.model === 'string') {
      return repo.model;
    }
  }

  return (
    normalizeEmbeddingModel(repo.embeddingModel) ??
    normalizeEmbeddingModel(repo.model) ??
    lock?.embeddingModel ??
    ''
  );
}

function resolveRootEmbeddingProvider(
  repo: {
    queueState?: RootEntry['queueState'];
    embeddingProvider?: EmbeddingProviderId;
    embeddingModel?: string;
    model?: string;
  },
  lock: LockEnvelope | null,
  embeddingModel: string,
): EmbeddingProviderId {
  if (
    repo.queueState === 'waiting' &&
    normalizeEmbeddingProvider(repo.embeddingProvider) !== null
  ) {
    return normalizeEmbeddingProvider(repo.embeddingProvider) ?? 'lmstudio';
  }

  return (
    normalizeEmbeddingProvider(repo.embeddingProvider) ??
    (lock && lock.embeddingModel === embeddingModel && embeddingModel.length > 0
      ? lock.embeddingProvider
      : 'lmstudio')
  );
}

function resolveRootModelId(
  repo: {
    queueState?: RootEntry['queueState'];
    modelId?: string;
  },
  embeddingModel: string,
): string {
  if (repo.queueState === 'waiting' && typeof repo.modelId === 'string') {
    return repo.modelId;
  }

  return normalizeEmbeddingModel(repo.modelId) ?? embeddingModel;
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
    const rootRunId = root.runId ?? '';
    const existingRunId = existing.runId ?? '';
    if (rootTs === existingTs && rootRunId > existingRunId) {
      bestByPath.set(root.path, root);
    }
  }

  return [...bestByPath.values()].sort((a, b) => {
    const aTs = toTimestamp(a.lastIngestAt);
    const bTs = toTimestamp(b.lastIngestAt);
    if (aTs !== bTs) return bTs - aTs;
    return (b.runId ?? '').localeCompare(a.runId ?? '');
  });
}

export function createIngestRootsRouter(deps: Partial<Deps> = {}) {
  const resolved = {
    ...DEFAULT_DEPS,
    ...deps,
  };
  const hasLegacyOverrides =
    typeof deps.getLockedModel === 'function' ||
    typeof deps.getRootsCollection === 'function';
  const router = Router();

  router.get('/ingest/roots', async (_req, res) => {
    try {
      const requestId =
        (res.locals?.requestId as string | undefined) ?? undefined;
      const payload = await listIngestedRepositories({
        getRootsCollection: resolved.getRootsCollection,
        getLockedModel: resolved.getLockedModel,
        ...(typeof deps.getLockedEmbeddingModel === 'function' ||
        (!hasLegacyOverrides &&
          typeof resolved.getLockedEmbeddingModel === 'function')
          ? { getLockedEmbeddingModel: resolved.getLockedEmbeddingModel }
          : {}),
      });
      const lock = payload.lock ?? null;
      logLockResolverState(requestId, 'ingest/roots', lock);
      const roots: RootEntry[] = payload.repos.map((repo) => {
        const embeddingModel = resolveRootEmbeddingModel(repo, lock);
        const embeddingProvider = resolveRootEmbeddingProvider(
          repo,
          lock,
          embeddingModel,
        );
        const embeddingDimensions =
          normalizeEmbeddingDimensions(repo.embeddingDimensions) ??
          (lock &&
          lock.embeddingProvider === embeddingProvider &&
          lock.embeddingModel === embeddingModel
            ? lock.embeddingDimensions
            : 0);
        const modelId = resolveRootModelId(repo, embeddingModel);
        const rootLock: LockEnvelope = {
          embeddingProvider,
          embeddingModel,
          embeddingDimensions,
          lockedModelId: embeddingModel,
          modelId: embeddingModel,
        };
        return {
          id: repo.id,
          requestId: repo.requestId ?? null,
          runId: repo.runId ?? null,
          queuePosition: repo.queuePosition ?? null,
          queueState: repo.queueState ?? null,
          name: repo.name || repo.id,
          description: repo.description,
          path: repo.containerPath,
          embeddingProvider,
          embeddingModel,
          embeddingDimensions,
          model: repo.model ?? embeddingModel,
          modelId,
          lock: rootLock,
          status: repo.status ?? 'completed',
          ...(repo.phase ? { phase: repo.phase } : {}),
          lastIngestAt: repo.lastIngestAt,
          counts: repo.counts,
          lastError: repo.lastError,
          error: repo.error,
          ast: repo.ast,
        };
      });

      res.json({
        roots,
        lock,
        lockedModelId: payload.lockedModelId,
        schemaVersion: payload.schemaVersion ?? INGEST_REPO_SCHEMA_VERSION,
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
