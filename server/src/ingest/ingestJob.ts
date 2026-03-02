import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { LogEntry } from '@codeinfo2/common';
import type { LMStudioClient } from '@lmstudio/sdk';
import type { Metadata } from 'chromadb';
import mongoose from 'mongoose';
import { parseAstSource } from '../ast/parser.js';
import { append as appendLog } from '../logStore.js';
import { baseLogger } from '../logger.js';
import {
  clearAstCoverageByRoot,
  clearAstEdgesByRoot,
  clearAstModuleImportsByRoot,
  clearAstReferencesByRoot,
  clearAstSymbolsByRoot,
  clearIngestFilesByRoot,
  deleteAstEdgesByRelPaths,
  deleteAstModuleImportsByRelPaths,
  deleteAstReferencesByRelPaths,
  deleteAstSymbolsByRelPaths,
  deleteIngestFilesByRelPaths,
  listIngestFilesByRoot,
  upsertAstCoverage,
  upsertAstEdges,
  upsertAstModuleImports,
  upsertAstReferences,
  upsertAstSymbols,
  upsertIngestFiles,
} from '../mongo/repo.js';
import type {
  AstEdgeRecord,
  AstModuleImportRecord,
  AstReferenceRecord,
  AstSymbolRecord,
} from '../mongo/repo.js';
import { broadcastIngestUpdate } from '../ws/server.js';
import {
  clearLockedModel,
  collectionIsEmpty,
  deleteRoots,
  deleteVectors,
  deleteVectorsCollectionIfEmpty,
  getLockedEmbeddingModel,
  getLockedModel,
  getRootsCollection,
  getVectorsCollection,
  InvalidLockMetadataError,
  setLockedModel,
} from './chromaClient.js';
import { buildDeltaPlan, type DiscoveredFileHash } from './deltaPlan.js';
import * as ingestLock from './lock.js';
import type { IngestRunState } from './types.js';
import {
  chunkText,
  discoverFiles,
  hashChunk,
  hashFile,
  resolveConfig,
} from './index.js';
import type { ProviderEmbeddingModel } from './providers/types.js';
import {
  appendIngestFailureLog,
  createLmStudioEmbeddingProvider,
  createOpenAiEmbeddingProvider,
  isOpenAiAllowlistedEmbeddingModel,
  logOpenAiContractMapping,
  mapLmStudioIngestError,
  resolveOpenAiRestStatus,
  toNormalizedOpenAiErrorPayload,
  OpenAiEmbeddingError,
  type ResolvedEmbeddingModelSelection,
  resolveEmbeddingModelSelection,
} from './providers/index.js';

export type IngestJobInput = {
  path: string;
  name: string;
  description?: string;
  model: string;
  embeddingProvider?: 'lmstudio' | 'openai';
  embeddingModel?: string;
  dryRun?: boolean;
  operation?: 'start' | 'reembed';
};

export type IngestNormalizedError = {
  error: string;
  message: string;
  retryable: boolean;
  provider: 'lmstudio' | 'openai';
  upstreamStatus?: number;
  retryAfterMs?: number;
};

export type IngestAstCounts = {
  supportedFileCount: number;
  skippedFileCount: number;
  failedFileCount: number;
};

export type IngestJobStatus = {
  runId: string;
  state: IngestRunState;
  counts: { files: number; chunks: number; embedded: number };
  ast?: IngestAstCounts;
  message?: string;
  lastError?: string | null;
  error?: IngestNormalizedError | null;
  currentFile?: string;
  fileIndex?: number;
  fileTotal?: number;
  percent?: number;
  etaMs?: number;
};

export type WaitForTerminalIngestStatusOptions = {
  timeoutMs: number;
  pollMs: number;
};

export type WaitForTerminalIngestStatusResult = {
  reason: 'terminal' | 'timeout' | 'missing';
  status: IngestJobStatus | null;
  lastKnown: IngestJobStatus | null;
};

type Deps = {
  lmClientFactory: (baseUrl: string) => LMStudioClient;
  baseUrl: string;
};

const jobs = new Map<string, IngestJobStatus>();
let deps: Deps | null = null;
const jobInputs = new Map<string, IngestJobInput & { root?: string }>();
const cancelledRuns = new Set<string>();
const terminalStates = new Set<IngestRunState>([
  'completed',
  'cancelled',
  'skipped',
  'error',
]);
const astSupportedExtensions = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'cs',
  'rs',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'hxx',
  'h',
]);

function setStatusAndPublish(runId: string, nextStatus: IngestJobStatus) {
  jobs.set(runId, nextStatus);
  broadcastIngestUpdate(nextStatus);
}

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

function logWarning(message: string, context: Record<string, unknown>) {
  const cleanedContext = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  );

  const entry: LogEntry = {
    level: 'warn',
    source: 'server',
    message,
    timestamp: new Date().toISOString(),
    context: cleanedContext,
  };

  appendLog(entry);
  baseLogger.warn({ ...cleanedContext }, message);
}

function isAstSupported(ext: string) {
  return astSupportedExtensions.has(ext.toLowerCase());
}

export function setIngestDeps(next: Deps) {
  deps = next;
}

export function isBusy() {
  return ingestLock.isHeld();
}

async function embedText(modelKey: string, text: string): Promise<number[]> {
  const model = await getEmbeddingModel(modelKey);
  return model.embedText(text);
}

