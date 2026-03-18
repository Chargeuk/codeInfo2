import {
  ChromaClient,
  type Collection,
  type EmbeddingFunction,
} from 'chromadb';
import { getClient as getLmClient } from '../lmstudio/clientPool.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import {
  createLmStudioEmbeddingProvider,
  createOpenAiEmbeddingProvider,
  isOpenAiAllowlistedEmbeddingModel,
  OpenAiEmbeddingError,
} from './providers/index.js';

function getChromaUrl(): string {
  const raw = process.env.CODEINFO_CHROMA_URL;
  if (!raw || raw.trim() === '') return 'http://localhost:8000';
  return raw;
}
type MinimalCollection = {
  modify: (opts: { metadata?: Record<string, unknown> }) => Promise<void>;
  count: () => Promise<number>;
};

export type EmbeddingProviderId = 'lmstudio' | 'openai';

export type LockedEmbeddingModel = {
  embeddingProvider: EmbeddingProviderId;
  embeddingModel: string;
  embeddingDimensions: number;
  lockedModelId: string;
  source: 'canonical' | 'legacy';
};

type LockClearReason = 'completed' | 'cleanup' | 'remove' | 'reset' | 'unknown';
const COLLECTION_VECTORS =
  process.env.CODEINFO_INGEST_COLLECTION ?? 'ingest_vectors';
const COLLECTION_ROOTS =
  process.env.CODEINFO_INGEST_ROOTS_COLLECTION ?? 'ingest_roots';

let client: ChromaClient | null = null;
let clientUrl: string | null = null;
let vectorsCollection: Collection | null = null;
let vectorsCollectionHasEmbedding = false;
let rootsCollection: Collection | null = null;
let lmClientResolver = getLmClient;

const toWebSocketUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/i, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/i, 'wss:');
  return value;
};

function toChromaClientArgs(connectionString: string): {
  host: string;
  port: number;
  ssl: boolean;
} {
  const normalized = connectionString.includes('://')
    ? connectionString
    : `http://${connectionString}`;
  const url = new URL(normalized);
  const ssl = url.protocol === 'https:';
  const port = url.port ? Number(url.port) : 8000;
  return { host: url.hostname, port, ssl };
}

async function getClient() {
  const chromaUrl = getChromaUrl();
  if (!client || clientUrl !== chromaUrl) {
    client = new ChromaClient(toChromaClientArgs(chromaUrl));
    clientUrl = chromaUrl;
  }
  return client;
}

export function setLmClientResolver(resolver: typeof getLmClient): void {
  lmClientResolver = resolver;
}

export function resetLmClientResolver(): void {
  lmClientResolver = getLmClient;
}

export class IngestRequiredError extends Error {
  code = 'INGEST_REQUIRED' as const;
  constructor(message = 'No embedding model lock found; run ingest first') {
    super(message);
    this.name = 'IngestRequiredError';
  }
}

export class EmbedModelMissingError extends Error {
  code = 'EMBED_MODEL_MISSING' as const;
  constructor(
    public modelId: string,
    cause?: unknown,
  ) {
    super(`Embedding model ${modelId} unavailable in LM Studio`);
    this.name = 'EmbedModelMissingError';
    if (cause) {
      try {
        (this as unknown as { cause?: unknown }).cause = cause;
      } catch {
        // ignore
      }
    }
  }
}

export class InvalidLockMetadataError extends Error {
  code = 'INVALID_LOCK_METADATA' as const;
  constructor(message = 'Lock metadata is invalid or partially populated') {
    super(message);
    this.name = 'InvalidLockMetadataError';
  }
}

export class EmbeddingDimensionMismatchError extends Error {
  code = 'EMBEDDING_DIMENSION_MISMATCH' as const;
  constructor(
    public expectedDimensions: number,
    public actualDimensions: number,
    public embeddingProvider: EmbeddingProviderId,
    public embeddingModel: string,
  ) {
    super(
      `Embedding dimension mismatch. Expected ${expectedDimensions}, got ${actualDimensions}`,
    );
    this.name = 'EmbeddingDimensionMismatchError';
  }
}

