export type DiscoveredFile = {
  absPath: string;
  relPath: string;
  ext: string;
  size: number;
};

export type Chunk = { chunkIndex: number; text: string; tokenCount: number };

export type ChunkMeta = {
  fileHash: string;
  chunkHash: string;
  relPath: string;
  chunkIndex: number;
  tokenCount: number;
};

export type IngestRunState =
  | 'queued'
  | 'scanning'
  | 'embedding'
  | 'completed'
  | 'skipped'
  | 'cancelled'
  | 'error';

export type IngestConfig = {
  includes: string[];
  excludes: string[];
  tokenSafetyMargin: number;
  fallbackTokenLimit: number;
  flushEvery: number;
  largeTextThresholdBytes: number;
  openAiMaxBatchSize: number;
  openAiMaxInFlight: number;
  lmStudioMaxBatchSize: number;
  lmStudioMaxInFlight: number;
  maxQueueSize: number;
};
