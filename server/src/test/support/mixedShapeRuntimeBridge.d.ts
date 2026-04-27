export const MIXED_SHAPE_RUNTIME_BRIDGE_NAME: string;
export const MIXED_SHAPE_RUNTIME_BRIDGE_RUN_ID: string;

export function cleanupMixedShapeCanonicalOpenAiRoot(params: {
  rootPath: string;
  clearRootsCollectionImpl?: (params: { root: string }) => Promise<unknown>;
}): Promise<{
  rootPath: string;
}>;

export function seedMixedShapeCanonicalOpenAiRoot(params: {
  rootPath: string;
  name?: string;
  getRootsCollectionImpl?: () => Promise<{
    add: (params: {
      ids: string[];
      embeddings: number[][];
      metadatas: Array<Record<string, unknown>>;
    }) => Promise<unknown>;
  }>;
  clearRootsCollectionImpl?: (params: { root: string }) => Promise<unknown>;
}): Promise<{
  rootPath: string;
  name: string;
}>;