function normalizeEmbeddingProvider(
  value: unknown,
): EmbeddingProviderId | null {
  if (typeof value !== 'string') return null;
  const lowered = value.trim().toLowerCase();
  if (lowered === 'openai' || lowered === 'lmstudio') return lowered;
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

function parseLockedEmbeddingMetadata(
  metadata: Record<string, unknown> | undefined,
): LockedEmbeddingModel | null {
  if (!metadata) return null;

  const canonicalProviderRaw = metadata.embeddingProvider;
  const canonicalModelRaw = metadata.embeddingModel;
  const canonicalDimensionsRaw = metadata.embeddingDimensions;
  const hasAnyCanonical =
    (canonicalProviderRaw !== undefined && canonicalProviderRaw !== null) ||
    (canonicalModelRaw !== undefined && canonicalModelRaw !== null) ||
    (canonicalDimensionsRaw !== undefined && canonicalDimensionsRaw !== null);

  if (hasAnyCanonical) {
    const embeddingProvider = normalizeEmbeddingProvider(canonicalProviderRaw);
    const embeddingModel = normalizeEmbeddingModel(canonicalModelRaw);
    const embeddingDimensions = normalizeEmbeddingDimensions(
      canonicalDimensionsRaw,
    );
    if (!embeddingProvider || !embeddingModel || !embeddingDimensions) {
      throw new InvalidLockMetadataError();
    }
    return {
      embeddingProvider,
      embeddingModel,
      embeddingDimensions,
      lockedModelId: embeddingModel,
      source: 'canonical',
    };
  }

  const legacyLockedModel = normalizeEmbeddingModel(metadata.lockedModelId);
  if (!legacyLockedModel) return null;
  return {
    embeddingProvider: 'lmstudio',
    embeddingModel: legacyLockedModel,
    embeddingDimensions: 0,
    lockedModelId: legacyLockedModel,
    source: 'legacy',
  };
}

function resolveProviderFromLock(lock: LockedEmbeddingModel) {
  if (
    lock.embeddingProvider === 'openai' &&
    !isOpenAiAllowlistedEmbeddingModel(lock.embeddingModel)
  ) {
    throw new OpenAiEmbeddingError(
      'OPENAI_MODEL_UNAVAILABLE',
      'Requested OpenAI embedding model is unavailable for this deployment',
      false,
      404,
    );
  }
  const provider =
    lock.embeddingProvider === 'openai'
      ? createOpenAiEmbeddingProvider({
          apiKey: process.env.CODEINFO_OPENAI_EMBEDDING_KEY,
        })
      : createLmStudioEmbeddingProvider({
          lmClientResolver,
          baseUrl: toWebSocketUrl(process.env.CODEINFO_LMSTUDIO_BASE_URL ?? ''),
        });
  return provider;
}

async function resolveLockedEmbeddingFunction(): Promise<EmbeddingFunction> {
  const locked = await getLockedEmbeddingModel();
  if (!locked) {
    baseLogger.warn('resolveLockedEmbeddingFunction missing locked model');
    throw new IngestRequiredError();
  }

  try {
    if (
      locked.embeddingProvider === 'lmstudio' &&
      (!process.env.CODEINFO_LMSTUDIO_BASE_URL ||
        process.env.CODEINFO_LMSTUDIO_BASE_URL === '')
    ) {
      throw new Error('CODEINFO_LMSTUDIO_BASE_URL is not configured');
    }
    const provider = resolveProviderFromLock(locked);

    // Proactively verify the model exists to surface clear errors before query time.
    await provider.getModel(locked.embeddingModel);
    return await provider.createEmbeddingFunction(locked.embeddingModel);
  } catch (err) {
    if (err instanceof OpenAiEmbeddingError) {
      throw err;
    }
    baseLogger.error(
      {
        provider: locked.embeddingProvider,
        modelId: locked.embeddingModel,
        cause: err,
      },
      'resolveLockedEmbeddingFunction missing LM Studio model',
    );
    throw new EmbedModelMissingError(locked.embeddingModel, err);
  }
}

export async function generateLockedQueryEmbedding(
  text: string,
): Promise<{ embedding: number[]; lock: LockedEmbeddingModel }> {
  const locked = await getLockedEmbeddingModel();
  if (!locked) {
    throw new IngestRequiredError();
  }

  const provider = resolveProviderFromLock(locked);
  const model = await provider.getModel(locked.embeddingModel);
  const embedding = await model.embedText(text);
  if (
    locked.embeddingDimensions > 0 &&
    embedding.length !== locked.embeddingDimensions
  ) {
    throw new EmbeddingDimensionMismatchError(
      locked.embeddingDimensions,
      embedding.length,
      locked.embeddingProvider,
      locked.embeddingModel,
    );
  }
  return { embedding, lock: locked };
}

export async function getVectorsCollection(opts?: {
  requireEmbedding?: boolean;
}): Promise<Collection> {
  if (
    vectorsCollection &&
    (!opts?.requireEmbedding || vectorsCollectionHasEmbedding)
  ) {
    return vectorsCollection;
  }

  const c = await getClient();
  const embeddingFunction = opts?.requireEmbedding
    ? await resolveLockedEmbeddingFunction()
    : undefined;

  vectorsCollection = await c.getOrCreateCollection({
    name: COLLECTION_VECTORS,
    ...(embeddingFunction ? { embeddingFunction } : {}),
  });
  vectorsCollectionHasEmbedding = Boolean(embeddingFunction);
  return vectorsCollection;
}

export async function getRootsCollection(): Promise<Collection> {
  if (rootsCollection) return rootsCollection;
  const c = await getClient();
  rootsCollection = await c.getOrCreateCollection({
    name: COLLECTION_ROOTS,
  });
  return rootsCollection;
}

export async function getLockedModel(): Promise<string | null> {
  const col = await getVectorsCollection();
  const metadata = (col as { metadata?: Record<string, unknown> }).metadata;
  const lock = parseLockedEmbeddingMetadata(metadata);
  const lockedModelId = lock?.lockedModelId ?? null;

  append({
    level: 'info',
    message: 'DEV-0000036:T2:lock_resolver_source_selected',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface: 'ingest/chromaClient#getLockedModel',
      source: lock?.source ?? 'none',
      lockedModelId,
    },
  });
  append({
    level: 'info',
    message: 'DEV-0000036:T2:lock_resolver_surface_parity',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      surface: 'ingest/chromaClient#getLockedModel',
      embeddingProvider: lock?.embeddingProvider ?? null,
      embeddingModel: lockedModelId,
      embeddingDimensions: lock?.embeddingDimensions ?? null,
    },
  });
  return lockedModelId;
}

