import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import type { EmbeddingModel, LMStudioClient } from '@lmstudio/sdk';
import type { Metadata } from 'chromadb';
import { baseLogger } from '../logger.js';
import {
  clearLockedModel,
  collectionIsEmpty,
  deleteRoots,
  deleteVectors,
  getLockedModel,
  getRootsCollection,
  getVectorsCollection,
  setLockedModel,
} from './chromaClient.js';
import * as ingestLock from './lock.js';
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
let deps: Deps | null = null;
const jobInputs = new Map<string, IngestJobInput & { root?: string }>();
const cancelledRuns = new Set<string>();

export function setIngestDeps(next: Deps) {
  deps = next;
}

export function isBusy() {
  return ingestLock.isHeld();
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
  jobInputs.set(runId, input);
  try {
    const ingestedAtMs = Date.now();
    const { path: startPath, name, description, model, dryRun } = input;
    jobs.set(runId, {
      ...status,
      state: 'scanning',
      message: 'Discovering files',
    });
    const { files, root } = await discoverFiles(startPath, resolveConfig());
    jobInputs.set(runId, { ...input, root });
    if (files.length === 0) {
      const errorMsg = `No eligible files found in ${startPath}`;
      jobs.set(runId, {
        runId,
        state: 'error',
        counts: { files: 0, chunks: 0, embedded: 0 },
        message: errorMsg,
        lastError: errorMsg,
      });
      ingestLock.release(runId);
      return;
    }
    const counts = { files: files.length, chunks: 0, embedded: 0 };
    jobs.set(runId, {
      ...status,
      state: 'embedding',
      counts,
      message: `Embedding ${files.length} files`,
    });

    const vectors = await getVectorsCollection();
    const roots = await getRootsCollection();
    const rootDimsResult = await (
      roots as unknown as {
        get: (opts: { include?: string[]; limit?: number }) => Promise<{
          embeddings?: number[][];
        }>;
      }
    ).get({ include: ['embeddings'], limit: 1 });
    const existingRootDim = rootDimsResult.embeddings?.[0]?.length;

    const ids: string[] = [];
    const documents: string[] = [];
    const embeddings: number[][] = [];
    const metadatas: Record<string, unknown>[] = [];
    let vectorDim = 1;

    for (const file of files) {
      if (cancelledRuns.has(runId)) {
        jobs.set(runId, {
          runId,
          state: 'cancelled',
          counts,
          message: 'Cancelled',
          lastError: null,
        });
        await deleteVectors({ where: { runId } });
        await deleteRoots({ where: { root } });
        const rootEmbeddingDim = existingRootDim || vectorDim || 1;
        const cancelMetadata: Metadata = {
          runId,
          root,
          name,
          model,
          files: counts.files,
          chunks: counts.chunks,
          embedded: counts.embedded,
          state: 'cancelled',
          lastIngestAt: new Date().toISOString(),
          ingestedAtMs,
        };
        if (typeof description === 'string' && description.length > 0) {
          cancelMetadata.description = description;
        }

        await roots.add({
          ids: [runId],
          embeddings: [Array(rootEmbeddingDim).fill(0)],
          metadatas: [cancelMetadata],
        });
        return;
      }
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
        if (!dryRun && embedding.length > 0) {
          vectorDim = embedding.length;
        }
        ids.push(`${runId}:${file.relPath}:${chunk.chunkIndex}`);
        documents.push(chunk.text);
        embeddings.push(embedding);
        const metadata: Metadata = {
          runId,
          root,
          relPath: file.relPath,
          fileHash,
          chunkHash,
          embeddedAt: new Date().toISOString(),
          ingestedAtMs,
          model,
          name,
        };
        if (description) metadata.description = description;
        metadatas.push(metadata);
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
      vectorDim = embeddings[0]?.length ?? vectorDim;
      counts.embedded = embeddings.length;
      const locked = await getLockedModel();
      if (!locked) {
        await setLockedModel(model);
      }
    } else {
      counts.embedded = 0;
    }

    const rootEmbeddingDim = existingRootDim || vectorDim || 1;
    const rootMetadata: Metadata = {
      runId,
      root,
      name,
      model,
      files: counts.files,
      chunks: counts.chunks,
      embedded: counts.embedded,
      state: 'completed',
      lastIngestAt: new Date().toISOString(),
      ingestedAtMs,
    };
    if (description) rootMetadata.description = description;

    await roots.add({
      ids: [runId],
      embeddings: [Array(rootEmbeddingDim).fill(0)],
      metadatas: [rootMetadata],
    });

    jobs.set(runId, {
      runId,
      state: 'completed',
      counts,
      message: 'Completed',
      lastError: null,
    });
  } catch (err) {
    console.error('[ingestJob] run failed', {
      runId,
      error: (err as Error)?.message,
      stack: (err as Error)?.stack,
    });
    jobs.set(runId, {
      runId,
      state: 'error',
      counts: { files: 0, chunks: 0, embedded: 0 },
      message: 'Failed',
      lastError: (err as Error).message,
    });
  } finally {
    ingestLock.release(runId);
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
  const runId = randomUUID();
  if (!ingestLock.acquire(runId)) {
    const error = new Error('BUSY');
    (error as { code?: string }).code = 'BUSY';
    throw error;
  }
  jobs.set(runId, {
    runId,
    state: 'queued',
    counts: { files: 0, chunks: 0, embedded: 0 },
    message: 'Queued',
    lastError: null,
  });
  jobInputs.set(runId, { ...input, root: input.path });
  setImmediate(() => {
    void processRun(runId, input);
  });
  return runId;
}

export function getStatus(runId: string): IngestJobStatus | null {
  return jobs.get(runId) ?? null;
}

export async function resetLocksIfEmpty() {
  if (await collectionIsEmpty()) {
    await clearLockedModel();
  }
}

export async function cancelRun(runId: string) {
  cancelledRuns.add(runId);
  const status = jobs.get(runId);
  const input = jobInputs.get(runId);
  const root = input?.root;

  if (status?.state === 'completed' || status?.state === 'error') {
    cancelledRuns.delete(runId);
    return { cleanupState: 'complete', found: true } as const;
  }

  if (root) {
    await deleteVectors({ where: { runId } });
    await deleteRoots({ where: { root } });
    const roots = await getRootsCollection();
    const existingRoots = await (
      roots as unknown as {
        get: (opts: { include?: string[]; limit?: number }) => Promise<{
          embeddings?: number[][];
        }>;
      }
    ).get({ include: ['embeddings'], limit: 1 });
    const existingRootDim = existingRoots.embeddings?.[0]?.length;
    const rootEmbeddingDim =
      existingRootDim && existingRootDim > 0 ? existingRootDim : 1;

    const cancelMetadata: Metadata = {
      runId,
      root,
      name: input?.name ?? '',
      model: input?.model ?? '',
      files: status?.counts.files ?? 0,
      chunks: status?.counts.chunks ?? 0,
      embedded: status?.counts.embedded ?? 0,
      state: 'cancelled',
      lastIngestAt: new Date().toISOString(),
      ingestedAtMs: Date.now(),
    };
    if (
      typeof input?.description === 'string' &&
      (input.description as string).length > 0
    ) {
      cancelMetadata.description = input.description as string;
    }

    await roots.add({
      ids: [runId],
      embeddings: [Array(Math.max(1, rootEmbeddingDim || 1)).fill(0)],
      metadatas: [cancelMetadata],
    });
  }

  jobs.set(runId, {
    runId,
    state: 'cancelled',
    counts: status?.counts ?? { files: 0, chunks: 0, embedded: 0 },
    message: 'Cancelled',
    lastError: null,
  });
  ingestLock.release(runId);
  return { cleanupState: 'complete', found: !!status } as const;
}

export async function reembed(rootPath: string, d: Deps) {
  if (ingestLock.isHeld()) {
    const error = new Error('BUSY');
    (error as { code?: string }).code = 'BUSY';
    throw error;
  }
  deps = d;
  const roots = await getRootsCollection();
  const raw = await (
    roots as unknown as {
      get: (opts: { include?: string[] }) => Promise<{
        metadatas?: Record<string, unknown>[];
      }>;
    }
  ).get({ include: ['metadatas'] });
  const metas = raw.metadatas ?? [];
  const matchIdx = metas.findIndex(
    (m) => (m as Record<string, unknown>).root === rootPath,
  );
  if (matchIdx === -1) {
    const err = new Error('NOT_FOUND');
    (err as { code?: string }).code = 'NOT_FOUND';
    throw err;
  }
  const meta = metas[matchIdx] as Record<string, unknown>;
  const name = (meta.name as string) ?? 'repo';
  const description =
    typeof meta.description === 'string' || meta.description === null
      ? (meta.description as string | null)
      : null;
  const model = (meta.model as string) ?? '';

  await deleteVectors({ where: { root: rootPath } });
  await deleteRoots({ where: { root: rootPath } });

  return startIngest(
    {
      path: rootPath,
      name,
      description: description ?? undefined,
      model,
    },
    d,
  );
}

export async function removeRoot(rootPath: string) {
  baseLogger.info({ rootPath }, 'removeRoot start');
  await deleteVectors({ where: { root: rootPath } });
  baseLogger.info({ rootPath }, 'removeRoot vectors deleted');
  await deleteRoots({ where: { root: rootPath } });
  baseLogger.info({ rootPath }, 'removeRoot roots deleted');
  await resetLocksIfEmpty();
  const unlocked = !(await getLockedModel());
  baseLogger.info({ rootPath, unlocked }, 'removeRoot done');
  return { unlocked };
}
