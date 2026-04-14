import path from 'path';
import {
  INGEST_ROOTS_SCHEMA_VERSION,
  type IngestQueueState,
} from '@codeinfo2/common';
import mongoose from 'mongoose';
import {
  type EmbeddingProviderId,
  IngestRequiredError,
  generateLockedQueryEmbedding,
  getLockedEmbeddingModel,
  getLockedModel,
  getRootsCollection,
  getVectorsCollection,
} from '../ingest/chromaClient.js';
import {
  getActiveRunContexts,
  getStatus,
  type ActiveIngestRunContext,
} from '../ingest/ingestJob.js';
import { mapIngestPath } from '../ingest/pathMap.js';
import { normalizeCanonicalQueueTargetPath } from '../ingest/requestContracts.js';
import { append } from '../logStore.js';
import { baseLogger, parseNumber } from '../logger.js';
import {
  IngestQueueRequestModel,
  type IngestQueueRequest,
} from '../mongo/ingestQueueRequest.js';

export type ExternalIngestStatus =
  | 'ingesting'
  | 'completed'
  | 'cancelled'
  | 'error';
export type ExternalIngestPhase = 'queued' | 'scanning' | 'embedding';

export type ToolDeps = {
  getRootsCollection: typeof getRootsCollection;
  getVectorsCollection: typeof getVectorsCollection;
  getLockedModel: typeof getLockedModel;
  getLockedEmbeddingModel?: typeof getLockedEmbeddingModel;
  generateLockedQueryEmbedding?: typeof generateLockedQueryEmbedding;
};

export type RepoEntry = {
  id: string;
  name?: string;
  description: string | null;
  containerPath: string;
  hostPath: string;
  hostPathWarning?: string;
  lastIngestAt: string | null;
  embeddingProvider: EmbeddingProviderId;
  embeddingModel: string;
  embeddingDimensions: number;
  model?: string;
  modelId: string;
  lock?: {
    embeddingProvider: EmbeddingProviderId;
    embeddingModel: string;
    embeddingDimensions: number;
    lockedModelId: string;
    modelId: string;
  };
  counts: { files: number; chunks: number; embedded: number };
  lastError: string | null;
  requestId?: string | null;
  runId?: string | null;
  queuePosition?: number | null;
  queueState?: IngestQueueState | null;
  ast?: {
    supportedFileCount: number;
    skippedFileCount: number;
    failedFileCount: number;
    lastIndexedAt: string | null;
  };
  error?: {
    error: string;
    message: string;
    retryable: boolean;
    provider: 'lmstudio' | 'openai';
    upstreamStatus?: number;
    retryAfterMs?: number;
  } | null;
  status?: ExternalIngestStatus;
  phase?: ExternalIngestPhase;
};

export type ListReposResult = {
  repos: RepoEntry[];
  lock?: {
    embeddingProvider: EmbeddingProviderId;
    embeddingModel: string;
    embeddingDimensions: number;
    lockedModelId: string;
    modelId: string;
  } | null;
  lockedModelId: string | null;
  schemaVersion?: string;
};

export const INGEST_REPO_SCHEMA_VERSION = INGEST_ROOTS_SCHEMA_VERSION;

function parseDev0000038MarkerGate(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

export function isDev0000038MarkerGateEnabled(): boolean {
  return parseDev0000038MarkerGate(process.env.DEV_0000038_MARKERS);
}

export type RepoEmbeddingIdentity = {
  embeddingProvider: EmbeddingProviderId;
  embeddingModel: string;
  embeddingDimensions: number;
  modelId: string;
  aliasFallbackUsed: boolean;
};

function logLockResolverState(
  surface: string,
  requestId: string | undefined,
  lockedModelId: string | null,
) {
  append({
    level: 'info',
    message: 'DEV-0000036:T2:lock_resolver_source_selected',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface,
      source: 'canonical',
      lockedModelId,
    },
  });
  append({
    level: 'info',
    message: 'DEV-0000036:T2:lock_resolver_surface_parity',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface,
      embeddingProvider: 'lmstudio',
      embeddingModel: lockedModelId,
      requestId,
    },
  });
}

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
    lineCount?: number | null;
  }[];
  modelId: string | null;
  files: VectorSearchFile[];
};

export type VectorSearchFile = {
  hostPath: string;
  highestMatch: number | null;
  chunkCount: number;
  lineCount: number | null;
  hostPathWarning?: string;
  repo?: string;
  modelId?: string;
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
  if (body.repository) {
    if (typeof body.repository === 'string' && body.repository.trim()) {
      repository = body.repository.trim();
    } else {
      errors.push('repository must be a non-empty string when provided');
    }
  }

  let limit = 5;
  if (body.limit !== undefined) {
    const normalizedLimit =
      typeof body.limit === 'string' ? body.limit.trim() : body.limit;
    if (
      normalizedLimit !== '' &&
      normalizedLimit !== 0 &&
      normalizedLimit !== '0'
    ) {
      const parsedLimit =
        typeof normalizedLimit === 'string'
          ? Number(normalizedLimit)
          : normalizedLimit;
      if (typeof parsedLimit === 'number' && Number.isInteger(parsedLimit)) {
        limit = Math.min(Math.max(parsedLimit, 1), 20);
      } else {
        errors.push('limit must be an integer');
      }
    }
  }

  if (errors.length) {
    throw new ValidationError(errors);
  }

  return { query, repository, limit };
}