export async function getLockedEmbeddingModel(): Promise<LockedEmbeddingModel | null> {
  const col = await getVectorsCollection();
  const metadata = (col as { metadata?: Record<string, unknown> }).metadata;
  return parseLockedEmbeddingMetadata(metadata);
}

export async function setLockedModel(
  lock:
    | string
    | {
        embeddingProvider: EmbeddingProviderId;
        embeddingModel: string;
        embeddingDimensions: number;
      },
): Promise<void> {
  const resolved: LockedEmbeddingModel =
    typeof lock === 'string'
      ? {
          embeddingProvider: 'lmstudio',
          embeddingModel: lock,
          embeddingDimensions: 1,
          lockedModelId: lock,
          source: 'legacy',
        }
      : {
          embeddingProvider: lock.embeddingProvider,
          embeddingModel: lock.embeddingModel,
          embeddingDimensions: lock.embeddingDimensions,
          lockedModelId: lock.embeddingModel,
          source: 'canonical',
        };
  const col = (await getVectorsCollection()) as unknown as MinimalCollection;
  await col.modify({
    metadata: {
      lockedModelId: resolved.lockedModelId,
      embeddingProvider: resolved.embeddingProvider,
      embeddingModel: resolved.embeddingModel,
      embeddingDimensions: resolved.embeddingDimensions,
    },
  });
  append({
    level: 'info',
    source: 'server',
    timestamp: new Date().toISOString(),
    message: 'DEV-0000036:T7:embedding_lock_written',
    context: {
      embeddingProvider: resolved.embeddingProvider,
      embeddingModel: resolved.embeddingModel,
      embeddingDimensions: resolved.embeddingDimensions,
      lockedModelId: resolved.lockedModelId,
      source: resolved.source,
    },
  });
}

