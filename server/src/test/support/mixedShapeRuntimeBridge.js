import { ChromaClient } from 'chromadb';

const DEFAULT_CHROMA_URL = 'http://localhost:8000';
const DEFAULT_ROOTS_COLLECTION = 'ingest_roots';
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

const trimToUndefined = (value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toChromaClientArgs = (connectionString) => {
  const normalized = connectionString.includes('://')
    ? connectionString
    : `http://${connectionString}`;
  const url = new URL(normalized);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 8000,
    ssl: url.protocol === 'https:',
  };
};

const getChromaUrl = () =>
  trimToUndefined(process.env.CODEINFO_CHROMA_URL) ?? DEFAULT_CHROMA_URL;

const getRootsCollectionName = () =>
  trimToUndefined(process.env.CODEINFO_INGEST_ROOTS_COLLECTION) ??
  DEFAULT_ROOTS_COLLECTION;

const getBridgeEmbeddingDimensions = () => {
  const raw = trimToUndefined(
    process.env.CODEINFO_MAIN_STACK_MIXED_SHAPE_VECTOR_DIMENSIONS,
  );
  if (!raw) return DEFAULT_EMBEDDING_DIMENSIONS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EMBEDDING_DIMENSIONS;
};

const getBridgeClient = () =>
  new ChromaClient(toChromaClientArgs(getChromaUrl()));

async function getRootsCollection() {
  const client = getBridgeClient();
  return await client.getOrCreateCollection({
    name: getRootsCollectionName(),
  });
}

async function clearRootsCollection(where) {
  const collection = await getRootsCollection();
  const whereClause = where ?? { ingestedAtMs: { $gt: 0 } };
  try {
    await collection.delete({ where: whereClause });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorName =
      error instanceof Error && typeof error.name === 'string'
        ? error.name
        : '';
    if (
      errorName.includes('ChromaNotFoundError') ||
      message.includes('ChromaNotFoundError') ||
      message.includes('requested resource could not be found')
    ) {
      return;
    }
    throw error;
  }
}

export const MIXED_SHAPE_RUNTIME_BRIDGE_NAME = 'task199-mixed-shape-bridge';
export const MIXED_SHAPE_RUNTIME_BRIDGE_RUN_ID =
  'task199-mixed-shape-runtime-bridge';

export async function cleanupMixedShapeCanonicalOpenAiRoot({
  rootPath,
  clearRootsCollectionImpl = clearRootsCollection,
}) {
  if (typeof rootPath !== 'string' || rootPath.trim().length === 0) {
    throw new Error('rootPath is required to clean the mixed-shape bridge row');
  }

  await clearRootsCollectionImpl({ root: rootPath });
  return { rootPath };
}

export async function seedMixedShapeCanonicalOpenAiRoot({
  rootPath,
  name = MIXED_SHAPE_RUNTIME_BRIDGE_NAME,
  getRootsCollectionImpl = getRootsCollection,
  clearRootsCollectionImpl = clearRootsCollection,
}) {
  if (typeof rootPath !== 'string' || rootPath.trim().length === 0) {
    throw new Error('rootPath is required to seed the mixed-shape bridge row');
  }

  await cleanupMixedShapeCanonicalOpenAiRoot({
    rootPath,
    clearRootsCollectionImpl,
  });

  const roots = await getRootsCollectionImpl();
  await roots.add({
    ids: [MIXED_SHAPE_RUNTIME_BRIDGE_RUN_ID],
    embeddings: [new Array(getBridgeEmbeddingDimensions()).fill(0)],
    metadatas: [
      {
        runId: MIXED_SHAPE_RUNTIME_BRIDGE_RUN_ID,
        root: rootPath,
        name,
        model: '',
        embeddingProvider: 'openai',
        embeddingModel: '',
        embeddingDimensions: 0,
        files: 1,
        chunks: 1,
        embedded: 1,
        state: 'completed',
        lastIngestAt: new Date().toISOString(),
        ingestedAtMs: Date.now(),
      },
    ],
  });

  return { rootPath, name };
}
