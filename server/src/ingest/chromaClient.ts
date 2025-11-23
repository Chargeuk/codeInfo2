import { ChromaClient, type Collection } from 'chromadb';

const getChromaUrl = () => process.env.CHROMA_URL ?? 'http://localhost:8000';
type MinimalCollection = {
  modify: (opts: { metadata?: Record<string, unknown> }) => Promise<void>;
  count: () => Promise<number>;
};
const COLLECTION_VECTORS = process.env.INGEST_COLLECTION ?? 'ingest_vectors';
const COLLECTION_ROOTS = process.env.INGEST_ROOTS_COLLECTION ?? 'ingest_roots';

let client: ChromaClient | null = null;
let vectorsCollection: Collection | null = null;
let rootsCollection: Collection | null = null;

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

  async delete({ where }: { where?: Record<string, unknown> } = {}) {
    if (!where || Object.keys(where).length === 0) {
      this.ids = [];
      this.documents = [];
      this.embeddings = [];
      this.metadatas = [];
      return;
    }

    const keep: number[] = [];
    for (let i = 0; i < this.ids.length; i += 1) {
      const meta = this.metadatas[i] ?? {};
      const matches = Object.entries(where).every(
        ([key, value]) => (meta as Record<string, unknown>)[key] === value,
      );
      if (!matches) keep.push(i);
    }

    this.ids = keep.map((i) => this.ids[i]);
    this.documents = keep.map((i) => this.documents[i]);
    this.embeddings = keep.map((i) => this.embeddings[i]);
    this.metadatas = keep.map((i) => this.metadatas[i]);
  }
}

const memoryCollections = new Map<string, InMemoryCollection>();

async function getClient() {
  const chromaUrl = getChromaUrl();
  if (chromaUrl.startsWith('mock:')) {
    return null;
  }
  if (!client) {
    client = new ChromaClient({ path: chromaUrl });
  }
  return client;
}

export async function getVectorsCollection(): Promise<Collection> {
  if (vectorsCollection) return vectorsCollection;
  const c = await getClient();
  if (!c) {
    const existing = memoryCollections.get(COLLECTION_VECTORS);
    if (existing) return existing as unknown as Collection;
    const created = new InMemoryCollection(COLLECTION_VECTORS, {
      lockedModelId: null,
    });
    memoryCollections.set(COLLECTION_VECTORS, created);
    return created as unknown as Collection;
  }
  vectorsCollection = await c.getOrCreateCollection({
    name: COLLECTION_VECTORS,
    metadata: { lockedModelId: null },
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
  rootsCollection = await c.getOrCreateCollection({
    name: COLLECTION_ROOTS,
  });
  return rootsCollection;
}

export async function getLockedModel(): Promise<string | null> {
  const col = await getVectorsCollection();
  const metadata = (col as { metadata?: Record<string, unknown> }).metadata;
  if (metadata && typeof metadata.lockedModelId === 'string') {
    return metadata.lockedModelId;
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
    delete: (opts?: { where?: Record<string, unknown> }) => Promise<void>;
  };
  await collection.delete(where ? { where } : {});
}

export async function collectionIsEmpty(): Promise<boolean> {
  const col = (await getVectorsCollection()) as unknown as MinimalCollection;
  const count = await col.count();
  return count === 0;
}