export async function clearLockedModel(options?: {
  recreateIfMissing?: boolean;
  reason?: LockClearReason;
  expectedLockId?: string;
}): Promise<void> {
  if (!vectorsCollection && options?.recreateIfMissing === false) {
    return;
  }
  try {
    const current = await getLockedEmbeddingModel();
    const currentLockId = current?.lockedModelId ?? null;
    if (options?.expectedLockId && currentLockId !== options.expectedLockId) {
      return;
    }
    const col = (await getVectorsCollection()) as unknown as MinimalCollection;
    await col.modify({
      metadata: {
        lockedModelId: null,
        embeddingProvider: null,
        embeddingModel: null,
        embeddingDimensions: null,
      },
    });
    append({
      level: 'info',
      source: 'server',
      timestamp: new Date().toISOString(),
      message: 'DEV-0000036:T7:embedding_lock_cleared',
      context: {
        reason: options?.reason ?? 'unknown',
        clearedLockId: currentLockId,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ChromaNotFoundError')) {
      baseLogger.info('clearLockedModel skipped; collection missing');
      return;
    }
    throw err;
  }
}

function resetCachedCollections() {
  client = null;
  clientUrl = null;
  vectorsCollection = null;
  vectorsCollectionHasEmbedding = false;
  rootsCollection = null;
}

export async function deleteVectorsCollection(): Promise<void> {
  const currentLock = await getLockedEmbeddingModel();
  const c = await getClient();
  if (c) {
    try {
      await c.deleteCollection({ name: COLLECTION_VECTORS });
    } catch (err) {
      baseLogger.warn({ err }, 'deleteVectorsCollection ignored error');
    }
  }
  resetCachedCollections();
  append({
    level: 'info',
    source: 'server',
    timestamp: new Date().toISOString(),
    message: 'DEV-0000036:T7:embedding_lock_cleared',
    context: {
      reason: 'cleanup',
      clearedLockId: currentLock?.lockedModelId ?? null,
    },
  });
  await clearLockedModel({
    recreateIfMissing: false,
    reason: 'cleanup',
    expectedLockId: currentLock?.lockedModelId,
  });
}

export async function deleteVectorsCollectionIfEmpty(): Promise<boolean> {
  const col = (await getVectorsCollection()) as unknown as MinimalCollection;
  const count = await col.count();
  if (count > 0) return false;
  const currentLock = await getLockedEmbeddingModel();

  const c = await getClient();
  if (c) {
    try {
      await c.deleteCollection({ name: COLLECTION_VECTORS });
    } catch (err) {
      baseLogger.warn({ err }, 'deleteVectorsCollectionIfEmpty ignored error');
    }
  }
  resetCachedCollections();
  append({
    level: 'info',
    source: 'server',
    timestamp: new Date().toISOString(),
    message: 'DEV-0000036:T7:embedding_lock_cleared',
    context: {
      reason: 'cleanup',
      clearedLockId: currentLock?.lockedModelId ?? null,
    },
  });
  await clearLockedModel({
    recreateIfMissing: false,
    reason: 'cleanup',
    expectedLockId: currentLock?.lockedModelId,
  });
  return true;
}

export async function clearRootsCollection(where?: Record<string, unknown>) {
  const col = await getRootsCollection();
  const collection = col as unknown as {
    delete: (opts?: {
      where?: Record<string, unknown>;
      ids?: string[];
    }) => Promise<void>;
  };
  const whereClause = where ?? { ingestedAtMs: { $gt: 0 } };
  baseLogger.info({ where: whereClause }, 'clearRootsCollection start');
  await collection.delete({ where: whereClause });
  baseLogger.info({ where: whereClause }, 'clearRootsCollection done');
}

export async function clearVectorsCollection(where?: Record<string, unknown>) {
  const col = await getVectorsCollection();
  const collection = col as unknown as {
    delete: (opts?: {
      where?: Record<string, unknown>;
      ids?: string[];
    }) => Promise<void>;
  };
  const whereClause = where ?? { ingestedAtMs: { $gt: 0 } };
  baseLogger.info({ where: whereClause }, 'clearVectorsCollection start');
  await collection.delete({ where: whereClause });
  baseLogger.info({ where: whereClause }, 'clearVectorsCollection done');
}

export async function deleteVectors(where: {
  where?: Record<string, unknown>;
  ids?: string[];
}) {
  const col = await getVectorsCollection();
  const collection = col as unknown as {
    delete: (opts?: {
      where?: Record<string, unknown>;
      ids?: string[];
    }) => Promise<void>;
  };
  baseLogger.info({ where }, 'deleteVectors start');
  await collection.delete(where);
  baseLogger.info({ where }, 'deleteVectors done');
}

export async function deleteRoots(where: {
  where?: Record<string, unknown>;
  ids?: string[];
}) {
  const col = await getRootsCollection();
  const collection = col as unknown as {
    delete: (opts?: {
      where?: Record<string, unknown>;
      ids?: string[];
    }) => Promise<void>;
  };
  await collection.delete(where);
}

export async function collectionIsEmpty(): Promise<boolean> {
  const col = (await getVectorsCollection()) as unknown as MinimalCollection;
  const count = await col.count();
  return count === 0;
}

// Test helper to reset cached clients/collections between scenarios
export function resetCollectionsForTests() {
  client = null;
  vectorsCollection = null;
  vectorsCollectionHasEmbedding = false;
  rootsCollection = null;
  lmClientResolver = getLmClient;
}