function buildCanonicalRepoId(repoPath: string): string {
  return buildRepoKey(mapIngestPath(repoPath).containerPath);
}

function buildRepoDisplayName(
  name: string | null,
  repoPath: string,
  fallback: string,
): string {
  if (name?.trim()) return name.trim();
  const normalized = mapIngestPath(repoPath).containerPath.replace(/\\/g, '/');
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

function parseAstMetadata(
  meta: Record<string, unknown>,
): RepoEntry['ast'] | undefined {
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
    } as RepoEntry['error'];
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

export function resolveRepoEmbeddingIdentity(
  repo: Partial<RepoEntry> & {
    lock?: {
      embeddingProvider?: EmbeddingProviderId;
      embeddingModel?: string;
      embeddingDimensions?: number;
      modelId?: string;
    };
  },
): RepoEmbeddingIdentity {
  const canonicalProvider = normalizeEmbeddingProvider(repo.embeddingProvider);
  const canonicalModel = normalizeEmbeddingModel(repo.embeddingModel);
  const canonicalDimensions = normalizeEmbeddingDimensions(
    repo.embeddingDimensions,
  );
  const lockProvider = normalizeEmbeddingProvider(repo.lock?.embeddingProvider);
  const lockModel = normalizeEmbeddingModel(repo.lock?.embeddingModel);
  const lockDimensions = normalizeEmbeddingDimensions(
    repo.lock?.embeddingDimensions,
  );
  const aliasModel =
    normalizeEmbeddingModel(repo.modelId) ??
    normalizeEmbeddingModel(repo.lock?.modelId) ??
    normalizeEmbeddingModel(repo.model) ??
    '';

  const embeddingProvider = canonicalProvider ?? lockProvider ?? 'lmstudio';
  const embeddingModel = canonicalModel ?? lockModel ?? aliasModel;
  const embeddingDimensions = canonicalDimensions ?? lockDimensions ?? 0;
  const modelId =
    normalizeEmbeddingModel(repo.modelId) ??
    normalizeEmbeddingModel(repo.lock?.modelId) ??
    embeddingModel;

  const aliasFallbackUsed = canonicalModel == null;
  return {
    embeddingProvider,
    embeddingModel,
    embeddingDimensions,
    modelId,
    aliasFallbackUsed,
  };
}

function resolveRepoLock(
  metadata: Record<string, unknown>,
  fallback: {
    embeddingProvider: EmbeddingProviderId;
    embeddingModel: string;
    embeddingDimensions: number;
  } | null,
) {
  const model =
    normalizeEmbeddingModel(metadata.embeddingModel) ??
    normalizeEmbeddingModel(metadata.model) ??
    fallback?.embeddingModel ??
    '';
  const provider =
    normalizeEmbeddingProvider(metadata.embeddingProvider) ??
    fallback?.embeddingProvider ??
    'lmstudio';
  const dimensions =
    normalizeEmbeddingDimensions(metadata.embeddingDimensions) ??
    (fallback &&
    fallback.embeddingProvider === provider &&
    fallback.embeddingModel === model
      ? fallback.embeddingDimensions
      : 0);
  return {
    embeddingProvider: provider,
    embeddingModel: model,
    embeddingDimensions: dimensions,
    lockedModelId: model,
    modelId: model,
  };
}

export function mapInternalStateToExternal(internalState: unknown): {
  status: ExternalIngestStatus;
  phase?: ExternalIngestPhase;
} {
  switch (internalState) {
    case 'queued':
    case 'scanning':
    case 'embedding':
      return { status: 'ingesting', phase: internalState };
    case 'cancelled':
      return { status: 'cancelled' };
    case 'error':
      return { status: 'error' };
    case 'completed':
    case 'skipped':
    default:
      return { status: 'completed' };
  }
}

function logStatusMapped(args: {
  sourceId: string;
  internalState: unknown;
  status: ExternalIngestStatus;
  phase?: ExternalIngestPhase;
}) {
  if (!isDev0000038MarkerGateEnabled()) {
    return;
  }
  baseLogger.info(
    {
      sourceId: args.sourceId,
      internal:
        typeof args.internalState === 'string' ? args.internalState : 'unknown',
      status: args.status,
      phase: args.phase ?? 'none',
    },
    '[DEV-0000038][T5] INGEST_LIST_STATUS_MAPPED',
  );
}

function logOverlayApplied(sourceId: string, synthesized: boolean) {
  if (!isDev0000038MarkerGateEnabled()) {
    return;
  }
  baseLogger.info(
    { sourceId, synthesized },
    '[DEV-0000038][T5] INGEST_ACTIVE_OVERLAY_APPLIED',
  );
}

function buildRepoKey(containerPath: string): string {
  return normalizeCanonicalQueueTargetPath(containerPath);
}

function buildRepoLookupKeys(
  paths: Array<string | null | undefined>,
): string[] {
  const keys = new Set<string>();

  paths.forEach((value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return;
    }
    const normalized = normalizeCanonicalQueueTargetPath(value);
    const mapped = mapIngestPath(normalized);
    keys.add(buildRepoKey(normalized));
    keys.add(buildRepoKey(mapped.containerPath));
    keys.add(buildRepoKey(mapped.hostPath));
  });

  return [...keys];
}

function indexRepoByLookupKeys(
  repoBySourceId: Map<string, RepoEntry>,
  repo: RepoEntry,
  paths: Array<string | null | undefined>,
) {
  buildRepoLookupKeys(paths).forEach((key) => {
    repoBySourceId.set(key, repo);
  });
}

