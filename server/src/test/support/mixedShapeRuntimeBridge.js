import {
  clearRootsCollection,
  getRootsCollection,
} from '../../ingest/chromaClient.js';

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
    embeddings: [[0]],
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