function resolveInputSelection(
  input: Pick<IngestJobInput, 'model' | 'embeddingProvider' | 'embeddingModel'>,
): ResolvedEmbeddingModelSelection {
  if (input.embeddingProvider && input.embeddingModel) {
    return {
      providerId: input.embeddingProvider,
      modelKey: input.embeddingModel,
    };
  }
  return resolveEmbeddingModelSelection(input.model);
}

function mapIngestError(err: unknown): {
  message: string;
  normalized: IngestNormalizedError | null;
} {
  if (err instanceof OpenAiEmbeddingError) {
    const payload = toNormalizedOpenAiErrorPayload(err);
    logOpenAiContractMapping({
      surface: 'ingest',
      payload,
      statusCode: resolveOpenAiRestStatus(err),
    });
    return {
      message: payload.message,
      normalized: payload,
    };
  }
  const lmstudio = mapLmStudioIngestError(err);
  return {
    message: lmstudio.message,
    normalized: {
      error: lmstudio.error,
      message: lmstudio.message,
      retryable: lmstudio.retryable,
      provider: lmstudio.provider,
    },
  };
}

function toProviderQualifiedModelId(
  selection: ResolvedEmbeddingModelSelection,
) {
  return selection.providerId === 'lmstudio'
    ? selection.modelKey
    : `${selection.providerId}/${selection.modelKey}`;
}

async function getEmbeddingModel(
  modelKey: string,
  options?: {
    ingestFailureContext?: () => {
      runId?: string;
      path?: string;
      root?: string;
      currentFile?: string;
    };
  },
): Promise<ProviderEmbeddingModel> {
  const d = deps;
  if (!d) throw new Error('ingest deps not set');

  const selection = resolveEmbeddingModelSelection(modelKey);
  if (selection.providerId === 'openai') {
    const provider = createOpenAiEmbeddingProvider({
      apiKey: process.env.OPENAI_EMBEDDING_KEY,
      ingestFailureContext: options?.ingestFailureContext,
    });
    return provider.getModel(selection.modelKey);
  }

  const provider = createLmStudioEmbeddingProvider({
    lmClientResolver: d.lmClientFactory,
    baseUrl: d.baseUrl,
    ingestFailureContext: options?.ingestFailureContext,
  });

  return provider.getModel(selection.modelKey);
}

async function resolveRootEmbeddingDim(params: {
  existingRootDim?: number;
  vectorDim?: number;
  modelKey: string;
}): Promise<number> {
  if (params.existingRootDim && params.existingRootDim > 0) {
    return params.existingRootDim;
  }
  if (params.vectorDim && params.vectorDim > 1) {
    return params.vectorDim;
  }

  try {
    const vectors = await getVectorsCollection();
    const raw = await (
      vectors as unknown as {
        get: (opts: { include?: string[]; limit?: number }) => Promise<{
          embeddings?: number[][];
        }>;
      }
    ).get({ include: ['embeddings'], limit: 1 });
    const dim = raw.embeddings?.[0]?.length;
    if (dim && dim > 0) return dim;
  } catch (error) {
    logWarning('ingest root dimension probe fallback', {
      model: params.modelKey,
      stage: 'vectors_collection_probe',
      fallback: 'embedding_probe',
      reason:
        error instanceof Error
          ? error.message.slice(0, 300)
          : String(error ?? 'unknown').slice(0, 300),
    });
  }

  try {
    const probe = await embedText(params.modelKey, 'dimension probe');
    if (probe.length > 0) return probe.length;
  } catch (error) {
    logWarning('ingest root dimension probe fallback', {
      model: params.modelKey,
      stage: 'embedding_probe',
      fallback: 'dimension=1',
      reason:
        error instanceof Error
          ? error.message.slice(0, 300)
          : String(error ?? 'unknown').slice(0, 300),
    });
  }

  return 1;
}