function findRepoByLookupKeys(
  repoBySourceId: Map<string, RepoEntry>,
  paths: Array<string | null | undefined>,
): RepoEntry | undefined {
  for (const key of buildRepoLookupKeys(paths)) {
    const existing = repoBySourceId.get(key);
    if (existing) {
      return existing;
    }
  }
  return undefined;
}

type PersistedRepoCandidate = {
  id: string;
  idx: number;
  rawPath: string;
  canonicalPath: string;
  metadata: Record<string, unknown>;
};

function hasRawLockMetadata(metadata: Record<string, unknown>): boolean {
  return (
    normalizeEmbeddingProvider(metadata.embeddingProvider) !== null &&
    normalizeEmbeddingModel(metadata.embeddingModel) !== null &&
    normalizeEmbeddingDimensions(metadata.embeddingDimensions) !== null
  );
}

function hasRawModelMetadata(metadata: Record<string, unknown>): boolean {
  return (
    normalizeEmbeddingModel(metadata.embeddingModel) !== null ||
    normalizeEmbeddingModel(metadata.model) !== null
  );
}

function hasRawCountMetadata(metadata: Record<string, unknown>): boolean {
  return (
    typeof metadata.files === 'number' ||
    typeof metadata.chunks === 'number' ||
    typeof metadata.embedded === 'number'
  );
}

function persistedMetadataCompletenessScore(
  metadata: Record<string, unknown>,
): number {
  return (
    (hasRawLockMetadata(metadata) ? 4 : 0) +
    (hasRawModelMetadata(metadata) ? 2 : 0) +
    (hasRawCountMetadata(metadata) ? 1 : 0)
  );
}

function comparePersistedRepoCandidates(
  a: PersistedRepoCandidate,
  b: PersistedRepoCandidate,
): number {
  const scoreDiff =
    persistedMetadataCompletenessScore(a.metadata) -
    persistedMetadataCompletenessScore(b.metadata);
  if (scoreDiff !== 0) return scoreDiff;

  const aTs =
    typeof a.metadata.lastIngestAt === 'string'
      ? Date.parse(a.metadata.lastIngestAt)
      : 0;
  const bTs =
    typeof b.metadata.lastIngestAt === 'string'
      ? Date.parse(b.metadata.lastIngestAt)
      : 0;
  if (aTs !== bTs) return aTs - bTs;

  const idDiff = a.id.localeCompare(b.id);
  if (idDiff !== 0) return idDiff;

  return a.idx - b.idx;
}

function dedupePersistedRepoCandidates(
  metadatas: Record<string, unknown>[],
  ids: unknown[],
): PersistedRepoCandidate[] {
  const bestByPath = new Map<string, PersistedRepoCandidate>();

  metadatas.forEach((metadata, idx) => {
    const rawPath = typeof metadata.root === 'string' ? metadata.root : '';
    const canonicalPath = buildRepoKey(mapIngestPath(rawPath).containerPath);
    const candidate: PersistedRepoCandidate = {
      id: typeof ids[idx] === 'string' ? ids[idx] : `repo-${idx}`,
      idx,
      rawPath,
      canonicalPath,
      metadata,
    };
    const existing = bestByPath.get(canonicalPath);
    if (!existing || comparePersistedRepoCandidates(candidate, existing) > 0) {
      bestByPath.set(canonicalPath, candidate);
    }
  });

  return [...bestByPath.values()].sort((a, b) => {
    const tsDiff = comparePersistedRepoCandidates(b, a);
    if (tsDiff !== 0) return tsDiff;
    return a.canonicalPath.localeCompare(b.canonicalPath);
  });
}

function deriveQueuePayloadName(
  queueRequest: Pick<
    IngestQueueRequest,
    'canonicalTargetPath' | 'requestPayload'
  >,
) {
  const payloadName = queueRequest.requestPayload.name;
  if (typeof payloadName === 'string' && payloadName.trim().length > 0) {
    return payloadName.trim();
  }
  return path.posix.basename(queueRequest.canonicalTargetPath) || 'repo';
}

function buildRepoFromQueueRequest(params: {
  queueRequest: IngestQueueRequest;
  lock: ListReposResult['lock'];
}): RepoEntry {
  const { queueRequest, lock } = params;
  const payload = queueRequest.requestPayload;
  const queuePath =
    typeof payload.path === 'string' && payload.path.trim().length > 0
      ? payload.path.trim()
      : queueRequest.canonicalTargetPath;
  const mapped = mapIngestPath(queuePath);
  const name = deriveQueuePayloadName(queueRequest);
  const embeddingProvider =
    payload.embeddingProvider === 'lmstudio' ||
    payload.embeddingProvider === 'openai'
      ? payload.embeddingProvider
      : (lock?.embeddingProvider ?? 'lmstudio');
  const embeddingModel =
    typeof payload.embeddingModel === 'string' &&
    payload.embeddingModel.length > 0
      ? payload.embeddingModel
      : typeof payload.model === 'string'
        ? payload.model
        : (lock?.embeddingModel ?? '');
  const embeddingDimensions =
    typeof payload.embeddingDimensions === 'number'
      ? payload.embeddingDimensions
      : lock?.embeddingProvider === embeddingProvider &&
          lock.embeddingModel === embeddingModel
        ? lock.embeddingDimensions
        : 0;
  const repoLock = {
    embeddingProvider,
    embeddingModel,
    embeddingDimensions,
    lockedModelId: embeddingModel,
    modelId: embeddingModel,
  };

  return {
    id: buildCanonicalRepoId(mapped.containerPath),
    name,
    description:
      typeof payload.description === 'string' ? payload.description : null,
    containerPath: mapped.containerPath,
    hostPath: mapped.hostPath,
    ...(mapped.hostPathWarning
      ? { hostPathWarning: mapped.hostPathWarning }
      : {}),
    lastIngestAt: null,
    embeddingProvider,
    embeddingModel,
    embeddingDimensions,
    model: embeddingModel,
    modelId: embeddingModel,
    lock: repoLock,
    counts: { files: 0, chunks: 0, embedded: 0 },
    lastError: null,
    status: 'ingesting',
    phase: 'queued',
  };
}

