import { ChromaClient, type Collection } from 'chromadb';

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000';
const COLLECTION_VECTORS = process.env.INGEST_COLLECTION ?? 'ingest_vectors';
const COLLECTION_ROOTS = process.env.INGEST_ROOTS_COLLECTION ?? 'ingest_roots';

let client: ChromaClient | null = null;
let vectorsCollection: Collection | null = null;
let rootsCollection: Collection | null = null;

async function getClient() {
  if (!client) {
    client = new ChromaClient({ path: CHROMA_URL });
  }
  return client;
}

export async function getVectorsCollection(): Promise<Collection> {
  if (vectorsCollection) return vectorsCollection;
  const c = await getClient();
  vectorsCollection = await c.getOrCreateCollection({
    name: COLLECTION_VECTORS,
    metadata: { lockedModelId: null },
  });
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
    return metadata.lockedModelId;
  }
  return null;
}

export async function setLockedModel(modelId: string): Promise<void> {
  const col = await getVectorsCollection();
  await col.modify({ metadata: { lockedModelId: modelId } });
}

export async function clearLockedModel(): Promise<void> {
  const col = await getVectorsCollection();
  await col.modify({ metadata: { lockedModelId: null } });
}

export async function collectionIsEmpty(): Promise<boolean> {
  const col = await getVectorsCollection();
  const count = await col.count();
  return count === 0;
}
