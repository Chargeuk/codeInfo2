import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { LogEntry } from '@codeinfo2/common';
import type { EmbeddingModel, LMStudioClient } from '@lmstudio/sdk';
import type { Metadata } from 'chromadb';
import { append as appendLog } from '../logStore.js';
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
  operation?: 'start' | 'reembed';
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

function logLifecycle(
  level: LogEntry['level'],
  message: string,
  context: Record<string, unknown>,
) {
  const cleanedContext = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  );

  const entry: LogEntry = {
    level,
    source: 'server',
    message,
    timestamp: new Date().toISOString(),
    context: cleanedContext,
  };

  appendLog(entry);
  const logger = level === 'error' ? baseLogger.error : baseLogger.info;
  logger.call(baseLogger, { ...cleanedContext }, message);
}

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
    const {
      path: startPath,
      name,
      description,
      model,
      dryRun,
      operation: op,
    } = input;
    const operation = op ?? 'start';
    logLifecycle('info', 'ingest start', {
      runId,
      operation,
      path: startPath,
      name,
      description,
      model,
      state: 'start',
    });
    jobs.set(runId, {
      ...status,
      state: 'scanning',
      message: 'Discovering files',
    });
    const ingestConfig = resolveConfig();
    const { files, root } = await discoverFiles(startPath, ingestConfig);
    jobInputs.set(runId, { ...input, root });
    if (files.length === 0) {
      if (operation === 'reembed') {
        const skipMessage = `No changes detected for ${startPath}`;
        const counts = { files: 0, chunks: 0, embedded: 0 };
        jobs.set(runId, {
          runId,
          state: 'skipped',
          counts,
          message: skipMessage,
          lastError: null,
        });
        logLifecycle('info', 'ingest skipped', {
          runId,
          operation,
          path: startPath,
          root,
          model,
          name,
          description,
          state: 'skipped',
          counts,
        });
        ingestLock.release(runId);
        return;
      }
      const errorMsg = `No eligible files found in ${startPath}`;
      jobs.set(runId, {
        runId,
        state: 'error',
        counts: { files: 0, chunks: 0, embedded: 0 },
        message: errorMsg,
        lastError: errorMsg,
      });
      logLifecycle('error', 'ingest error', {
        runId,
        operation,
        path: startPath,
        root,
        model,
        name,
        description,
        state: 'error',
        lastError: errorMsg,
        counts: { files: 0, chunks: 0, embedded: 0 },
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

    const idsBatch: string[] = [];
    const documentsBatch: string[] = [];
    const embeddingsBatch: number[][] = [];
    const metadatasBatch: Record<string, unknown>[] = [];
    let vectorDim = 1;
    let filesSinceFlush = 0;

    const clearBatch = () => {
      idsBatch.length = 0;
      documentsBatch.length = 0;
      embeddingsBatch.length = 0;
      metadatasBatch.length = 0;
      filesSinceFlush = 0;
    };

    const flushBatch = async () => {
      if (dryRun || embeddingsBatch.length === 0) {
        clearBatch();
        return;
      }

      await vectors.add({
        ids: [...idsBatch],
        documents: [...documentsBatch],
        embeddings: [...embeddingsBatch],
        metadatas: metadatasBatch as Metadata[],
      });

      vectorDim = embeddingsBatch[0]?.length ?? vectorDim;
      counts.embedded += embeddingsBatch.length;
      const locked = await getLockedModel();
      if (!locked) {
        await setLockedModel(model);
      }

      clearBatch();
    };

    for (const file of files) {
      if (cancelledRuns.has(runId)) {
        clearBatch();
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
        logLifecycle('info', 'ingest cancelled', {
          runId,
          operation,
          path: startPath,
          root,
          model,
          name,
          description,
          state: 'cancelled',
          counts,
        });
        return;
      }

      const text = await fs.readFile(file.absPath, 'utf8');
      const chunks = await chunkText(
        text,
        (await deps
          ?.lmClientFactory(deps.baseUrl)
          .embedding.model(model)) as unknown as EmbeddingModel,
        ingestConfig,
      );
      const fileHash = await hashFile(file.absPath);
      for (const chunk of chunks) {
        const chunkHash = hashChunk(file.relPath, chunk.chunkIndex, chunk.text);
        const embedding = dryRun ? [0] : await embedText(model, chunk.text);
        if (!dryRun && embedding.length > 0) {
          vectorDim = embedding.length;
        }
        if (!dryRun) {
          idsBatch.push(`${runId}:${file.relPath}:${chunk.chunkIndex}`);
          documentsBatch.push(chunk.text);
          embeddingsBatch.push(embedding);
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
          metadatasBatch.push(metadata);
        }
      }
      counts.chunks += chunks.length;
      filesSinceFlush += 1;
      if (filesSinceFlush >= ingestConfig.flushEvery) {
        await flushBatch();
      }
    }

    await flushBatch();

    const resultState =
      !dryRun && counts.embedded === 0 ? 'skipped' : 'completed';
    const rootEmbeddingDim = existingRootDim || vectorDim || 1;
    const rootMetadata: Metadata = {
      runId,
      root,
      name,
      model,
      files: counts.files,
      chunks: counts.chunks,
      embedded: counts.embedded,
      state: resultState,
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
      state: resultState,
      counts,
      message: resultState === 'skipped' ? 'No changes detected' : 'Completed',
      lastError: null,
    });
    logLifecycle(
      'info',
      resultState === 'skipped' ? 'ingest skipped' : 'ingest completed',
      {
        runId,
        operation,
        path: startPath,
        root,
        model,
        name,
        description,
        state: resultState,
        counts,
      },
    );
  } catch (err) {
    const errorMessage = (err as Error)?.message ?? 'Unknown error';
    baseLogger.error(
      {
        runId,
        error: errorMessage,
        stack: (err as Error)?.stack,
      },
      '[ingestJob] run failed',
    );
    jobs.set(runId, {
      runId,
      state: 'error',
      counts: { files: 0, chunks: 0, embedded: 0 },
      message: 'Failed',
      lastError: errorMessage,
    });
    logLifecycle('error', 'ingest error', {
      runId,
      operation: input.operation ?? 'start',
      path: input.path,
      model: input.model,
      name: input.name,
      description: input.description,
      state: 'error',
      lastError: errorMessage,
      counts: { files: 0, chunks: 0, embedded: 0 },
    });
  } finally {
    ingestLock.release(runId);
  }
}