function applyWaitingQueueRequestMetadata(
  repo: RepoEntry,
  queueRequest: IngestQueueRequest,
) {
  const payload = queueRequest.requestPayload;
  const name = deriveQueuePayloadName(queueRequest);
  const provider =
    normalizeEmbeddingProvider(payload.embeddingProvider) ??
    repo.embeddingProvider ??
    repo.lock?.embeddingProvider ??
    'lmstudio';
  const model =
    normalizeEmbeddingModel(payload.embeddingModel) ??
    normalizeEmbeddingModel(payload.model) ??
    normalizeEmbeddingModel(repo.embeddingModel) ??
    normalizeEmbeddingModel(repo.lock?.embeddingModel) ??
    normalizeEmbeddingModel(repo.modelId) ??
    normalizeEmbeddingModel(repo.model) ??
    '';
  const dimensions =
    normalizeEmbeddingDimensions(payload.embeddingDimensions) ??
    (repo.lock?.embeddingProvider === provider &&
    repo.lock.embeddingModel === model
      ? repo.lock.embeddingDimensions
      : repo.embeddingProvider === provider && repo.embeddingModel === model
        ? repo.embeddingDimensions
        : 0);

  repo.name = name;
  if (typeof payload.description === 'string') {
    repo.description = payload.description;
  }
  repo.embeddingProvider = provider;
  repo.embeddingModel = model;
  repo.embeddingDimensions = dimensions;
  repo.model = model;
  repo.modelId = model;
  repo.lock = {
    embeddingProvider: provider,
    embeddingModel: model,
    embeddingDimensions: dimensions,
    lockedModelId: model,
    modelId: model,
  };
}

function clearHealthyQueueOverlayDiagnostics(repo: RepoEntry) {
  repo.lastError = null;
  repo.error = null;
}

function getQueueOverlayPrecedence(
  queueState: IngestQueueState | null | undefined,
) {
  switch (queueState) {
    case 'cleanup-blocked':
      return 3;
    case 'running':
      return 2;
    case 'waiting':
      return 1;
    default:
      return 0;
  }
}

function shouldApplyQueueOverlay(
  repo: RepoEntry,
  queueRequest: IngestQueueRequest,
) {
  if (!repo.requestId || !repo.queueState) {
    return true;
  }

  if (repo.requestId === queueRequest._id.toString()) {
    return true;
  }

  return (
    getQueueOverlayPrecedence(queueRequest.queueState) >=
    getQueueOverlayPrecedence(repo.queueState)
  );
}

function applyQueueOverlay(params: {
  repo: RepoEntry;
  queueRequest: IngestQueueRequest;
  queuePosition: number | null;
  activeContextsByRunId: Map<string, ActiveIngestRunContext>;
}) {
  const { repo, queueRequest, queuePosition, activeContextsByRunId } = params;
  const requestId = queueRequest._id.toString();
  const activeContext =
    typeof queueRequest.runId === 'string'
      ? activeContextsByRunId.get(queueRequest.runId)
      : undefined;
  const runtimeStatus =
    typeof queueRequest.runId === 'string'
      ? getStatus(queueRequest.runId)
      : null;

  repo.requestId = requestId;
  repo.runId = queueRequest.runId ?? null;
  repo.queueState = queueRequest.queueState;
  repo.queuePosition =
    queueRequest.queueState === 'waiting' ? queuePosition : null;

  if (queueRequest.queueState === 'waiting') {
    applyWaitingQueueRequestMetadata(repo, queueRequest);
    clearHealthyQueueOverlayDiagnostics(repo);
    repo.status = 'ingesting';
    repo.phase = 'queued';
    return;
  }

  if (queueRequest.queueState === 'cleanup-blocked') {
    repo.status = 'error';
    delete repo.phase;
    if (runtimeStatus) {
      repo.counts = { ...runtimeStatus.counts };
      repo.lastError = runtimeStatus.lastError ?? 'Queue cleanup blocked';
    } else if (!repo.lastError) {
      repo.lastError = 'Queue cleanup blocked';
    }
    return;
  }

  if (activeContext) {
    const mappedState = mapInternalStateToExternal(activeContext.state);
    if (mappedState.status === 'ingesting') {
      clearHealthyQueueOverlayDiagnostics(repo);
    }
    repo.status = mappedState.status;
    if (mappedState.phase) {
      repo.phase = mappedState.phase;
    } else {
      delete repo.phase;
    }
    repo.counts = { ...activeContext.counts };
    repo.name = activeContext.name ?? repo.name;
    repo.description = activeContext.description ?? repo.description;
    return;
  }

  if (runtimeStatus) {
    const mappedState = mapInternalStateToExternal(runtimeStatus.state);
    if (mappedState.status === 'ingesting') {
      clearHealthyQueueOverlayDiagnostics(repo);
    }
    repo.status = mappedState.status;
    if (mappedState.phase) {
      repo.phase = mappedState.phase;
    } else {
      delete repo.phase;
    }
    repo.counts = { ...runtimeStatus.counts };
    repo.lastError = runtimeStatus.lastError ?? repo.lastError;
    return;
  }

  clearHealthyQueueOverlayDiagnostics(repo);
  repo.status = 'ingesting';
  repo.phase = 'queued';
}

