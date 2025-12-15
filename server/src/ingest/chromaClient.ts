import {
  ChromaClient,
  type Collection,
  type EmbeddingFunction,
} from 'chromadb';
import { getClient as getLmClient } from '../lmstudio/clientPool.js';
import { baseLogger } from '../logger.js';

const getChromaUrl = () => process.env.CHROMA_URL ?? 'http://localhost:8000';
type MinimalCollection = {
  modify: (opts: { metadata?: Record<string, unknown> }) => Promise<void>;
  count: () => Promise<number>;
};
const COLLECTION_VECTORS = process.env.INGEST_COLLECTION ?? 'ingest_vectors';
const COLLECTION_ROOTS = process.env.INGEST_ROOTS_COLLECTION ?? 'ingest_roots';

let client: ChromaClient | null = null;
let vectorsCollection: Collection | null = null;
let vectorsCollectionHasEmbedding = false;
let rootsCollection: Collection | null = null;
let lmClientResolver = getLmClient;

const toWebSocketUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/i, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/i, 'wss:');
  return value;
};

class LmStudioEmbeddingFunction implements EmbeddingFunction {
  constructor(
    private modelKey: string,
    private baseUrl: string,
  ) {}

  async generate(texts: string[]): Promise<number[][]> {
    const client = lmClientResolver(this.baseUrl);
    const model = await client.embedding.model(this.modelKey);
    const results: number[][] = [];
    for (const text of texts) {
      const res = await model.embed(text);
      results.push(res.embedding);
    }
    return results;
  }
}

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
  if (!client) {
    client = new ChromaClient(toChromaClientArgs(chromaUrl));
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

async function resolveLockedEmbeddingFunction(): Promise<EmbeddingFunction> {
  const lockedModelId = await getLockedModel();
  if (!lockedModelId) {
    baseLogger.warn('resolveLockedEmbeddingFunction missing locked model');
    throw new IngestRequiredError();
  }

  const baseUrl = process.env.LMSTUDIO_BASE_URL;
  if (!baseUrl) {
    throw new EmbedModelMissingError(
      lockedModelId,
      new Error('LMSTUDIO_BASE_URL is not configured'),
    );
  }

  const wsBase = toWebSocketUrl(baseUrl);
  try {
    const client = lmClientResolver(wsBase);
    // Proactively verify the model exists to surface clear errors before query time.
    await client.embedding.model(lockedModelId);
    return new LmStudioEmbeddingFunction(lockedModelId, wsBase);
  } catch (err) {
    baseLogger.error(
      { modelId: lockedModelId, cause: err },
      'resolveLockedEmbeddingFunction missing LM Studio model',
    );
    throw new EmbedModelMissingError(lockedModelId, err);
  }
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
  if (metadata && typeof metadata.lockedModelId === 'string') {
    return metadata.lockedModelId || null;
  }
  return null;
}

export async function setLockedModel(modelId: string): Promise<void> {
  const col = (await getVectorsCollection()) as unknown as MinimalCollection;
  await col.modify({ metadata: { lockedModelId: modelId } });
}

export async function clearLockedModel(options?: {
  recreateIfMissing?: boolean;
}): Promise<void> {
  if (!vectorsCollection && options?.recreateIfMissing === false) {
    return;
  }
  try {
    const col = (await getVectorsCollection()) as unknown as MinimalCollection;
    await col.modify({ metadata: { lockedModelId: null } });
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
  vectorsCollection = null;
  vectorsCollectionHasEmbedding = false;
  rootsCollection = null;
}

export async function deleteVectorsCollection(): Promise<void> {
  const c = await getClient();
  if (c) {
    try {
      await c.deleteCollection({ name: COLLECTION_VECTORS });
    } catch (err) {
      baseLogger.warn({ err }, 'deleteVectorsCollection ignored error');
    }
  }
  resetCachedCollections();
  await clearLockedModel({ recreateIfMissing: false });
}

export async function deleteVectorsCollectionIfEmpty(): Promise<boolean> {
  const col = (await getVectorsCollection()) as unknown as MinimalCollection;
  const count = await col.count();
  if (count > 0) return false;

  const c = await getClient();
  if (c) {
    try {
      await c.deleteCollection({ name: COLLECTION_VECTORS });
    } catch (err) {
      baseLogger.warn({ err }, 'deleteVectorsCollectionIfEmpty ignored error');
    }
  }
  resetCachedCollections();
  await clearLockedModel({ recreateIfMissing: false });
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