export async function startIngest(input: IngestJobInput, d: Deps) {
  deps = d;
  const operation = input.operation ?? 'start';
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
    void processRun(runId, { ...input, operation });
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
  logLifecycle('info', 'ingest cancelled', {
    runId,
    operation: input?.operation ?? 'start',
    path: input?.path,
    root,
    model: input?.model,
    name: input?.name,
    description: input?.description,
    state: 'cancelled',
    counts: status?.counts ?? { files: 0, chunks: 0, embedded: 0 },
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
      operation: 'reembed',
    },
    d,
  );
}

export async function removeRoot(rootPath: string) {
  const runId = `remove-${Date.now()}`;
  logLifecycle('info', 'ingest remove start', {
    runId,
    operation: 'remove',
    root: rootPath,
    state: 'start',
  });
  baseLogger.info({ rootPath }, 'removeRoot start');
  await deleteVectors({ where: { root: rootPath } });
  baseLogger.info({ rootPath }, 'removeRoot vectors deleted');
  await deleteRoots({ where: { root: rootPath } });
  baseLogger.info({ rootPath }, 'removeRoot roots deleted');
  await resetLocksIfEmpty();
  const unlocked = !(await getLockedModel());
  baseLogger.info({ rootPath, unlocked }, 'removeRoot done');
  logLifecycle('info', 'ingest remove completed', {
    runId,
    operation: 'remove',
    root: rootPath,
    state: 'completed',
    counts: { files: 0, chunks: 0, embedded: 0 },
    unlocked,
  });
  return { unlocked };
}