type ChromaQueryable = {
  query: (opts: {
    queryTexts?: string[];
    queryEmbeddings?: number[][];
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
  const hasLegacyOverrides =
    typeof partial.getLockedModel === 'function' ||
    typeof partial.getVectorsCollection === 'function';
  return {
    getRootsCollection,
    getVectorsCollection,
    getLockedModel,
    getLockedEmbeddingModel: hasLegacyOverrides
      ? undefined
      : getLockedEmbeddingModel,
    generateLockedQueryEmbedding: hasLegacyOverrides
      ? undefined
      : generateLockedQueryEmbedding,
    ...partial,
  } satisfies ToolDeps;
}

function countLines(text: string | undefined): number | null {
  if (typeof text !== 'string') return null;
  if (!text.length) return 0;
  return text.split(/\r?\n/).length;
}

function resolveRetrievalConfig() {
  const rawCutoff = parseNumber(
    process.env.CODEINFO_RETRIEVAL_DISTANCE_CUTOFF,
    1.4,
  );
  const cutoff = rawCutoff >= 0 ? rawCutoff : 1.4;
  const cutoffDisabled =
    (process.env.CODEINFO_RETRIEVAL_CUTOFF_DISABLED ?? '').toLowerCase() ===
    'true';
  const fallbackRaw = parseNumber(
    process.env.CODEINFO_RETRIEVAL_FALLBACK_CHUNKS,
    2,
  );
  const fallbackChunks = fallbackRaw >= 1 ? Math.floor(fallbackRaw) : 2;

  return { cutoff, cutoffDisabled, fallbackChunks };
}

function resolvePayloadCaps() {
  const rawTotal = parseNumber(process.env.CODEINFO_TOOL_MAX_CHARS, 40_000);
  const rawChunk = parseNumber(
    process.env.CODEINFO_TOOL_CHUNK_MAX_CHARS,
    5_000,
  );
  const totalCap = rawTotal > 0 ? Math.floor(rawTotal) : 40_000;
  const chunkCap = rawChunk > 0 ? Math.floor(rawChunk) : 5_000;

  return { totalCap, chunkCap };
}

type IndexedResult = {
  item: VectorSearchResult['results'][number];
  index: number;
  score: number | null;
};

function dedupeVectorResults(items: VectorSearchResult['results']) {
  const indexed = items.map((item, index) => ({
    item,
    index,
    score: item.score,
  }));
  const deduped: IndexedResult[] = [];
  const bucketState = new Map<
    string,
    { chunkIds: Set<string>; chunks: Set<string> }
  >();

  indexed.forEach((entry) => {
    const key = `${entry.item.repo}:${entry.item.relPath}`;
    const state = bucketState.get(key) ?? {
      chunkIds: new Set(),
      chunks: new Set(),
    };
    const chunkId = entry.item.chunkId;
    const chunkText = entry.item.chunk;
    if (state.chunkIds.has(chunkId) || state.chunks.has(chunkText)) {
      bucketState.set(key, state);
      return;
    }
    state.chunkIds.add(chunkId);
    state.chunks.add(chunkText);
    bucketState.set(key, state);
    deduped.push(entry);
  });

  const grouped = new Map<string, IndexedResult[]>();
  deduped.forEach((entry) => {
    const key = `${entry.item.repo}:${entry.item.relPath}`;
    const existing = grouped.get(key) ?? [];
    existing.push(entry);
    grouped.set(key, existing);
  });

  const keepIndices = new Set<number>();
  grouped.forEach((entries) => {
    if (entries.length <= 2) {
      entries.forEach((entry) => keepIndices.add(entry.index));
      return;
    }
    const top = [...entries]
      .sort((a, b) => {
        const aScore =
          typeof a.score === 'number' ? a.score : Number.POSITIVE_INFINITY;
        const bScore =
          typeof b.score === 'number' ? b.score : Number.POSITIVE_INFINITY;
        if (aScore !== bScore) return aScore - bScore;
        return a.index - b.index;
      })
      .slice(0, 2);
    top.forEach((entry) => keepIndices.add(entry.index));
  });

  return deduped
    .filter((entry) => keepIndices.has(entry.index))
    .map((entry) => entry.item);
}

function applyPayloadCaps(
  items: VectorSearchResult['results'],
  totalCap: number,
  chunkCap: number,
) {
  let used = 0;
  const capped: VectorSearchResult['results'] = [];

  for (const item of items) {
    const chunk = item.chunk.slice(0, chunkCap);
    if (used + chunk.length > totalCap) break;
    used += chunk.length;
    capped.push({
      ...item,
      chunk,
      lineCount: countLines(chunk),
    });
  }

  return { capped, used };
}

function aggregateVectorFiles(
  items: VectorSearchResult['results'],
): VectorSearchFile[] {
  const byHostPath = new Map<string, VectorSearchFile>();

  items.forEach((item) => {
    if (!item.hostPath) return;
    const existing = byHostPath.get(item.hostPath);
    const nextLineCount =
      typeof item.lineCount === 'number' ? item.lineCount : null;
    if (!existing) {
      byHostPath.set(item.hostPath, {
        hostPath: item.hostPath,
        highestMatch: item.score ?? null,
        chunkCount: 1,
        lineCount: nextLineCount,
        hostPathWarning: item.hostPathWarning,
        repo: item.repo,
        modelId: item.modelId,
      });
      return;
    }

    existing.chunkCount += 1;
    if (typeof item.score === 'number') {
      const prev = existing.highestMatch;
      existing.highestMatch =
        prev === null ? item.score : Math.min(prev, item.score);
    }
    if (typeof existing.lineCount === 'number' && nextLineCount !== null) {
      existing.lineCount += nextLineCount;
    } else if (existing.lineCount === null && nextLineCount !== null) {
      existing.lineCount = nextLineCount;
    }
    if (!existing.hostPathWarning && item.hostPathWarning) {
      existing.hostPathWarning = item.hostPathWarning;
    }
  });

  const files = Array.from(byHostPath.values()).sort((a, b) =>
    a.hostPath.localeCompare(b.hostPath),
  );
  const numericMatches = files
    .map((file) => file.highestMatch)
    .filter((value): value is number => typeof value === 'number');
  const bestMatch =
    numericMatches.length > 0 ? Math.min(...numericMatches) : null;
  append({
    level: 'info',
    message: 'DEV-0000025:T3:min_distance_aggregation_applied',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      source: 'tool',
      bestMatch,
      fileCount: files.length,
    },
  });
  return files;
}

export async function listIngestedRepositories(
  deps: Partial<ToolDeps> = {},
): Promise<ListReposResult> {
  const {
    getRootsCollection: rootsCollection,
    getLockedModel: lockedModel,
    getLockedEmbeddingModel,
  } = resolveDeps(deps);
  const lockedFromStore =
    typeof getLockedEmbeddingModel === 'function'
      ? await getLockedEmbeddingModel()
      : null;
  const lockedModelId =
    lockedFromStore?.embeddingModel ?? (await lockedModel());
  const lock = lockedModelId
    ? {
        embeddingProvider: lockedFromStore?.embeddingProvider ?? 'lmstudio',
        embeddingModel: lockedModelId,
        embeddingDimensions: lockedFromStore?.embeddingDimensions ?? 0,
        lockedModelId,
        modelId: lockedModelId,
      }
    : null;

  const collection = await rootsCollection();
  const raw = await (collection as unknown as RootsGetter).get({
    include: ['metadatas'],
    limit: 1000,
  });

  const metadatas = Array.isArray(raw?.metadatas) ? raw.metadatas : [];
  const ids = Array.isArray(raw?.ids) ? raw.ids : [];
  const persistedCandidates = dedupePersistedRepoCandidates(
    metadatas.map((meta) => (meta ?? {}) as Record<string, unknown>),
    ids,
  );
  const repos: RepoEntry[] = persistedCandidates
    .map((candidate) => {
      const m = candidate.metadata;
      const rawPath = candidate.rawPath;
      const mapped = mapIngestPath(rawPath);
      const name =
        typeof m.name === 'string' && m.name.trim().length > 0
          ? m.name.trim()
          : buildRepoDisplayName(
              typeof m.name === 'string' ? m.name : null,
              rawPath,
              candidate.canonicalPath,
            );
      const repoId = candidate.canonicalPath;
      const repoLock = resolveRepoLock(
        m,
        lock
          ? {
              embeddingProvider: lock.embeddingProvider,
              embeddingModel: lock.embeddingModel,
              embeddingDimensions: lock.embeddingDimensions,
            }
          : null,
      );
      const sourceId = rawPath;
      const mappedState = mapInternalStateToExternal(m.state);
      logStatusMapped({
        sourceId,
        internalState: m.state,
        status: mappedState.status,
        phase: mappedState.phase,
      });
      return {
        id: repoId,
        name,
        description: typeof m.description === 'string' ? m.description : null,
        containerPath: mapped.containerPath,
        hostPath: mapped.hostPath,
        ...(mapped.hostPathWarning
          ? { hostPathWarning: mapped.hostPathWarning }
          : {}),
        lastIngestAt:
          typeof m.lastIngestAt === 'string' ? m.lastIngestAt : null,
        embeddingProvider: repoLock.embeddingProvider,
        embeddingModel: repoLock.embeddingModel,
        embeddingDimensions: repoLock.embeddingDimensions,
        model: repoLock.embeddingModel,
        modelId: repoLock.modelId,
        lock: repoLock,
        counts: {
          files: Number(m.files ?? 0),
          chunks: Number(m.chunks ?? 0),
          embedded: Number(m.embedded ?? 0),
        },
        ast: parseAstMetadata(m),
        error: parseNormalizedError(m),
        lastError:
          typeof m.lastError === 'string'
            ? m.lastError
            : m.lastError === null
              ? null
              : null,
        status: mappedState.status,
        ...(mappedState.phase ? { phase: mappedState.phase } : {}),
      } satisfies RepoEntry;
    })
    .sort((a, b) => {
      const aTs = a.lastIngestAt ? Date.parse(a.lastIngestAt) : 0;
      const bTs = b.lastIngestAt ? Date.parse(b.lastIngestAt) : 0;
      return bTs - aTs;
    });

  const repoBySourceId = new Map<string, RepoEntry>();
  repos.forEach((repo) => {
    indexRepoByLookupKeys(repoBySourceId, repo, [
      repo.containerPath,
      repo.hostPath,
    ]);
  });
  const activeContexts = getActiveRunContexts();
  const activeContextsByRunId = new Map(
    activeContexts.map((entry) => [entry.runId, entry]),
  );

  const queueRequests =
    mongoose.connection.readyState === 1
      ? await IngestQueueRequestModel.find({
          queueState: { $in: ['waiting', 'running', 'cleanup-blocked'] },
        })
          .sort({ createdAt: 1, _id: 1 })
          .exec()
      : [];
  let waitingQueuePosition = 0;

  for (const queueRequest of queueRequests) {
    const payloadPath =
      typeof queueRequest.requestPayload.path === 'string'
        ? queueRequest.requestPayload.path
        : null;
    let repo = findRepoByLookupKeys(repoBySourceId, [
      queueRequest.canonicalTargetPath,
      payloadPath,
    ]);
    if (!repo) {
      repo = buildRepoFromQueueRequest({ queueRequest, lock });
      repos.push(repo);
    }
    indexRepoByLookupKeys(repoBySourceId, repo, [
      repo.containerPath,
      repo.hostPath,
      queueRequest.canonicalTargetPath,
      payloadPath,
    ]);

    if (!shouldApplyQueueOverlay(repo, queueRequest)) {
      continue;
    }

    applyQueueOverlay({
      repo,
      queueRequest,
      queuePosition:
        queueRequest.queueState === 'waiting' ? ++waitingQueuePosition : null,
      activeContextsByRunId,
    });
  }

  for (const active of activeContexts) {
    const sourceIdRaw = active.sourceId ?? active.rootPath ?? '';
    if (!sourceIdRaw) continue;
    const normalizedSourceId = buildRepoKey(sourceIdRaw);
    const mappedState = mapInternalStateToExternal(active.state);
    const existing = findRepoByLookupKeys(repoBySourceId, [
      active.sourceId,
      active.rootPath,
    ]);
    if (existing) {
      if (
        existing.queueState === 'waiting' ||
        existing.queueState === 'cleanup-blocked'
      ) {
        continue;
      }
      existing.status = mappedState.status;
      if (mappedState.phase) {
        existing.phase = mappedState.phase;
      } else {
        delete existing.phase;
      }
      existing.counts = { ...active.counts };
      existing.runId = active.runId;
      indexRepoByLookupKeys(repoBySourceId, existing, [
        existing.containerPath,
        existing.hostPath,
        active.sourceId,
        active.rootPath,
      ]);
      logStatusMapped({
        sourceId: normalizedSourceId,
        internalState: active.state,
        status: mappedState.status,
        phase: mappedState.phase,
      });
      logOverlayApplied(normalizedSourceId, false);
      continue;
    }

    const mapped = mapIngestPath(normalizedSourceId);
    const repoLock = lock
      ? resolveRepoLock(
          {},
          {
            embeddingProvider: lock.embeddingProvider,
            embeddingModel: lock.embeddingModel,
            embeddingDimensions: lock.embeddingDimensions,
          },
        )
      : resolveRepoLock({}, null);
    const synthesizedId = buildCanonicalRepoId(mapped.containerPath);
    const synthesized: RepoEntry = {
      id: synthesizedId,
      name:
        active.name ??
        buildRepoDisplayName(null, mapped.containerPath, synthesizedId),
      description: active.description ?? null,
      containerPath: mapped.containerPath,
      hostPath: mapped.hostPath,
      ...(mapped.hostPathWarning
        ? { hostPathWarning: mapped.hostPathWarning }
        : {}),
      lastIngestAt: null,
      embeddingProvider: repoLock.embeddingProvider,
      embeddingModel: repoLock.embeddingModel,
      embeddingDimensions: repoLock.embeddingDimensions,
      model: repoLock.embeddingModel,
      modelId: repoLock.modelId,
      lock: repoLock,
      counts: { ...active.counts },
      lastError: null,
      runId: active.runId,
      status: mappedState.status,
      ...(mappedState.phase ? { phase: mappedState.phase } : {}),
    };
    repos.push(synthesized);
    indexRepoByLookupKeys(repoBySourceId, synthesized, [
      mapped.containerPath,
      mapped.hostPath,
      active.sourceId,
      active.rootPath,
    ]);
    logStatusMapped({
      sourceId: normalizedSourceId,
      internalState: active.state,
      status: mappedState.status,
      phase: mappedState.phase,
    });
    logOverlayApplied(normalizedSourceId, true);
  }

  repos.sort((a, b) => {
    const aWaiting =
      a.queueState === 'waiting' && typeof a.queuePosition === 'number'
        ? a.queuePosition
        : Number.POSITIVE_INFINITY;
    const bWaiting =
      b.queueState === 'waiting' && typeof b.queuePosition === 'number'
        ? b.queuePosition
        : Number.POSITIVE_INFINITY;
    if (aWaiting !== bWaiting) return aWaiting - bWaiting;

    const aTs = a.lastIngestAt ? Date.parse(a.lastIngestAt) : 0;
    const bTs = b.lastIngestAt ? Date.parse(b.lastIngestAt) : 0;
    if (aTs !== bTs) return bTs - aTs;
    return (a.name ?? a.id).localeCompare(b.name ?? b.id);
  });

  logLockResolverState(
    'tools/listIngestedRepositories',
    undefined,
    lock?.lockedModelId ?? null,
  );
  return {
    repos,
    lock,
    lockedModelId: lock?.lockedModelId ?? null,
    schemaVersion: INGEST_ROOTS_SCHEMA_VERSION,
  };
}

export async function vectorSearch(
  params: VectorSearchParams,
  deps: Partial<ToolDeps> = {},
): Promise<VectorSearchResult> {
  const { query, repository, limit } = params;
  const resolvedLimit = Math.min(Math.max(limit ?? 5, 1), 20);
  const { cutoff, cutoffDisabled, fallbackChunks } = resolveRetrievalConfig();
  const { totalCap, chunkCap } = resolvePayloadCaps();
  const {
    getRootsCollection: rootsCollection,
    getVectorsCollection,
    getLockedModel,
    getLockedEmbeddingModel,
    generateLockedQueryEmbedding,
  } = resolveDeps(deps);

  const lockedFromStore =
    typeof getLockedEmbeddingModel === 'function'
      ? await getLockedEmbeddingModel()
      : null;
  const lockedModelId =
    lockedFromStore?.embeddingModel ?? (await getLockedModel());
  const locked =
    lockedFromStore ??
    (lockedModelId
      ? {
          embeddingProvider: 'lmstudio' as const,
          embeddingModel: lockedModelId,
          embeddingDimensions: 0,
          lockedModelId,
          source: 'legacy' as const,
        }
      : null);
  logLockResolverState('toolService/vectorSearch', undefined, lockedModelId);
  if (!locked) {
    throw new IngestRequiredError();
  }

  const roots = await rootsCollection();
  const rawRoots = await (roots as unknown as RootsGetter).get({
    include: ['metadatas'],
    limit: 1000,
  });

  const metadatas = Array.isArray(rawRoots?.metadatas)
    ? rawRoots.metadatas
    : [];
  const repoMeta = metadatas.map((meta) => {
    const m = (meta ?? {}) as Record<string, unknown>;
    const rootPath = typeof m.root === 'string' ? m.root : '';
    const repoId = buildCanonicalRepoId(rootPath);
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

  const collection = (await getVectorsCollection({
    requireEmbedding: true,
  })) as unknown as ChromaQueryable;
  const queryResult =
    typeof generateLockedQueryEmbedding === 'function'
      ? await (async () => {
          const { embedding } = await generateLockedQueryEmbedding(query);
          return collection.query({
            queryEmbeddings: [embedding],
            where: whereClause,
            nResults: resolvedLimit,
          });
        })()
      : await collection.query({
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
  const distanceValues = Array.isArray(queryResult.distances?.[0])
    ? queryResult.distances?.[0]
    : undefined;
  const scoreValues = Array.isArray(queryResult.scores?.[0])
    ? queryResult.scores?.[0]
    : undefined;
  const scores = distanceValues ?? scoreValues ?? [];
  const scoreSource = distanceValues
    ? 'distances'
    : scoreValues
      ? 'scores'
      : 'none';
  const numericScores = scores.filter(
    (value): value is number => typeof value === 'number',
  );
  if (numericScores.length > 0) {
    const scoreMin = Math.min(...numericScores);
    const scoreMax = Math.max(...numericScores);
    baseLogger.info(
      {
        tool: 'VectorSearch',
        scoreSource,
        scoreCount: numericScores.length,
        scoreMin,
        scoreMax,
      },
      'vector search score source',
    );
  } else {
    baseLogger.info(
      { tool: 'VectorSearch', scoreSource, scoreCount: 0 },
      'vector search score source',
    );
  }
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
      lineCount: countLines(
        typeof docs[idx] === 'string' ? docs[idx] : undefined,
      ),
    };
  });

  const indexedResults = results.map((item, index) => ({
    item,
    index,
    score: item.score,
  }));
  const eligible = cutoffDisabled
    ? indexedResults
    : indexedResults.filter(
        (entry) => typeof entry.score === 'number' && entry.score <= cutoff,
      );
  let kept = eligible;
  let fallbackCount = 0;
  if (!eligible.length && indexedResults.length > 0) {
    const fallback = [...indexedResults]
      .sort((a, b) => {
        const aScore =
          typeof a.score === 'number' ? a.score : Number.POSITIVE_INFINITY;
        const bScore =
          typeof b.score === 'number' ? b.score : Number.POSITIVE_INFINITY;
        if (aScore !== bScore) return aScore - bScore;
        return a.index - b.index;
      })
      .slice(0, fallbackChunks);
    const fallbackIndices = new Set(fallback.map((entry) => entry.index));
    kept = indexedResults.filter((entry) => fallbackIndices.has(entry.index));
    fallbackCount = kept.length;
  }

  const filteredResults = kept.map((entry) => entry.item);
  const dedupedResults = dedupeVectorResults(filteredResults);
  const { capped, used } = applyPayloadCaps(dedupedResults, totalCap, chunkCap);
  append({
    level: 'info',
    message: 'DEV-0000025:T4:cutoff_filter_applied',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      cutoff,
      cutoffDisabled,
      fallbackCount,
      originalCount: results.length,
      keptCount: filteredResults.length,
    },
  });
  append({
    level: 'info',
    message: 'DEV-0000025:T5:payload_cap_applied',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      totalCap,
      chunkCap,
      keptChars: used,
      keptChunks: capped.length,
    },
  });

  const modelId = locked.embeddingModel ?? null;
  const files = aggregateVectorFiles(capped);
  return { results: capped, modelId, files };
}
