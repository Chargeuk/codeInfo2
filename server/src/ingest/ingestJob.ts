import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import type { EmbeddingModel, LMStudioClient } from '@lmstudio/sdk';
import type { Metadata } from 'chromadb';
import {
  clearLockedModel,
  collectionIsEmpty,
  getLockedModel,
  getRootsCollection,
  getVectorsCollection,
  setLockedModel,
} from './chromaClient.js';
import type { IngestRunState } from './types.js';
import {
  chunkText,
  discoverFiles,
  hashChunk,
  hashFile,
  resolveConfig,
} from './index.js';

export type IngestJobInput = {
  path: string;
  name: string;
  description?: string;
  model: string;
  dryRun?: boolean;
};

export type IngestJobStatus = {
  runId: string;
  state: IngestRunState;
  counts: { files: number; chunks: number; embedded: number };
  message?: string;
  lastError?: string | null;
};

type Deps = {
  lmClientFactory: (baseUrl: string) => LMStudioClient;
  baseUrl: string;
};

const jobs = new Map<string, IngestJobStatus>();
let busy = false;
let deps: Deps | null = null;

export function setIngestDeps(next: Deps) {
  deps = next;
}

export function isBusy() {
  return busy;
}

async function embedText(modelKey: string, text: string): Promise<number[]> {
  const d = deps;
  if (!d) throw new Error('ingest deps not set');
  const client = d.lmClientFactory(d.baseUrl);
  const model = await client.embedding.model(modelKey);
  const result = await model.embed(text);
  return result.embedding;
}

async function processRun(runId: string, input: IngestJobInput) {
  const status = jobs.get(runId);
  if (!status) return;
  busy = true;
  try {
    const { path: startPath, name, description, model, dryRun } = input;
    jobs.set(runId, {
      ...status,
      state: 'scanning',
      message: 'Discovering files',
    });
    const { files, root } = await discoverFiles(startPath, resolveConfig());
    const counts = { files: files.length, chunks: 0, embedded: 0 };
    jobs.set(runId, {
      ...status,
      state: 'embedding',
      counts,
      message: `Embedding ${files.length} files`,
    });

    const vectors = await getVectorsCollection();
    const roots = await getRootsCollection();

    const ids: string[] = [];
    const documents: string[] = [];
    const embeddings: number[][] = [];
    const metadatas: Record<string, unknown>[] = [];

    for (const file of files) {
      const text = await fs.readFile(file.absPath, 'utf8');
      const chunks = await chunkText(
        text,
        (await deps
          ?.lmClientFactory(deps.baseUrl)
          .embedding.model(model)) as unknown as EmbeddingModel,
      );
      const fileHash = await hashFile(file.absPath);
      for (const chunk of chunks) {
        const chunkHash = hashChunk(file.relPath, chunk.chunkIndex, chunk.text);
        const embedding = dryRun ? [0] : await embedText(model, chunk.text);
        ids.push(`${runId}:${file.relPath}:${chunk.chunkIndex}`);
        documents.push(chunk.text);
        embeddings.push(embedding);
        metadatas.push({
          runId,
          root,
          relPath: file.relPath,
          fileHash,
          chunkHash,
          embeddedAt: new Date().toISOString(),
          model,
          name,
          description: description ?? null,
        });
      }
      counts.chunks += chunks.length;
    }

    if (!dryRun && embeddings.length) {
      await vectors.add({
        ids,
        documents,
        embeddings,
        metadatas: metadatas as Metadata[],
      });
      counts.embedded = embeddings.length;
      const locked = await getLockedModel();
      if (!locked) {
        await setLockedModel(model);
      }
    } else {
      counts.embedded = 0;
    }

    await roots.add({
      ids: [runId],
      metadatas: [
        {
          runId,
          root,
          name,
          description: description ?? null,
          model,
          files: counts.files,
          chunks: counts.chunks,
          embedded: counts.embedded,
          state: 'completed',
          lastIngestAt: new Date().toISOString(),
        },
      ],
    });

    jobs.set(runId, {
      runId,
      state: 'completed',
      counts,
      message: 'Completed',
      lastError: null,
    });
  } catch (err) {
    jobs.set(runId, {
      runId,
      state: 'error',
      counts: { files: 0, chunks: 0, embedded: 0 },
      message: 'Failed',
      lastError: (err as Error).message,
    });
  } finally {
    busy = false;
  }
}

export async function startIngest(input: IngestJobInput, d: Deps) {
  deps = d;
  const locked = await getLockedModel();
  if (locked && locked !== input.model) {
    const error = new Error('MODEL_LOCKED');
    (error as { code?: string }).code = 'MODEL_LOCKED';
    throw error;
  }
  if (!busy) {
    const runId = randomUUID();
    jobs.set(runId, {
      runId,
      state: 'queued',
      counts: { files: 0, chunks: 0, embedded: 0 },
      message: 'Queued',
      lastError: null,
    });
    setImmediate(() => {
      void processRun(runId, input);
    });
    return runId;
  }
  const error = new Error('BUSY');
  (error as { code?: string }).code = 'BUSY';
  throw error;
}

export function getStatus(runId: string): IngestJobStatus | null {
  return jobs.get(runId) ?? null;
}

export async function resetLocksIfEmpty() {
  if (await collectionIsEmpty()) {
    await clearLockedModel();
  }
}