async function processRun(runId: string, input: IngestJobInput) {
  const status = jobs.get(runId);
  if (!status) return;
  jobInputs.set(runId, input);
  try {
    const ingestedAtMs = Date.now();
    const { path: startPath, name, description, dryRun, operation: op } = input;
    const requestedSelection = resolveInputSelection(input);
    const embeddingProvider = requestedSelection.providerId;
    const embeddingModel = requestedSelection.modelKey;
    const operation = op ?? 'start';
    logLifecycle('info', 'ingest start', {
      runId,
      operation,
      path: startPath,
      name,
      description,
      model: embeddingModel,
      embeddingProvider,
      state: 'start',
    });
    setStatusAndPublish(runId, {
      ...status,
      state: 'scanning',
      message: 'Discovering files',
    });
    const ingestConfig = resolveConfig();
    const { files, root } = await discoverFiles(startPath, ingestConfig);
    jobInputs.set(runId, { ...input, root });
    if (files.length === 0 && operation !== 'reembed') {
      const errorMsg = `No eligible files found in ${startPath}`;
      setStatusAndPublish(runId, {
        runId,
        state: 'error',
        counts: { files: 0, chunks: 0, embedded: 0 },
        message: errorMsg,
        lastError: errorMsg,
        error: {
          error: 'NO_ELIGIBLE_FILES',
          message: errorMsg,
          retryable: false,
          provider: requestedSelection.providerId,
        },
      });
      logLifecycle('error', 'ingest error', {
        runId,
        operation,
        path: startPath,
        root,
        model: embeddingModel,
        embeddingProvider,
        name,
        description,
        state: 'error',
        lastError: errorMsg,
        counts: { files: 0, chunks: 0, embedded: 0 },
      });
      ingestLock.release(runId);
      return;
    }

    type DeltaMode = 'delta' | 'legacy_upgrade' | 'degraded_full' | null;
    let deltaMode: DeltaMode = null;
    let deltaPlan: ReturnType<typeof buildDeltaPlan> | null | undefined = null;
    let previousIndex:
      | Awaited<ReturnType<typeof listIngestFilesByRoot>>
      | undefined;
    let discoveredWithHashes: DiscoveredFileHash[] | null = null;

    if (operation === 'reembed') {
      previousIndex = await listIngestFilesByRoot(root);
      if (previousIndex === null) {
        deltaMode = 'degraded_full';
        logLifecycle('info', '0000020 ingest delta mode decided', {
          root,
          mode: deltaMode,
        });
      } else {
        discoveredWithHashes = await Promise.all(
          files.map(async (file) => ({
            absPath: file.absPath,
            relPath: file.relPath,
            fileHash: await hashFile(file.absPath),
          })),
        );

        if (previousIndex.length === 0) {
          deltaMode = 'legacy_upgrade';
          logLifecycle('info', '0000020 ingest delta mode decided', {
            root,
            mode: deltaMode,
          });
        } else {
          deltaMode = 'delta';
          deltaPlan = buildDeltaPlan({
            previous: previousIndex,
            discovered: discoveredWithHashes,
          });
          logLifecycle('info', '0000020 ingest delta mode decided', {
            root,
            mode: deltaMode,
          });
          logLifecycle('info', '0000020 ingest delta plan summary', {
            root,
            added: deltaPlan.added.length,
            changed: deltaPlan.changed.length,
            deleted: deltaPlan.deleted.length,
            unchanged: deltaPlan.unchanged.length,
          });
        }
      }
    }

    const deltaWorkCount =
      operation === 'reembed' && deltaMode === 'delta' && deltaPlan
        ? deltaPlan.added.length +
          deltaPlan.changed.length +
          deltaPlan.deleted.length
        : null;

    const workFiles: { absPath: string; relPath: string; fileHash?: string }[] =
      operation === 'reembed' && deltaMode === 'delta' && deltaPlan
        ? [...deltaPlan.added, ...deltaPlan.changed]
        : files;

    const astCounts: IngestAstCounts = {
      supportedFileCount: 0,
      skippedFileCount: 0,
      failedFileCount: 0,
    };
    const astLastIndexedAt = new Date().toISOString();
    const attachAstMetadata = (metadata: Metadata) => {
      if (dryRun) return;
      metadata.astSupportedFileCount = astCounts.supportedFileCount;
      metadata.astSkippedFileCount = astCounts.skippedFileCount;
      metadata.astFailedFileCount = astCounts.failedFileCount;
      metadata.astLastIndexedAt = astLastIndexedAt;
    };
    const astSkippedExamples: string[] = [];
    const astSkippedExtensions = new Set<string>();
    const astFailedExamples: {
      relPath: string;
      error: string;
      details?: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
        snippet: string;
        nodeType?: string;
      };
    }[] = [];
    let astIngestConfigLogged = false;
    for (const file of files) {
      const ext = file.ext ?? path.extname(file.relPath).slice(1);
      if (isAstSupported(ext)) {
        astCounts.supportedFileCount += 1;
      } else {
        astCounts.skippedFileCount += 1;
        if (ext) {
          astSkippedExtensions.add(ext.toLowerCase());
        }
        if (astSkippedExamples.length < 5) {
          astSkippedExamples.push(file.relPath);
        }
      }
    }
    if (!astIngestConfigLogged) {
      astIngestConfigLogged = true;
      logLifecycle('info', 'DEV-0000033:T4:ast-ingest-config', {
        event: 'DEV-0000033:T4:ast-ingest-config',
        root,
        supportedExtensions: Array.from(astSupportedExtensions).sort(),
      });
    }
    const astSymbols: AstSymbolRecord[] = [];
    const astEdges: AstEdgeRecord[] = [];
    const astReferences: AstReferenceRecord[] = [];
    const astModuleImports: AstModuleImportRecord[] = [];
    let astGrammarFailureLogged = false;
    const deltaSkipMessage =
      operation === 'reembed' && deltaMode === 'delta' && deltaWorkCount === 0
        ? `No changes detected for ${root}`
        : undefined;
    let finalSkipMessage = deltaSkipMessage;

    const counts = { files: workFiles.length, chunks: 0, embedded: 0 };
    const fileTotal = workFiles.length;
    const startedAt = Date.now();
    let lastFileRelPath: string | undefined;
    setStatusAndPublish(runId, {
      ...status,
      state: 'embedding',
      counts,
      ast: astCounts,
      message:
        operation === 'reembed' && deltaMode === 'delta'
          ? `Embedding ${workFiles.length} changed/new files`
          : `Embedding ${workFiles.length} files`,
      currentFile: undefined,
      fileIndex: 0,
      fileTotal,
      percent: 0,
      etaMs: undefined,
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
    const fileHashesByRelPath = new Map<string, string>();
    const discoveredHashByRelPath = new Map<string, string>();
    if (discoveredWithHashes) {
      for (const file of discoveredWithHashes) {
        discoveredHashByRelPath.set(file.relPath, file.fileHash);
      }
    }

    const clearBatch = () => {
      idsBatch.length = 0;
      documentsBatch.length = 0;
      embeddingsBatch.length = 0;
      metadatasBatch.length = 0;
      filesSinceFlush = 0;
    };

    const clearAstBatches = () => {
      astSymbols.length = 0;
      astEdges.length = 0;
      astReferences.length = 0;
      astModuleImports.length = 0;
    };

    const flushBatch = async () => {
      // Dry runs should never write to Chroma; clear the batch and return early.
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
      const locked = await getLockedEmbeddingModel();
      if (!locked) {
        // If the collection was dropped after an empty run, the first real write recreates the lock.
        await setLockedModel({
          embeddingProvider,
          embeddingModel,
          embeddingDimensions: embeddingsBatch[0]?.length ?? 1,
        });
      }

      clearBatch();
    };

    const progressSnapshot = (fileIndex: number, currentFile: string) => {
      lastFileRelPath = currentFile;
      const percent = Number(((fileIndex / fileTotal) * 100).toFixed(1));
      const completed = Math.max(0, fileIndex - 1);
      const elapsed = Date.now() - startedAt;
      const averagePerFile = completed > 0 ? elapsed / completed : undefined;
      const remaining = Math.max(0, fileTotal - completed);
      const etaMs =
        averagePerFile !== undefined
          ? Math.max(0, Math.round(averagePerFile * remaining))
          : undefined;

      const currentStatus = jobs.get(runId);
      if (!currentStatus) return;
      setStatusAndPublish(runId, {
        ...currentStatus,
        currentFile,
        fileIndex,
        fileTotal,
        percent,
        etaMs,
      });
    };

    if (operation === 'reembed') {
      if (deltaMode === 'degraded_full') {
        await deleteVectors({ where: { root } });
      } else if (deltaMode === 'legacy_upgrade') {
        await deleteVectors({ where: { root } });
        await deleteRoots({ where: { root } });
      } else if (deltaMode === 'delta' && deltaPlan) {
        if ((deltaWorkCount ?? 0) === 0) {
          logLifecycle('info', '0000020 ingest delta no-op skipped', { root });
        }
      }
    }

    const astWritesEnabled = !dryRun && mongoose.connection.readyState === 1;
    if (!astWritesEnabled && !dryRun) {
      logWarning('AST indexing skipped; MongoDB is unavailable', {
        root,
        reason: 'mongo_disconnected',
      });
    }

    if (astCounts.skippedFileCount > 0) {
      logWarning('AST indexing skipped for unsupported language files', {
        root,
        skippedFileCount: astCounts.skippedFileCount,
        skippedExtensions: Array.from(astSkippedExtensions).sort(),
        examplePaths: astSkippedExamples,
        reason: 'unsupported_language',
      });
    }

    if (
      operation === 'start' ||
      (operation === 'reembed' && deltaMode !== 'delta')
    ) {
      if (astWritesEnabled) {
        await clearAstSymbolsByRoot(root);
        await clearAstEdgesByRoot(root);
        await clearAstReferencesByRoot(root);
        await clearAstModuleImportsByRoot(root);
        await clearAstCoverageByRoot(root);
      }
    }

    if (operation === 'reembed' && deltaMode === 'delta' && deltaPlan) {
      if (deltaPlan.deleted.length > 0 && workFiles.length === 0) {
        logLifecycle('info', '0000020 ingest delta deletions-only', {
          root,
          deleted: deltaPlan.deleted.length,
        });
        finalSkipMessage = `Removed vectors for ${deltaPlan.deleted.length} deleted file(s)`;

        for (const file of deltaPlan.deleted) {
          await deleteVectors({
            where: { $and: [{ root }, { relPath: file.relPath }] },
          });
        }

        await deleteIngestFilesByRelPaths({
          root,
          relPaths: deltaPlan.deleted.map((f) => f.relPath),
        });
      }
    }

    const handleCancellation = async (
      fileIndex: number,
      currentFile: string,
    ) => {
      if (!cancelledRuns.has(runId)) return false;
      clearBatch();
      clearAstBatches();
      setStatusAndPublish(runId, {
        runId,
        state: 'cancelled',
        counts,
        ast: astCounts,
        message: 'Cancelled',
        lastError: null,
        error: null,
        currentFile: lastFileRelPath ?? currentFile,
        fileIndex,
        fileTotal,
        percent: Number(
          ((fileIndex / Math.max(1, fileTotal)) * 100).toFixed(1),
        ),
      });
      await deleteVectors({ where: { runId } });
      await deleteRoots({ where: { root } });
      await deleteVectorsCollectionIfEmpty();
      const rootEmbeddingDim = await resolveRootEmbeddingDim({
        existingRootDim,
        vectorDim,
        modelKey: toProviderQualifiedModelId(requestedSelection),
      });
      const cancelMetadata: Metadata = {
        runId,
        root,
        name,
        model: embeddingModel,
        embeddingProvider,
        embeddingModel,
        embeddingDimensions: rootEmbeddingDim,
        files: counts.files,
        chunks: counts.chunks,
        embedded: counts.embedded,
        state: 'cancelled',
        lastIngestAt: new Date().toISOString(),
        ingestedAtMs,
      };
      attachAstMetadata(cancelMetadata);
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
        model: embeddingModel,
        embeddingProvider,
        embeddingModel,
        name,
        description,
        state: 'cancelled',
        counts,
      });
      return true;
    };

    for (const [idx, file] of files.entries()) {
      const fileIndex = idx + 1;
      if (await handleCancellation(fileIndex, file.relPath)) {
        return;
      }

      const astExt = file.ext ?? path.extname(file.relPath).slice(1);
      if (!isAstSupported(astExt)) {
        continue;
      }

      const text = await fs.readFile(file.absPath, 'utf8');
      const fileHash =
        discoveredHashByRelPath.get(file.relPath) ??
        (await hashFile(file.absPath));
      fileHashesByRelPath.set(file.relPath, fileHash);

      const astResult = await parseAstSource({
        root,
        text,
        relPath: file.relPath,
        fileHash,
      });
      if (astResult.status === 'ok') {
        astSymbols.push(...astResult.symbols);
        astEdges.push(...astResult.edges);
        astReferences.push(...astResult.references);
        astModuleImports.push(...astResult.imports);
      } else {
        astCounts.failedFileCount += 1;
        if (astFailedExamples.length < 5) {
          astFailedExamples.push({
            relPath: file.relPath,
            error: astResult.error,
            ...(astResult.details ? { details: astResult.details } : {}),
          });
        }
        const errorMessage = astResult.error.toLowerCase();
        if (!astGrammarFailureLogged && errorMessage.includes('grammar')) {
          astGrammarFailureLogged = true;
          logWarning('Tree-sitter grammar failed to load', {
            root,
            relPath: file.relPath,
            error: astResult.error,
          });
        }
      }
    }

    if (astCounts.failedFileCount > 0) {
      logWarning('AST indexing failed for file(s)', {
        root,
        failedFileCount: astCounts.failedFileCount,
        exampleFailures: astFailedExamples,
      });
    }

    for (const [idx, file] of workFiles.entries()) {
      const fileIndex = idx + 1;
      progressSnapshot(fileIndex, file.relPath);
      if (await handleCancellation(fileIndex, file.relPath)) {
        return;
      }

      const text = await fs.readFile(file.absPath, 'utf8');
      const fileHash =
        file.fileHash ??
        fileHashesByRelPath.get(file.relPath) ??
        (await hashFile(file.absPath));
      fileHashesByRelPath.set(file.relPath, fileHash);
      const embeddingModelClient = await getEmbeddingModel(
        toProviderQualifiedModelId(requestedSelection),
        {
          ingestFailureContext: () => ({
            runId,
            path: startPath,
            root,
            currentFile: lastFileRelPath,
          }),
        },
      );
      const chunks = await chunkText(text, embeddingModelClient, ingestConfig);
      for (const chunk of chunks) {
        const chunkHash = hashChunk(file.relPath, chunk.chunkIndex, chunk.text);
        const embedding = await embeddingModelClient.embedText(chunk.text);
        if (embedding.length > 0) {
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
            model: embeddingModel,
            embeddingProvider,
            embeddingModel,
            embeddingDimensions: embedding.length,
            name,
          };
          if (description) metadata.description = description;
          metadatasBatch.push(metadata);
        }
      }
      counts.chunks += chunks.length;
      if (dryRun) {
        counts.embedded += chunks.length;
      }
      filesSinceFlush += 1;
      if (filesSinceFlush >= ingestConfig.flushEvery) {
        await flushBatch();
      }
      progressSnapshot(fileIndex, file.relPath);
    }

    await flushBatch();

    if (operation === 'reembed' && deltaMode === 'delta' && deltaPlan) {
      for (const file of deltaPlan.changed) {
        await deleteVectors({
          where: {
            $and: [
              { root },
              { relPath: file.relPath },
              { fileHash: { $ne: file.fileHash } },
            ],
          },
        });
      }

      for (const file of deltaPlan.deleted) {
        await deleteVectors({
          where: { $and: [{ root }, { relPath: file.relPath }] },
        });
      }
    }

    if (counts.embedded === 0) {
      await deleteVectorsCollectionIfEmpty();
    }

    const resultState =
      !dryRun && counts.embedded === 0 ? 'skipped' : 'completed';
    const rootEmbeddingDim = await resolveRootEmbeddingDim({
      existingRootDim,
      vectorDim,
      modelKey: toProviderQualifiedModelId(requestedSelection),
    });
    const rootMetadata: Metadata = {
      runId,
      root,
      name,
      model: embeddingModel,
      embeddingProvider,
      embeddingModel,
      embeddingDimensions: rootEmbeddingDim,
      files: counts.files,
      chunks: counts.chunks,
      embedded: counts.embedded,
      state: resultState,
      lastIngestAt: new Date().toISOString(),
      ingestedAtMs,
    };
    attachAstMetadata(rootMetadata);
    if (description) rootMetadata.description = description;

    await roots.add({
      ids: [runId],
      embeddings: [Array(rootEmbeddingDim).fill(0)],
      metadatas: [rootMetadata],
    });

    if (!dryRun && operation === 'start') {
      await clearIngestFilesByRoot(root);
      await upsertIngestFiles({
        root,
        files: files
          .map((file) => ({
            relPath: file.relPath,
            fileHash: fileHashesByRelPath.get(file.relPath),
          }))
          .filter((row): row is { relPath: string; fileHash: string } =>
            Boolean(row.fileHash),
          ),
      });
    }

    if (!dryRun && operation === 'reembed') {
      if (deltaMode === 'legacy_upgrade') {
        await clearIngestFilesByRoot(root);
        await upsertIngestFiles({
          root,
          files:
            discoveredWithHashes?.map((file) => ({
              relPath: file.relPath,
              fileHash: file.fileHash,
            })) ?? [],
        });
      } else if (deltaMode === 'delta' && deltaPlan) {
        await upsertIngestFiles({
          root,
          files: [...deltaPlan.added, ...deltaPlan.changed].map((file) => ({
            relPath: file.relPath,
            fileHash: file.fileHash,
          })),
        });
        await deleteIngestFilesByRelPaths({
          root,
          relPaths: deltaPlan.deleted.map((file) => file.relPath),
        });
      }
    }

    if (astWritesEnabled) {
      if (operation === 'reembed' && deltaMode === 'delta' && deltaPlan) {
        const deleteRelPaths = [...deltaPlan.changed, ...deltaPlan.deleted].map(
          (file) => file.relPath,
        );
        if (deleteRelPaths.length > 0) {
          await deleteAstSymbolsByRelPaths({ root, relPaths: deleteRelPaths });
          await deleteAstEdgesByRelPaths({ root, relPaths: deleteRelPaths });
          await deleteAstReferencesByRelPaths({
            root,
            relPaths: deleteRelPaths,
          });
          await deleteAstModuleImportsByRelPaths({
            root,
            relPaths: deleteRelPaths,
          });
        }
      }

      await upsertAstSymbols({ root, symbols: astSymbols });
      await upsertAstEdges({ root, edges: astEdges });
      await upsertAstReferences({ root, references: astReferences });
      await upsertAstModuleImports({ root, modules: astModuleImports });
      await upsertAstCoverage({
        root,
        coverage: {
          root,
          ...astCounts,
          lastIndexedAt: new Date(),
        },
      });
      logLifecycle('info', 'DEV-0000032:T5:ast-index-complete', {
        event: 'DEV-0000032:T5:ast-index-complete',
        root,
        ...astCounts,
      });
    }

    setStatusAndPublish(runId, {
      runId,
      state: resultState,
      counts,
      ast: astCounts,
      message:
        resultState === 'skipped'
          ? (finalSkipMessage ?? 'No changes detected')
          : 'Completed',
      lastError: null,
      error: null,
      currentFile: lastFileRelPath,
      fileIndex: fileTotal,
      fileTotal,
      percent: Number(((fileTotal / fileTotal) * 100).toFixed(1)),
      etaMs: 0,
    });
    logLifecycle(
      'info',
      resultState === 'skipped' ? 'ingest skipped' : 'ingest completed',
      {
        runId,
        operation,
        path: startPath,
        root,
        model: embeddingModel,
        embeddingProvider,
        embeddingModel,
        name,
        description,
        state: resultState,
        counts,
      },
    );
  } catch (err) {
    const mappedError = mapIngestError(err);
    const errorMessage = mappedError.message;
    const currentStatus = jobs.get(runId);
    baseLogger.error(
      {
        runId,
        error: errorMessage,
        stack: (err as Error)?.stack,
      },
      '[ingestJob] run failed',
    );
    setStatusAndPublish(runId, {
      runId,
      state: 'error',
      counts: currentStatus?.counts ?? { files: 0, chunks: 0, embedded: 0 },
      ast: currentStatus?.ast,
      message: 'Failed',
      lastError: errorMessage,
      error: mappedError.normalized,
      currentFile: currentStatus?.currentFile,
      fileIndex: currentStatus?.fileIndex,
      fileTotal: currentStatus?.fileTotal,
      percent: currentStatus?.percent,
      etaMs: currentStatus?.etaMs,
    });
    const selectedForErrorLog = resolveInputSelection(input);
    if (mappedError.normalized?.provider === 'lmstudio') {
      appendIngestFailureLog('error', {
        runId,
        provider: 'lmstudio',
        code: mappedError.normalized.error,
        retryable: mappedError.normalized.retryable,
        model: selectedForErrorLog.modelKey,
        path: input.path,
        root: jobInputs.get(runId)?.root,
        currentFile: currentStatus?.currentFile,
        message: mappedError.normalized.message,
        stage: 'terminal',
      });
    }
    logLifecycle('error', 'ingest error', {
      runId,
      operation: input.operation ?? 'start',
      path: input.path,
      model: selectedForErrorLog.modelKey,
      embeddingProvider: selectedForErrorLog.providerId,
      embeddingModel: selectedForErrorLog.modelKey,
      name: input.name,
      description: input.description,
      state: 'error',
      lastError: errorMessage,
      counts: currentStatus?.counts ?? { files: 0, chunks: 0, embedded: 0 },
      error: mappedError.normalized,
    });
  } finally {
    ingestLock.release(runId);
  }
}

