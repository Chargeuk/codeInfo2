import { LMStudioClient } from '@lmstudio/sdk';
import {
  ChromaClient,
  type Collection,
  type EmbeddingFunction,
} from 'chromadb';
import { baseLogger } from '../logger.js';

const getChromaUrl = () => process.env.CHROMA_URL ?? 'http://localhost:8000';
type MinimalCollection = {
  modify: (opts: { metadata?: Record<string, unknown> }) => Promise<void>;
  count: () => Promise<number>;
};
const COLLECTION_VECTORS = process.env.INGEST_COLLECTION ?? 'ingest_vectors';
const COLLECTION_ROOTS = process.env.INGEST_ROOTS_COLLECTION ?? 'ingest_roots';
const DEFAULT_EMBED_MODEL = process.env.INGEST_EMBED_MODEL ?? null;

let client: ChromaClient | null = null;
let vectorsCollection: Collection | null = null;
let rootsCollection: Collection | null = null;

const toWebSocketUrl = (value: string) => {
  if (value.startsWith('http://')) return value.replace(/^http:/i, 'ws:');
  if (value.startsWith('https://')) return value.replace(/^https:/i, 'wss:');
  return value;
};

class NoopEmbeddingFunction implements EmbeddingFunction {
  async generate(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0]);
  }
}

class LmStudioEmbeddingFunction implements EmbeddingFunction {
  constructor(
    private modelKey: string,
    private baseUrl: string,
  ) {}

  async generate(texts: string[]): Promise<number[][]> {
    const client = new LMStudioClient({ baseUrl: this.baseUrl });
    const model = await client.embedding.model(this.modelKey);
    const results: number[][] = [];
    for (const text of texts) {
      const res = await model.embed(text);
      results.push(res.embedding);
    }
    return results;
  }
}

function resolveEmbeddingFunction(): EmbeddingFunction {
  const baseUrl = process.env.LMSTUDIO_BASE_URL;
  if (baseUrl && DEFAULT_EMBED_MODEL) {
    try {
      return new LmStudioEmbeddingFunction(
        DEFAULT_EMBED_MODEL,
        toWebSocketUrl(baseUrl),
      );
    } catch {
      // fall through to noop
    }
  }
  return new NoopEmbeddingFunction();
}

async function getClient() {
  const chromaUrl = getChromaUrl();
  if (!client) {
    const embeddingFunction = DEFAULT_EMBED_MODEL
      ? resolveEmbeddingFunction()
      : undefined;
    client = new ChromaClient({
      path: chromaUrl,
      ...(embeddingFunction ? { embeddingFunction } : {}),
    } as unknown as { path: string });
  }
  return client;
}

export async function getVectorsCollection(): Promise<Collection> {
  if (vectorsCollection) return vectorsCollection;
  const c = await getClient();
  const embeddingFunction = DEFAULT_EMBED_MODEL
    ? resolveEmbeddingFunction()
    : undefined;
  vectorsCollection = await c.getOrCreateCollection({
    name: COLLECTION_VECTORS,
    ...(embeddingFunction ? { embeddingFunction } : {}),
  });
  return vectorsCollection;
}

export async function getRootsCollection(): Promise<Collection> {
  if (rootsCollection) return rootsCollection;
  const c = await getClient();
  const embeddingFunction = DEFAULT_EMBED_MODEL
    ? resolveEmbeddingFunction()
    : undefined;
  rootsCollection = await c.getOrCreateCollection({
    name: COLLECTION_ROOTS,
    ...(embeddingFunction ? { embeddingFunction } : {}),
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
  const col = (await getVectorsCollection()) as unknown as MinimalCollection;
  await col.modify({ metadata: { lockedModelId: null } });
}

function resetCachedCollections() {
  client = null;
  vectorsCollection = null;
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
  rootsCollection = null;
}
