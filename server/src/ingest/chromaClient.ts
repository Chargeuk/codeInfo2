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

class InMemoryCollection {
  ids: string[] = [];
  documents: string[] = [];
  embeddings: number[][] = [];
  metadatas: Record<string, unknown>[] = [];
  metadata: Record<string, unknown> | undefined;

  constructor(
    public name: string,
    metadata?: Record<string, unknown>,
  ) {
    this.metadata = metadata;
  }

  async add(payload: {
    ids: string[];
    documents?: string[];
    embeddings?: number[][];
    metadatas?: Record<string, unknown>[];
  }) {
    const documents = payload.documents ?? payload.ids.map(() => '');
    const embeddings = payload.embeddings ?? payload.ids.map(() => []);
    const metadatas = payload.metadatas ?? payload.ids.map(() => ({}));

    this.ids.push(...payload.ids);
    this.documents.push(...documents);
    this.embeddings.push(...embeddings);
    this.metadatas.push(...metadatas);
  }

  async count() {
    return this.ids.length;
  }

  async modify({ metadata }: { metadata?: Record<string, unknown> }) {
    this.metadata = metadata;
  }

  async get({
    where,
    include,
    limit,
  }: {
    where?: Record<string, unknown>;
    include?: string[];
    limit?: number;
  } = {}) {
    const shouldInclude = (field: string) =>
      !include || include.includes(field);
    const matchesWhere = (idx: number) => {
      if (!where) return true;
      return Object.entries(where).every(([key, value]) => {
        const meta = this.metadatas[idx] ?? {};
        return (meta as Record<string, unknown>)[key] === value;
      });
    };

    const filteredIndices: number[] = [];
    for (let i = 0; i < this.ids.length; i += 1) {
      if (matchesWhere(i)) filteredIndices.push(i);
      if (limit && filteredIndices.length >= limit) break;
    }

    return {
      ids: shouldInclude('ids') ? filteredIndices.map((i) => this.ids[i]) : [],
      metadatas: shouldInclude('metadatas')
        ? filteredIndices.map((i) => this.metadatas[i])
        : [],
      documents: shouldInclude('documents')
        ? filteredIndices.map((i) => this.documents[i])
        : [],
      embeddings: shouldInclude('embeddings')
        ? filteredIndices.map((i) => this.embeddings[i])
        : [],
    };
  }

  async delete({
    where,
    ids,
  }: {
    where?: Record<string, unknown>;
    ids?: string[];
  } = {}) {
    if ((ids && ids.length) || (where && Object.keys(where).length)) {
      const matchByWhere = (idx: number) => {
        if (!where) return false;
        const meta = this.metadatas[idx] ?? {};
        return Object.entries(where).every(
          ([key, value]) => (meta as Record<string, unknown>)[key] === value,
        );
      };

      const matchById = (idx: number) => {
        if (!ids || !ids.length) return false;
        return ids.includes(this.ids[idx]);
      };

      const keep: number[] = [];
      for (let i = 0; i < this.ids.length; i += 1) {
        const matches = matchById(i) || matchByWhere(i);
        if (!matches) keep.push(i);
      }

      this.ids = keep.map((i) => this.ids[i]);
      this.documents = keep.map((i) => this.documents[i]);
      this.embeddings = keep.map((i) => this.embeddings[i]);
      this.metadatas = keep.map((i) => this.metadatas[i]);
      return;
    }

    if (!where || Object.keys(where).length === 0) {
      this.ids = [];
      this.documents = [];
      this.embeddings = [];
      this.metadatas = [];
      return;
    }
  }
}

const memoryCollections = new Map<string, InMemoryCollection>();

async function getClient() {
  const chromaUrl = getChromaUrl();
  if (chromaUrl.startsWith('mock:')) {
    return null;
  }
  if (!client) {
    client = new ChromaClient({
      path: chromaUrl,
      embeddingFunction: resolveEmbeddingFunction(),
    } as unknown as { path: string });
  }
  return client;
}

export async function getVectorsCollection(): Promise<Collection> {
  if (vectorsCollection) return vectorsCollection;
  const c = await getClient();
  if (!c) {
    const existing = memoryCollections.get(COLLECTION_VECTORS);
    if (existing) return existing as unknown as Collection;
    const created = new InMemoryCollection(COLLECTION_VECTORS);
    memoryCollections.set(COLLECTION_VECTORS, created);
    return created as unknown as Collection;
  }
  const embeddingFunction = resolveEmbeddingFunction();
  vectorsCollection = await c.getOrCreateCollection({
    name: COLLECTION_VECTORS,
    embeddingFunction,
  });
  return vectorsCollection;
}

export async function getRootsCollection(): Promise<Collection> {
  if (rootsCollection) return rootsCollection;
  const c = await getClient();
  if (!c) {
    const existing = memoryCollections.get(COLLECTION_ROOTS);
    if (existing) return existing as unknown as Collection;
    const created = new InMemoryCollection(COLLECTION_ROOTS);
    memoryCollections.set(COLLECTION_ROOTS, created);
    return created as unknown as Collection;
  }
  const embeddingFunction = resolveEmbeddingFunction();
  rootsCollection = await c.getOrCreateCollection({
    name: COLLECTION_ROOTS,
    embeddingFunction,
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

export async function clearLockedModel(): Promise<void> {
  const col = (await getVectorsCollection()) as unknown as MinimalCollection;
  await col.modify({ metadata: { lockedModelId: null } });
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