export async function startIngest(input: IngestJobInput, d: Deps) {
  deps = d;
  const operation = input.operation ?? 'start';
  const locked = await getLockedEmbeddingModel();
  const requested = resolveInputSelection(input);
  if (
    requested.providerId === 'openai' &&
    !isOpenAiAllowlistedEmbeddingModel(requested.modelKey)
  ) {
    const error = new Error('OPENAI_MODEL_UNAVAILABLE');
    (error as { code?: string }).code = 'OPENAI_MODEL_UNAVAILABLE';
    throw error;
  }
  if (
    locked &&
    (locked.embeddingProvider !== requested.providerId ||
      locked.embeddingModel !== requested.modelKey)
  ) {
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
  setStatusAndPublish(runId, {
    runId,
    state: 'queued',
    counts: { files: 0, chunks: 0, embedded: 0 },
    message: 'Queued',
    lastError: null,
    error: null,
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

export async function waitForTerminalIngestStatus(
  runId: string,
  options: WaitForTerminalIngestStatusOptions,
): Promise<WaitForTerminalIngestStatusResult> {
  const timeoutMs = Math.max(1, options.timeoutMs);
  const pollMs = Math.max(1, options.pollMs);
  const startMs = Date.now();
  let lastKnown: IngestJobStatus | null = null;

  while (Date.now() - startMs <= timeoutMs) {
    const current = getStatus(runId);
    if (!current) {
      return { reason: 'missing', status: null, lastKnown };
    }
    lastKnown = current;
    if (terminalStates.has(current.state)) {
      return { reason: 'terminal', status: current, lastKnown };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return { reason: 'timeout', status: null, lastKnown };
}

export function getActiveStatus(): IngestJobStatus | null {
  const lockOwner = ingestLock.currentOwner();
  let active: IngestJobStatus | null = null;

  if (lockOwner) {
    const lockedStatus = jobs.get(lockOwner);
    if (lockedStatus && !terminalStates.has(lockedStatus.state)) {
      active = lockedStatus;
    }
  }

  if (!active) {
    for (const status of jobs.values()) {
      if (!terminalStates.has(status.state)) {
        active = status;
        break;
      }
    }
  }

  logLifecycle('info', '0000022 ingest active status resolved', {
    runId: active?.runId,
    state: active?.state,
    lockOwner,
  });

  return active ?? null;
}

export async function resetLocksIfEmpty() {
  if (await collectionIsEmpty()) {
    await clearLockedModel({ reason: 'cleanup' });
  }
}

export function __setStatusForTest(runId: string, status: IngestJobStatus) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__setStatusForTest is only available in test mode');
  }
  jobs.set(runId, status);
}

export function __setStatusAndPublishForTest(
  runId: string,
  status: IngestJobStatus,
) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__setStatusAndPublishForTest is only available in test mode',
    );
  }
  setStatusAndPublish(runId, status);
}

export function __resetIngestJobsForTest() {
  if (process.env.NODE_ENV !== 'test') return;
  jobs.clear();
  jobInputs.clear();
  cancelledRuns.clear();
}

export async function cancelRun(runId: string) {
  cancelledRuns.add(runId);
  const status = jobs.get(runId);
  const input = jobInputs.get(runId);
  const root = input?.root;
  const selected =
    input?.model && input.model.length > 0
      ? resolveInputSelection(input)
      : null;

  if (status?.state === 'completed' || status?.state === 'error') {
    cancelledRuns.delete(runId);
    return { cleanupState: 'complete', found: true } as const;
  }

  if (root) {
    await deleteVectors({ where: { runId } });
    await deleteRoots({ where: { root } });
    await deleteVectorsCollectionIfEmpty();
    const roots = await getRootsCollection();
    const existingRoots = await (
      roots as unknown as {
        get: (opts: { include?: string[]; limit?: number }) => Promise<{
          embeddings?: number[][];
        }>;
      }
    ).get({ include: ['embeddings'], limit: 1 });
    const existingRootDim = existingRoots.embeddings?.[0]?.length;
    const rootEmbeddingDim = await resolveRootEmbeddingDim({
      existingRootDim,
      modelKey: input?.model ?? '',
    });

    const cancelMetadata: Metadata = {
      runId,
      root,
      name: input?.name ?? '',
      model: selected?.modelKey ?? input?.model ?? '',
      embeddingDimensions: rootEmbeddingDim,
      files: status?.counts.files ?? 0,
      chunks: status?.counts.chunks ?? 0,
      embedded: status?.counts.embedded ?? 0,
      state: 'cancelled',
      lastIngestAt: new Date().toISOString(),
      ingestedAtMs: Date.now(),
    };
    if (selected) {
      cancelMetadata.embeddingProvider = selected.providerId;
      cancelMetadata.embeddingModel = selected.modelKey;
    }
    if (status?.ast) {
      cancelMetadata.astSupportedFileCount = status.ast.supportedFileCount;
      cancelMetadata.astSkippedFileCount = status.ast.skippedFileCount;
      cancelMetadata.astFailedFileCount = status.ast.failedFileCount;
      cancelMetadata.astLastIndexedAt = new Date().toISOString();
    }
    if (
      typeof input?.description === 'string' &&
      (input.description as string).length > 0
    ) {
      cancelMetadata.description = input.description as string;
    }

    await roots.add({
      ids: [runId],
      embeddings: [Array(rootEmbeddingDim).fill(0)],
      metadatas: [cancelMetadata],
    });
  }

  setStatusAndPublish(runId, {
    runId,
    state: 'cancelled',
    counts: status?.counts ?? { files: 0, chunks: 0, embedded: 0 },
    ast: status?.ast,
    message: 'Cancelled',
    lastError: null,
    error: null,
  });
  logLifecycle('info', 'ingest cancelled', {
    runId,
    operation: input?.operation ?? 'start',
    path: input?.path,
    root,
    model: selected?.modelKey ?? input?.model,
    embeddingProvider: selected?.providerId,
    embeddingModel: selected?.modelKey,
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
        ids?: string[];
        metadatas?: Record<string, unknown>[];
      }>;
    }
  ).get({ include: ['metadatas'] });
  const metas = raw.metadatas ?? [];
  const ids = raw.ids ?? [];
  const matches = metas
    .map((meta, idx) => ({ meta, id: ids[idx] }))
    .filter(
      (entry) => (entry.meta as Record<string, unknown>).root === rootPath,
    );
  if (matches.length === 0) {
    const err = new Error('NOT_FOUND');
    (err as { code?: string }).code = 'NOT_FOUND';
    throw err;
  }

  const best = matches.reduce(
    (acc, entry) => {
      const m = (entry.meta ?? {}) as Record<string, unknown>;
      const tsRaw =
        typeof m.lastIngestAt === 'string' ? Date.parse(m.lastIngestAt) : NaN;
      const ts = Number.isFinite(tsRaw) ? tsRaw : 0;
      const accTsRaw = acc.lastIngestAt ? Date.parse(acc.lastIngestAt) : NaN;
      const accTs = Number.isFinite(accTsRaw) ? accTsRaw : 0;
      const entryRunId = typeof entry.id === 'string' ? entry.id : '';
      const accRunId = acc.runId;

      if (ts > accTs) {
        return {
          meta: m,
          runId: entryRunId,
          lastIngestAt:
            typeof m.lastIngestAt === 'string' ? m.lastIngestAt : null,
        };
      }
      if (ts === accTs && entryRunId > accRunId) {
        return {
          meta: m,
          runId: entryRunId,
          lastIngestAt:
            typeof m.lastIngestAt === 'string' ? m.lastIngestAt : null,
        };
      }
      return acc;
    },
    {
      meta: (matches[0]?.meta ?? {}) as Record<string, unknown>,
      runId:
        typeof matches[0]?.id === 'string' ? (matches[0]?.id as string) : '',
      lastIngestAt:
        typeof (matches[0]?.meta as Record<string, unknown>)?.lastIngestAt ===
        'string'
          ? ((matches[0]?.meta as Record<string, unknown>)
              ?.lastIngestAt as string)
          : null,
    },
  );

  logLifecycle('info', '0000020 ingest reembed metadata selected', {
    root: rootPath,
    selectedLastIngestAt: best.lastIngestAt,
    selectedRunId: best.runId,
  });

  const meta = best.meta;
  const currentLock = await getLockedEmbeddingModel();
  const canonicalProvider =
    typeof meta.embeddingProvider === 'string' ? meta.embeddingProvider : null;
  const canonicalModel =
    typeof meta.embeddingModel === 'string' ? meta.embeddingModel : null;
  const canonicalDimensions =
    typeof meta.embeddingDimensions === 'number' && meta.embeddingDimensions > 0
      ? meta.embeddingDimensions
      : null;
  const hasAnyCanonical =
    canonicalProvider !== null ||
    canonicalModel !== null ||
    canonicalDimensions !== null;
  if (
    hasAnyCanonical &&
    (!canonicalProvider || !canonicalModel || !canonicalDimensions)
  ) {
    throw new InvalidLockMetadataError();
  }
  const rootState = typeof meta.state === 'string' ? meta.state : null;
  if (rootState === 'cancelled' || rootState === 'error') {
    const err = new Error('INVALID_REEMBED_STATE');
    (err as { code?: string }).code = 'INVALID_REEMBED_STATE';
    throw err;
  }
  const selectedProvider = hasAnyCanonical
    ? (canonicalProvider as 'lmstudio' | 'openai')
    : 'lmstudio';
  const selectedModel = hasAnyCanonical
    ? (canonicalModel as string)
    : typeof meta.model === 'string'
      ? meta.model
      : '';
  if (!selectedModel) {
    const err = new Error('INVALID_REEMBED_STATE');
    (err as { code?: string }).code = 'INVALID_REEMBED_STATE';
    throw err;
  }
  if (
    selectedProvider === 'openai' &&
    !isOpenAiAllowlistedEmbeddingModel(selectedModel)
  ) {
    const err = new Error('OPENAI_MODEL_UNAVAILABLE');
    (err as { code?: string }).code = 'OPENAI_MODEL_UNAVAILABLE';
    throw err;
  }
  if (
    currentLock &&
    (currentLock.embeddingProvider !== selectedProvider ||
      currentLock.embeddingModel !== selectedModel)
  ) {
    const err = new Error('MODEL_LOCKED');
    (err as { code?: string }).code = 'MODEL_LOCKED';
    throw err;
  }
  const name = (meta.name as string) ?? 'repo';
  const description =
    typeof meta.description === 'string' || meta.description === null
      ? (meta.description as string | null)
      : null;
  const model =
    selectedProvider === 'lmstudio'
      ? selectedModel
      : `${selectedProvider}/${selectedModel}`;

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
  const collectionDeleted = await deleteVectorsCollectionIfEmpty();
  if (!collectionDeleted) {
    if (await collectionIsEmpty()) {
      await clearLockedModel({ reason: 'remove' });
    }
  }
  const unlocked = collectionDeleted ? true : !(await getLockedModel());
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
