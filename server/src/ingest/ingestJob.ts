import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { EventEmitter } from 'node:events';
import path from 'path';
import { LogEntry } from '@codeinfo2/common';
import type { LMStudioClient } from '@lmstudio/sdk';
import type { Collection, Metadata } from 'chromadb';
import mongoose from 'mongoose';
import { parseAstSource } from '../ast/parser.js';
import { append as appendLog } from '../logStore.js';
import { baseLogger } from '../logger.js';
import {
  clearIngestFilesByRoot,
  deleteStaleAstEdgesByRootFiles,
  deleteStaleAstModuleImportsByRootFiles,
  deleteStaleAstReferencesByRootFiles,
  deleteStaleAstSymbolsByRootFiles,
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
import {
  buildDeltaPlan,
  resolveDeltaAstMode,
  type DiscoveredFileHash,
} from './deltaPlan.js';
import { createEmbeddingDispatcher } from './embeddingDispatcher.js';
import * as ingestLock from './lock.js';
import { resolveQueuedReembedExecutionPath as resolveQueuedReembedExecutionPathForPayload } from './pathMap.js';
import {
  appendIngestFailureLog,
  createLmStudioEmbeddingProvider,
  createOpenAiEmbeddingProvider,
  isOpenAiAllowlistedEmbeddingModel,
  logOpenAiContractMapping,
  mapLmStudioIngestError,
  type OpenAiClientLike,
  resolveOpenAiRestStatus,
  toNormalizedOpenAiErrorPayload,
  OpenAiEmbeddingError,
  type ResolvedEmbeddingModelSelection,
  resolveEmbeddingModelSelection,
} from './providers/index.js';
import type { ProviderEmbeddingModel } from './providers/types.js';
import {
  assertReembedRootStateAllowed,
  createInvalidReembedStateError,
  resolveRequestEmbeddingSelection,
  validateStartIngestRequestName,
  validateQueueableRepositoryRootPath,
} from './requestContracts.js';
import * as requestQueue from './requestQueue.js';
import type { IngestRunState } from './types.js';
import {
  chunkTextStream,
  discoverFiles,
  hashChunk,
  hashFile,
  resolveConfig,
} from './index.js';

export type IngestJobInput = {
  path: string;
  canonicalTargetPath?: string;
  queuedRequestPayloadPath?: string;
  queuedEmbeddingProviderRaw?: unknown;
  queuedEmbeddingModelRaw?: unknown;
  name: string;
  description?: string;
  model: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  dryRun?: boolean;
  operation?: 'start' | 'reembed';
};

export type IngestNormalizedError = {
  error: string;
  message: string;
  retryable: boolean;
  provider: 'lmstudio' | 'openai' | 'ingest';
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

export type WaitForQueueRequestTerminalStatusOptions = {
  timeoutMs: number;
};

export const QUEUE_READ_FAILED_WAIT_REASON = 'queue-read-failed';

export type WaitForQueueRequestTerminalStatusResult = {
  reason: 'terminal' | 'timeout' | typeof QUEUE_READ_FAILED_WAIT_REASON;
  requestId: string;
  runId: string | null;
  status: IngestJobStatus | null;
  lastKnown: IngestJobStatus | null;
};

export type ActiveIngestRunContext = {
  runId: string;
  state: IngestRunState;
  counts: { files: number; chunks: number; embedded: number };
  sourceId: string | null;
  rootPath: string | null;
  name: string | null;
  description: string | null;
};

type Deps = {
  lmClientFactory: (baseUrl: string) => LMStudioClient;
  baseUrl: string;
  openAiClientFactory?: (apiKey: string) => OpenAiClientLike;
  openAiRetrySleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

type QueueRuntimeRequest = {
  _id: { toString: () => string };
  canonicalTargetPath: string;
  operation: 'start' | 'reembed';
  queueState: 'waiting' | 'running' | 'cleanup-blocked';
  requestPayload: Record<string, unknown>;
  runId: string | null;
  nonReplayableAt?: Date | string | null;
  terminalPublishedAt?: Date | string | null;
};

type QueueRuntimeOps = {
  deleteQueueRequestById: (
    requestId: string,
  ) => Promise<QueueRuntimeRequest | null>;
  ensureQueueRequestRunId: (
    requestId: string,
    runId: string,
  ) => Promise<QueueRuntimeRequest | null>;
  findQueueRequestById: (
    requestId: string,
  ) => Promise<QueueRuntimeRequest | null>;
  findOldestCleanupBlockedQueueRequest: () => Promise<QueueRuntimeRequest | null>;
  findOldestRunningQueueRequest: () => Promise<QueueRuntimeRequest | null>;
  getQueueRequestId: (queueRequest: QueueRuntimeRequest) => string;
  markQueueRequestCleanupBlocked: (params: {
    requestId: string;
    runId: string | null;
  }) => Promise<QueueRuntimeRequest | null>;
  markQueueRequestNonReplayable: (params: {
    requestId: string;
    runId: string | null;
  }) => Promise<QueueRuntimeRequest | null>;
  markQueueRequestTerminalPublished: (params: {
    requestId: string;
    runId: string | null;
  }) => Promise<QueueRuntimeRequest | null>;
  promoteOldestWaitingQueueRequest: (
    runId: string,
  ) => Promise<QueueRuntimeRequest | null>;
};

type RunScheduler = (task: () => void) => void;
type FinalizeQueueRequestForRunFn = (runId: string) => Promise<boolean>;

const jobs = new Map<string, IngestJobStatus>();
let deps: Deps | null = null;
const jobInputs = new Map<string, IngestJobInput & { root?: string }>();
const queueRequestIdsByRunId = new Map<string, string>();
const cancelledRuns = new Set<string>();
const activeDispatchers = new Map<string, { cancel: () => void }>();
const finalizationBarriers = new Map<string, Promise<void>>();
const queueCleanupFinalizers = new Map<string, Promise<boolean>>();
const queueCleanupRetryTimers = new Map<
  string,
  ReturnType<typeof globalThis.setTimeout>
>();
const queueRequestTerminalStatusEvictionTimers = new Map<
  string,
  ReturnType<typeof globalThis.setTimeout>
>();
const queueRequestTerminalStatusExpiresAtMs = new Map<string, number>();
const queueCleanupRetryAttempts = new Map<string, number>();
const queueNonReplayableBarrierPersistedRuns = new Set<string>();
const blockedCleanupStatusSnapshots = new Map<string, IngestJobStatus>();
const queueRequestTerminalStatuses = new Map<
  string,
  {
    runId: string;
    status: IngestJobStatus;
  }
>();
const ingestEvents = new EventEmitter();
let beforeTerminalStatusPublishHook: ((runId: string) => Promise<void>) | null =
  null;
let runProcessor:
  | ((runId: string, input: IngestJobInput) => Promise<void>)
  | null = null;
let queueCleanupRetryDelayOverrideMs: number | null = null;
let queueRequestTerminalStatusTtlOverrideMs: number | null = null;
let queueRequestTerminalStatusNowForTestMs: number | null = null;
let finalizeQueueRequestForRunForTest: FinalizeQueueRequestForRunFn | null =
  null;
const defaultRunScheduler: RunScheduler = (task) => {
  setImmediate(task);
};
let runScheduler: RunScheduler = defaultRunScheduler;
const defaultQueueRuntimeOps: QueueRuntimeOps = {
  deleteQueueRequestById: requestQueue.deleteQueueRequestById,
  ensureQueueRequestRunId: requestQueue.ensureQueueRequestRunId,
  findQueueRequestById: requestQueue.findQueueRequestById,
  findOldestCleanupBlockedQueueRequest:
    requestQueue.findOldestCleanupBlockedQueueRequest,
  findOldestRunningQueueRequest: requestQueue.findOldestRunningQueueRequest,
  getQueueRequestId: (queueRequest) =>
    requestQueue.getQueueRequestId(queueRequest as never),
  markQueueRequestCleanupBlocked: requestQueue.markQueueRequestCleanupBlocked,
  markQueueRequestNonReplayable: requestQueue.markQueueRequestNonReplayable,
  markQueueRequestTerminalPublished:
    requestQueue.markQueueRequestTerminalPublished,
  promoteOldestWaitingQueueRequest:
    requestQueue.promoteOldestWaitingQueueRequest,
};
let queueRuntimeOps: QueueRuntimeOps = defaultQueueRuntimeOps;
const QUEUE_CLEANUP_RETRY_BASE_MS = 1_000;
const QUEUE_CLEANUP_RETRY_MAX_MS = 30_000;
const QUEUE_REQUEST_TERMINAL_STATUS_TTL_MS = 5 * 60_000;
const terminalStates = new Set<IngestRunState>([
  'completed',
  'cancelled',
  'skipped',
  'error',
  'cleanup-blocked',
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
ingestEvents.setMaxListeners(0);

type RunStatusEvent = {
  runId: string;
  requestId: string | null;
  status: IngestJobStatus;
};

function getQueueRequestTerminalStatusNowMs() {
  return queueRequestTerminalStatusNowForTestMs ?? Date.now();
}

function clearQueueRequestTerminalStatusRetention(requestId: string) {
  const handle =
    queueRequestTerminalStatusEvictionTimers.get(requestId) ?? null;
  if (handle) {
    globalThis.clearTimeout(handle);
  }
  queueRequestTerminalStatusEvictionTimers.delete(requestId);
  queueRequestTerminalStatusExpiresAtMs.delete(requestId);
}

function evictExpiredQueueRequestTerminalStatuses(
  nowMs = getQueueRequestTerminalStatusNowMs(),
) {
  for (const [
    requestId,
    expiresAtMs,
  ] of queueRequestTerminalStatusExpiresAtMs) {
    if (expiresAtMs > nowMs) {
      continue;
    }
    queueRequestTerminalStatuses.delete(requestId);
    clearQueueRequestTerminalStatusRetention(requestId);
  }
}

function setStatusAndPublish(
  runId: string,
  nextStatus: IngestJobStatus,
  options: { publishQueueTerminal?: boolean } = {},
) {
  const currentStatus = jobs.get(runId) ?? null;
  if (
    currentStatus &&
    terminalStates.has(currentStatus.state) &&
    !terminalStates.has(nextStatus.state)
  ) {
    return;
  }
  jobs.set(runId, nextStatus);
  broadcastIngestUpdate(nextStatus);
  const requestId = queueRequestIdsByRunId.get(runId) ?? null;
  const isTerminal = terminalStates.has(nextStatus.state);
  const publishQueueTerminal = options.publishQueueTerminal ?? true;
  if (requestId && isTerminal && publishQueueTerminal) {
    queueRequestTerminalStatuses.set(requestId, {
      runId,
      status: nextStatus,
    });
    clearQueueRequestTerminalStatusRetention(requestId);
    const retentionMs = Math.max(
      1,
      queueRequestTerminalStatusTtlOverrideMs ??
        QUEUE_REQUEST_TERMINAL_STATUS_TTL_MS,
    );
    queueRequestTerminalStatusExpiresAtMs.set(
      requestId,
      getQueueRequestTerminalStatusNowMs() + retentionMs,
    );
    const evictionTimer = globalThis.setTimeout(() => {
      evictExpiredQueueRequestTerminalStatuses();
    }, retentionMs);
    evictionTimer.unref?.();
    queueRequestTerminalStatusEvictionTimers.set(requestId, evictionTimer);
  }
  const eventRequestId =
    requestId && (!isTerminal || publishQueueTerminal) ? requestId : null;
  ingestEvents.emit('run-status', {
    runId,
    requestId: eventRequestId,
    status: nextStatus,
  } satisfies RunStatusEvent);
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

function getRunProcessor() {
  return runProcessor ?? processRun;
}

function normalizeDetachedTaskErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error ?? 'Unknown detached ingest task failure');
}

function buildDetachedTaskNormalizedError(
  task: string,
  message: string,
): IngestNormalizedError {
  return {
    error: 'DETACHED_INGEST_TASK_REJECTED',
    message: `${task} failed: ${message}`,
    retryable: false,
    provider: 'ingest',
  };
}

function invokeFinalizeQueueRequestForRun(runId: string) {
  return (finalizeQueueRequestForRunForTest ?? finalizeQueueRequestForRun)(
    runId,
  );
}

async function settleDetachedRunFailure(
  runId: string,
  task: string,
  error: unknown,
) {
  const errorMessage = normalizeDetachedTaskErrorMessage(error);
  const normalized = buildDetachedTaskNormalizedError(task, errorMessage);
  const requestId = queueRequestIdsByRunId.get(runId) ?? null;

  try {
    const status = jobs.get(runId);
    if (status && !terminalStates.has(status.state)) {
      setStatusAndPublish(runId, {
        ...status,
        runId,
        state: 'error',
        message: 'Failed',
        lastError: normalized.message,
        error: normalized,
        currentFile: status.currentFile,
        fileIndex: status.fileIndex,
        fileTotal: status.fileTotal,
        percent: status.percent,
        etaMs: status.etaMs,
      });
    }
  } catch (statusError) {
    logWarning('detached ingest failure status update failed', {
      runId,
      requestId,
      task,
      error: normalizeDetachedTaskErrorMessage(statusError),
    });
  }

  try {
    await persistQueueTerminalBarrier(runId);
  } catch (barrierError) {
    logWarning('detached ingest failure terminal barrier persistence failed', {
      runId,
      requestId,
      task,
      error: normalizeDetachedTaskErrorMessage(barrierError),
    });
  }

  let queueCleanupCompleted = false;
  try {
    queueCleanupCompleted =
      jobs.get(runId)?.state === 'cleanup-blocked'
        ? false
        : await invokeFinalizeQueueRequestForRun(runId);
  } catch (cleanupError) {
    logWarning('detached ingest failure queue cleanup failed', {
      runId,
      requestId,
      task,
      error: normalizeDetachedTaskErrorMessage(cleanupError),
    });
  }

  if (queueCleanupCompleted) {
    releaseRunOwnership(runId);
  }
  ingestLock.release(runId);
  if (queueCleanupCompleted) {
    scheduleQueueAdvance();
  }
}

function launchDetachedIngestTask(
  context: {
    task: string;
    runId?: string | null;
    requestId?: string | null;
  },
  task: () => Promise<unknown>,
) {
  let launched: Promise<unknown>;
  try {
    launched = task();
  } catch (error) {
    const requestId =
      context.requestId ??
      (context.runId
        ? (queueRequestIdsByRunId.get(context.runId) ?? null)
        : null);
    logWarning('detached ingest task rejected', {
      task: context.task,
      runId: context.runId ?? undefined,
      requestId: requestId ?? undefined,
      error: normalizeDetachedTaskErrorMessage(error),
    });
    if (!context.runId) {
      return;
    }
    const recovery = settleDetachedRunFailure(
      context.runId,
      context.task,
      error,
    );
    void recovery.catch((recoveryError) => {
      logWarning('detached ingest rejection recovery failed', {
        task: context.task,
        runId: context.runId ?? undefined,
        requestId: requestId ?? undefined,
        error: normalizeDetachedTaskErrorMessage(recoveryError),
      });
    });
    return;
  }
  void launched.catch((error) => {
    const requestId =
      context.requestId ??
      (context.runId
        ? (queueRequestIdsByRunId.get(context.runId) ?? null)
        : null);
    logWarning('detached ingest task rejected', {
      task: context.task,
      runId: context.runId ?? undefined,
      requestId: requestId ?? undefined,
      error: normalizeDetachedTaskErrorMessage(error),
    });
    if (!context.runId) {
      return;
    }
    const recovery = settleDetachedRunFailure(
      context.runId,
      context.task,
      error,
    );
    void recovery.catch((recoveryError) => {
      logWarning('detached ingest rejection recovery failed', {
        task: context.task,
        runId: context.runId ?? undefined,
        requestId: requestId ?? undefined,
        error: normalizeDetachedTaskErrorMessage(recoveryError),
      });
    });
  });
}

function getQueueCleanupRetryDelayMs(requestId: string) {
  if (queueCleanupRetryDelayOverrideMs !== null) {
    const attempt = (queueCleanupRetryAttempts.get(requestId) ?? 0) + 1;
    queueCleanupRetryAttempts.set(requestId, attempt);
    return queueCleanupRetryDelayOverrideMs;
  }
  const attempt = (queueCleanupRetryAttempts.get(requestId) ?? 0) + 1;
  queueCleanupRetryAttempts.set(requestId, attempt);
  return Math.min(
    QUEUE_CLEANUP_RETRY_BASE_MS * 2 ** (attempt - 1),
    QUEUE_CLEANUP_RETRY_MAX_MS,
  );
}

function clearQueueCleanupRetryState(requestId: string) {
  const handle = queueCleanupRetryTimers.get(requestId);
  if (handle) {
    globalThis.clearTimeout(handle);
    queueCleanupRetryTimers.delete(requestId);
  }
  queueCleanupRetryAttempts.delete(requestId);
}

function getPendingQueueCleanupOwner(): {
  requestId: string | null;
  runId: string;
} | null {
  const finalizerRunId = queueCleanupFinalizers.keys().next().value;
  if (typeof finalizerRunId === 'string' && finalizerRunId.length > 0) {
    return {
      requestId: queueRequestIdsByRunId.get(finalizerRunId) ?? null,
      runId: finalizerRunId,
    };
  }

  for (const [runId, requestId] of queueRequestIdsByRunId.entries()) {
    if (queueCleanupRetryTimers.has(requestId)) {
      return { requestId, runId };
    }
  }

  return null;
}

function buildCleanupBlockedStatus(params: {
  runId: string;
  previousStatus: IngestJobStatus;
  requestId: string;
  errorMessage: string;
}): IngestJobStatus {
  return {
    ...params.previousStatus,
    runId: params.runId,
    state: 'cleanup-blocked',
    message: 'Queue cleanup blocked',
    lastError: params.errorMessage,
    currentFile: params.previousStatus.currentFile,
    fileIndex: params.previousStatus.fileIndex,
    fileTotal: params.previousStatus.fileTotal,
    percent: params.previousStatus.percent,
    etaMs: params.previousStatus.etaMs,
  };
}

async function publishCleanupBlockedStatus(params: {
  runId: string;
  errorMessage: string;
}) {
  const previousStatus = jobs.get(params.runId);
  if (!previousStatus) {
    return;
  }

  const requestId = queueRequestIdsByRunId.get(params.runId) ?? params.runId;
  if (previousStatus.state !== 'cleanup-blocked') {
    blockedCleanupStatusSnapshots.set(params.runId, previousStatus);
  }

  setStatusAndPublish(
    params.runId,
    buildCleanupBlockedStatus({
      runId: params.runId,
      previousStatus,
      requestId,
      errorMessage: params.errorMessage,
    }),
  );

  const queueRequestId = queueRequestIdsByRunId.get(params.runId);
  if (queueRequestId) {
    try {
      await queueRuntimeOps.markQueueRequestCleanupBlocked({
        requestId: queueRequestId,
        runId: params.runId,
      });
    } catch (markError) {
      logWarning('queue cleanup-blocked state update failed', {
        runId: params.runId,
        requestId: queueRequestId,
        error:
          markError instanceof Error
            ? markError.message
            : String(markError ?? 'unknown'),
      });
    }
  }

  logLifecycle('error', 'ingest queue cleanup blocked', {
    runId: params.runId,
    requestId: queueRequestId ?? null,
    error: params.errorMessage,
  });
}

function toQueueManagedInput(queueRequest: {
  canonicalTargetPath: string;
  operation: 'start' | 'reembed';
  requestPayload: Record<string, unknown>;
}): IngestJobInput {
  const payload = queueRequest.requestPayload;
  const hasCanonicalEmbeddingProvider = Object.prototype.hasOwnProperty.call(
    payload,
    'embeddingProvider',
  );
  const hasCanonicalEmbeddingModel = Object.prototype.hasOwnProperty.call(
    payload,
    'embeddingModel',
  );
  const canonicalTargetPath = queueRequest.canonicalTargetPath;
  const pathValue =
    queueRequest.operation === 'reembed'
      ? typeof payload.path === 'string' && payload.path.length > 0
        ? payload.path
        : canonicalTargetPath
      : typeof payload.path === 'string' && payload.path.length > 0
        ? payload.path
        : canonicalTargetPath;
  const queuedRequestPayloadPath =
    typeof payload.path === 'string' && payload.path.length > 0
      ? payload.path
      : undefined;
  const nameValue =
    queueRequest.operation === 'start'
      ? typeof payload.name === 'string'
        ? payload.name
        : ''
      : typeof payload.name === 'string' && payload.name.length > 0
        ? payload.name
        : path.posix.basename(pathValue) || 'repo';

  return {
    canonicalTargetPath,
    path: pathValue,
    ...(queuedRequestPayloadPath ? { queuedRequestPayloadPath } : {}),
    name: nameValue,
    ...(typeof payload.description === 'string'
      ? { description: payload.description }
      : {}),
    model:
      typeof payload.model === 'string' && payload.model.length > 0
        ? payload.model
        : '',
    // Preserve raw canonical strings so shared validation can reject malformed
    // queued payloads instead of silently falling back to the legacy model.
    ...(hasCanonicalEmbeddingProvider
      ? { queuedEmbeddingProviderRaw: payload.embeddingProvider }
      : {}),
    ...(hasCanonicalEmbeddingModel
      ? { queuedEmbeddingModelRaw: payload.embeddingModel }
      : {}),
    ...(typeof payload.embeddingProvider === 'string'
      ? { embeddingProvider: payload.embeddingProvider }
      : {}),
    ...(typeof payload.embeddingModel === 'string'
      ? { embeddingModel: payload.embeddingModel }
      : {}),
    ...(typeof payload.dryRun === 'boolean' ? { dryRun: payload.dryRun } : {}),
    operation: queueRequest.operation,
  };
}

function resolveQueuedReembedExecutionPath(input: IngestJobInput): string {
  return resolveQueuedReembedExecutionPathForPayload({
    canonicalTargetPath: input.canonicalTargetPath ?? input.path,
    requestPayloadPath: input.queuedRequestPayloadPath,
  });
}

function releaseRunOwnership(runId: string) {
  queueRequestIdsByRunId.delete(runId);
  queueNonReplayableBarrierPersistedRuns.delete(runId);
  blockedCleanupStatusSnapshots.delete(runId);
}

function scheduleQueueAdvance() {
  launchDetachedIngestTask(
    {
      task: 'pumpIngestQueue',
    },
    async () => {
      await pumpIngestQueue();
    },
  );
}

async function scheduleQueueCleanupRetry(params: {
  requestId: string;
  runId: string;
}) {
  if (queueCleanupRetryTimers.has(params.requestId)) {
    return;
  }

  const delayMs = getQueueCleanupRetryDelayMs(params.requestId);
  const handle = globalThis.setTimeout(() => {
    queueCleanupRetryTimers.delete(params.requestId);
    launchDetachedIngestTask(
      {
        task: 'finalizeQueueRequestForRun.retry',
        runId: params.runId,
        requestId: params.requestId,
      },
      async () => {
        await invokeFinalizeQueueRequestForRun(params.runId);
      },
    );
  }, delayMs);
  handle.unref?.();
  queueCleanupRetryTimers.set(params.requestId, handle);
}

function publishQueueTerminalAfterCleanup(runId: string) {
  const terminalStatus =
    blockedCleanupStatusSnapshots.get(runId) ?? jobs.get(runId) ?? null;
  if (terminalStatus && terminalStates.has(terminalStatus.state)) {
    setStatusAndPublish(runId, terminalStatus);
  }
}

async function finalizeQueueRequestForRun(runId: string): Promise<boolean> {
  const existing = queueCleanupFinalizers.get(runId);
  if (existing) {
    return existing;
  }

  const finalizePromise = (async () => {
    const requestId = queueRequestIdsByRunId.get(runId);
    if (!requestId) {
      return false;
    }

    try {
      const deleted = await queueRuntimeOps.deleteQueueRequestById(requestId);
      if (!deleted) {
        publishQueueTerminalAfterCleanup(runId);
        releaseRunOwnership(runId);
        clearQueueCleanupRetryState(requestId);
        return true;
      }

      publishQueueTerminalAfterCleanup(runId);
      releaseRunOwnership(runId);
      clearQueueCleanupRetryState(requestId);
      return true;
    } catch (error) {
      await publishCleanupBlockedStatus({
        runId,
        errorMessage:
          error instanceof Error ? error.message : String(error ?? 'unknown'),
      });
      await scheduleQueueCleanupRetry({ requestId, runId });
      return false;
    }
  })();

  queueCleanupFinalizers.set(runId, finalizePromise);
  let cleanupCompleted = false;
  try {
    cleanupCompleted = await finalizePromise;
    return cleanupCompleted;
  } finally {
    queueCleanupFinalizers.delete(runId);
    if (cleanupCompleted && !ingestLock.isHeld()) {
      scheduleQueueAdvance();
    }
  }
}

async function persistQueueNonReplayableBarrier(runId: string) {
  const requestId = queueRequestIdsByRunId.get(runId);
  if (!requestId) {
    return false;
  }

  if (queueNonReplayableBarrierPersistedRuns.has(runId)) {
    return true;
  }

  await queueRuntimeOps.markQueueRequestNonReplayable({
    requestId,
    runId,
  });
  queueNonReplayableBarrierPersistedRuns.add(runId);
  return true;
}

async function persistQueueTerminalBarrier(runId: string): Promise<void> {
  const requestId = queueRequestIdsByRunId.get(runId);
  if (!requestId) {
    return;
  }

  try {
    await persistQueueNonReplayableBarrier(runId);
  } catch (error) {
    logWarning('queue replay barrier persistence failed', {
      runId,
      requestId,
      error:
        error instanceof Error ? error.message : String(error ?? 'unknown'),
    });
    return;
  }

  try {
    await queueRuntimeOps.markQueueRequestTerminalPublished({
      requestId,
      runId,
    });
  } catch (error) {
    logWarning(
      'queue terminal marker persistence failed after replay barrier',
      {
        runId,
        requestId,
        error:
          error instanceof Error ? error.message : String(error ?? 'unknown'),
      },
    );
  }
}

function parseQueueBarrierTimestamp(
  value: Date | string | null | undefined,
): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (!value) {
    return null;
  }
  return new Date(value);
}

function buildNoEligibleFilesErrorStatus(params: {
  runId: string;
  targetPath: string;
  provider: 'lmstudio' | 'openai';
  counts: { files: number; chunks: number; embedded: number };
  ast?: IngestAstCounts;
  currentFile?: string;
  fileIndex?: number;
  fileTotal?: number;
  percent?: number;
  etaMs?: number;
}): IngestJobStatus {
  const errorMsg = `No eligible files found in ${params.targetPath}`;
  return {
    runId: params.runId,
    state: 'error',
    counts: params.counts,
    ...(params.ast ? { ast: params.ast } : {}),
    message: errorMsg,
    lastError: errorMsg,
    error: {
      error: 'NO_ELIGIBLE_FILES',
      message: errorMsg,
      retryable: false,
      provider: params.provider,
    },
    currentFile: params.currentFile,
    fileIndex: params.fileIndex,
    fileTotal: params.fileTotal,
    percent: params.percent,
    etaMs: params.etaMs,
  };
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
  input: Pick<
    IngestJobInput,
    | 'model'
    | 'embeddingProvider'
    | 'embeddingModel'
    | 'queuedEmbeddingProviderRaw'
    | 'queuedEmbeddingModelRaw'
  >,
): ResolvedEmbeddingModelSelection {
  const resolved = resolveRequestEmbeddingSelection(
    toReplayRequestEmbeddingFields(input),
  );
  if (!('status' in resolved)) {
    return resolved.selection;
  }
  return resolveEmbeddingModelSelection(input.model);
}

function createModelLockedError() {
  const error = new Error('MODEL_LOCKED');
  (error as { code?: string }).code = 'MODEL_LOCKED';
  return error;
}

function createValidationError(message: string, code = 'VALIDATION') {
  const error = new Error(message);
  (error as { code?: string }).code = code;
  return error;
}

function toReplayRequestEmbeddingFields(
  input: Pick<
    IngestJobInput,
    | 'model'
    | 'embeddingProvider'
    | 'embeddingModel'
    | 'queuedEmbeddingProviderRaw'
    | 'queuedEmbeddingModelRaw'
  >,
) {
  return {
    model: input.model,
    embeddingProvider:
      input.queuedEmbeddingProviderRaw ?? input.embeddingProvider,
    embeddingModel: input.queuedEmbeddingModelRaw ?? input.embeddingModel,
  };
}

function resolveValidatedInputSelection(
  input: Pick<
    IngestJobInput,
    | 'model'
    | 'embeddingProvider'
    | 'embeddingModel'
    | 'queuedEmbeddingProviderRaw'
    | 'queuedEmbeddingModelRaw'
  >,
): ResolvedEmbeddingModelSelection {
  const resolved = resolveRequestEmbeddingSelection(
    toReplayRequestEmbeddingFields(input),
  );
  if ('status' in resolved) {
    throw createValidationError(resolved.message, resolved.code);
  }
  return resolved.selection;
}

export async function validateExecutableIngestInput(
  input: Partial<Pick<IngestJobInput, 'operation' | 'name'>> &
    Pick<
      IngestJobInput,
      | 'model'
      | 'embeddingProvider'
      | 'embeddingModel'
      | 'queuedEmbeddingProviderRaw'
      | 'queuedEmbeddingModelRaw'
    >,
  options?: {
    getLockedEmbeddingModel?: typeof getLockedEmbeddingModel;
    selection?: ResolvedEmbeddingModelSelection;
  },
) {
  if ((input.operation ?? 'start') !== 'reembed') {
    const validatedName = validateStartIngestRequestName(input.name);
    if (typeof validatedName !== 'string') {
      const error = new Error(validatedName.message);
      (error as { code?: string }).code = validatedName.code;
      throw error;
    }
  }

  const requested = options?.selection ?? resolveValidatedInputSelection(input);
  if (
    requested.providerId === 'openai' &&
    !isOpenAiAllowlistedEmbeddingModel(requested.modelKey)
  ) {
    throw new OpenAiEmbeddingError(
      'OPENAI_MODEL_UNAVAILABLE',
      'OPENAI_MODEL_UNAVAILABLE',
      false,
      404,
    );
  }

  const locked = await (
    options?.getLockedEmbeddingModel ?? getLockedEmbeddingModel
  )();
  if (
    locked &&
    (locked.embeddingProvider !== requested.providerId ||
      locked.embeddingModel !== requested.modelKey)
  ) {
    throw createModelLockedError();
  }
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
  if ((err as { code?: unknown })?.code === 'VALIDATION') {
    return {
      message: err instanceof Error ? err.message : String(err ?? 'VALIDATION'),
      normalized: {
        error: 'VALIDATION',
        message:
          err instanceof Error ? err.message : String(err ?? 'VALIDATION'),
        retryable: false,
        provider: 'ingest',
      },
    };
  }
  if ((err as { code?: unknown })?.code === 'CONFIGURATION') {
    return {
      message:
        err instanceof Error ? err.message : String(err ?? 'CONFIGURATION'),
      normalized: {
        error: 'CONFIGURATION',
        message:
          err instanceof Error ? err.message : String(err ?? 'CONFIGURATION'),
        retryable: false,
        provider: 'ingest',
      },
    };
  }
  if ((err as { code?: unknown })?.code === 'INVALID_REEMBED_STATE') {
    return {
      message:
        err instanceof Error
          ? err.message
          : String(err ?? 'INVALID_REEMBED_STATE'),
      normalized: {
        error: 'INVALID_REEMBED_STATE',
        message:
          err instanceof Error
            ? err.message
            : String(err ?? 'INVALID_REEMBED_STATE'),
        retryable: false,
        provider: 'ingest',
      },
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
      apiKey: process.env.CODEINFO_OPENAI_EMBEDDING_KEY,
      clientFactory: d.openAiClientFactory,
      retrySleep: d.openAiRetrySleep,
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
  collectionDim?: number | null;
  vectorDim?: number;
  modelKey: string;
}): Promise<number> {
  if (params.vectorDim && params.vectorDim > 1) {
    return params.vectorDim;
  }
  if (params.existingRootDim && params.existingRootDim > 0) {
    return params.existingRootDim;
  }
  if (params.collectionDim && params.collectionDim > 0) {
    return params.collectionDim;
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

async function resolveCollectionDimension(
  collection: Collection,
): Promise<number | null> {
  const hintedDimension = (collection as Collection & { dimension?: number })
    .dimension;
  if (typeof hintedDimension === 'number' && hintedDimension > 0) {
    return hintedDimension;
  }

  const rawBaseUrl =
    process.env.CODEINFO_CHROMA_URL?.trim() || 'http://localhost:8300';
  const normalizedBaseUrl = rawBaseUrl.includes('://')
    ? rawBaseUrl
    : `http://${rawBaseUrl}`;
  const endpoint = new URL(
    `/api/v2/tenants/${encodeURIComponent(collection.tenant)}/databases/${encodeURIComponent(collection.database)}/collections/${encodeURIComponent(collection.name)}`,
    normalizedBaseUrl,
  );

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { dimension?: unknown };
    return typeof body.dimension === 'number' && body.dimension > 0
      ? body.dimension
      : null;
  } catch {
    return null;
  }
}

function resolveKnownRootEmbeddingDim(params: {
  existingRootDim?: number;
  collectionDim?: number | null;
  vectorDim?: number;
  lockedDim?: number | null;
}) {
  const resolved = resolveKnownRootEmbeddingDimOrNull(params);
  return resolved ?? 1;
}

function resolveKnownRootEmbeddingDimOrNull(params: {
  existingRootDim?: number;
  collectionDim?: number | null;
  vectorDim?: number;
  lockedDim?: number | null;
}) {
  if (params.vectorDim && params.vectorDim > 1) {
    return params.vectorDim;
  }
  if (params.existingRootDim && params.existingRootDim > 0) {
    return params.existingRootDim;
  }
  if (params.collectionDim && params.collectionDim > 0) {
    return params.collectionDim;
  }
  if (params.lockedDim && params.lockedDim > 0) {
    return params.lockedDim;
  }
  return null;
}

type LatestRootSelection = {
  meta: Record<string, unknown>;
  runId: string;
  lastIngestAt: string | null;
};

async function getLatestRootSelection(
  rootPath: string,
): Promise<LatestRootSelection | null> {
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
    return null;
  }

  return matches.reduce(
    (acc, entry) => {
      const meta = (entry.meta ?? {}) as Record<string, unknown>;
      const tsRaw =
        typeof meta.lastIngestAt === 'string'
          ? Date.parse(meta.lastIngestAt)
          : NaN;
      const ts = Number.isFinite(tsRaw) ? tsRaw : 0;
      const accTsRaw = acc.lastIngestAt ? Date.parse(acc.lastIngestAt) : NaN;
      const accTs = Number.isFinite(accTsRaw) ? accTsRaw : 0;
      const entryRunId = typeof entry.id === 'string' ? entry.id : '';

      if (ts > accTs || (ts === accTs && entryRunId > acc.runId)) {
        return {
          meta,
          runId: entryRunId,
          lastIngestAt:
            typeof meta.lastIngestAt === 'string' ? meta.lastIngestAt : null,
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
              .lastIngestAt as string)
          : null,
    },
  );
}

async function processRun(runId: string, input: IngestJobInput) {
  const status = jobs.get(runId);
  if (!status) return;
  jobInputs.set(runId, input);
  try {
    const ingestedAtMs = Date.now();
    const {
      path: startPath,
      canonicalTargetPath,
      name,
      description,
      dryRun,
      operation: op,
    } = input;
    const operation = op ?? 'start';
    const isQueueManagedStart =
      operation === 'start' && queueRequestIdsByRunId.has(runId);
    const isQueueManagedReembed =
      operation === 'reembed' && queueRequestIdsByRunId.has(runId);
    const validatedReembedPath = isQueueManagedReembed
      ? resolveQueuedReembedExecutionPath(input)
      : null;
    const validatedStartPath = isQueueManagedStart
      ? validateQueueableRepositoryRootPath(startPath)
      : startPath;
    const executionRootPath = validatedReembedPath ?? validatedStartPath;
    const requestedSelection = resolveValidatedInputSelection(input);
    const embeddingProvider = requestedSelection.providerId;
    const embeddingModel = requestedSelection.modelKey;
    if (operation !== 'reembed') {
      await validateExecutableIngestInput(input, {
        selection: requestedSelection,
      });
    }
    logLifecycle('info', 'ingest start', {
      runId,
      operation,
      path: executionRootPath,
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
    const { files, root: discoveredRoot } = await discoverFiles(
      executionRootPath,
      ingestConfig,
    );
    const root = canonicalTargetPath ?? discoveredRoot;
    jobInputs.set(runId, { ...input, root });
    let latestRootSelection: LatestRootSelection | null = null;
    if (operation === 'reembed') {
      try {
        latestRootSelection = await getLatestRootSelection(root);
      } catch (error) {
        logWarning('queued reembed root-state validation degraded', {
          runId,
          root,
          reason:
            error instanceof Error
              ? error.message.slice(0, 300)
              : String(error ?? 'unknown').slice(0, 300),
        });
        throw createInvalidReembedStateError();
      }
      assertReembedRootStateAllowed(latestRootSelection?.meta.state);
    }
    if (files.length === 0 && operation !== 'reembed') {
      const errorStatus = buildNoEligibleFilesErrorStatus({
        runId,
        targetPath: startPath,
        provider: requestedSelection.providerId,
        counts: { files: 0, chunks: 0, embedded: 0 },
      });
      setStatusAndPublish(runId, errorStatus);
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
        lastError: errorStatus.lastError,
        counts: errorStatus.counts,
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
            ext: file.ext,
            size: file.size,
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
    const deltaAstMode =
      operation === 'reembed' && deltaMode === 'delta' && deltaPlan
        ? resolveDeltaAstMode({
            plan: deltaPlan,
            isAstSupported,
          })
        : null;
    const shouldSkipAstForDelta =
      deltaAstMode?.mode === 'ast_skip_non_ast_delta';
    const shouldRebuildAstForDelta = deltaAstMode?.mode === 'ast_full_rebuild';
    const shouldEarlyReturnDeltaNoOp =
      operation === 'reembed' && deltaMode === 'delta' && deltaWorkCount === 0;

    if (deltaAstMode) {
      logLifecycle('info', 'DEV-0000054:delta_ast_mode_selected', {
        runId,
        root,
        mode: deltaAstMode.mode,
        astRelevantDeltaCount: deltaAstMode.astRelevantDeltaCount,
        deltaAdded: deltaPlan?.added.length ?? 0,
        deltaChanged: deltaPlan?.changed.length ?? 0,
        deltaDeleted: deltaPlan?.deleted.length ?? 0,
      });
    }

    const workFiles: {
      absPath: string;
      relPath: string;
      fileHash?: string;
      ext?: string;
      size?: number;
    }[] =
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
    const successfulAstFiles: Array<{ relPath: string; fileHash: string }> = [];
    let astGrammarFailureLogged = false;
    const shouldRunAstIndexing = !(
      operation === 'reembed' &&
      deltaMode === 'delta' &&
      shouldSkipAstForDelta
    );
    const shouldReplaceAstByPrune =
      operation === 'start' ||
      (operation === 'reembed' &&
        (deltaMode !== 'delta' || shouldRebuildAstForDelta));
    const deltaSkipMessage = shouldEarlyReturnDeltaNoOp
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

    let vectors: Collection | null = null;
    let roots: Collection | null = null;
    let existingRootDim: number | undefined;
    let existingRootCollectionDim: number | null = null;
    let collectionsBootstrapped = false;

    const ensureCollectionsBootstrapped = async () => {
      if (collectionsBootstrapped && vectors && roots) {
        return {
          vectors,
          roots,
          existingRootDim,
          existingRootCollectionDim,
        };
      }

      const nextVectors = await getVectorsCollection();
      const nextRoots = await getRootsCollection();
      const rootDimsResult = await (
        nextRoots as unknown as {
          get: (opts: { include?: string[]; limit?: number }) => Promise<{
            embeddings?: number[][];
          }>;
        }
      ).get({ include: ['embeddings'], limit: 1 });

      vectors = nextVectors;
      roots = nextRoots;
      existingRootDim = rootDimsResult.embeddings?.[0]?.length;
      existingRootCollectionDim = await resolveCollectionDimension(nextRoots);
      collectionsBootstrapped = true;

      return {
        vectors: nextVectors,
        roots: nextRoots,
        existingRootDim,
        existingRootCollectionDim,
      };
    };

    const idsBatch: string[] = [];
    const documentsBatch: string[] = [];
    const embeddingsBatch: number[][] = [];
    const metadatasBatch: Record<string, unknown>[] = [];
    let vectorDim = 1;
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

      await vectors!.add({
        ids: [...idsBatch],
        documents: [...documentsBatch],
        embeddings: [...embeddingsBatch],
        metadatas: metadatasBatch as Metadata[],
      });

      if (shouldFencePersistence()) {
        await deleteVectors({ ids: [...idsBatch] });
        clearBatch();
        return;
      }

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
    const astWritesEnabled = !dryRun && mongoose.connection.readyState === 1;
    const pendingResults = new Map<
      number,
      {
        relPath: string;
        fileHash: string;
        chunkHash: string;
        chunkIndex: number;
        text: string;
        embedding: number[];
      }
    >();
    let nextSequence = 0;
    let nextPersistSequence = 0;
    let persistChain = Promise.resolve();
    let cancelCleanupStarted = false;

    const shouldFencePersistence = () =>
      cancelledRuns.has(runId) || cancelCleanupStarted;

    const ensureNonReplayableBarrierBeforeFinalization = async () => {
      await persistQueueNonReplayableBarrier(runId);
    };

    const clearPendingPersistenceState = () => {
      pendingResults.clear();
      clearBatch();
    };

    const persistReadyResults = async () => {
      if (shouldFencePersistence()) {
        clearPendingPersistenceState();
        return;
      }

      while (pendingResults.has(nextPersistSequence)) {
        if (shouldFencePersistence()) {
          clearPendingPersistenceState();
          return;
        }

        const result = pendingResults.get(nextPersistSequence);
        pendingResults.delete(nextPersistSequence);
        nextPersistSequence += 1;
        if (!result) continue;

        if (dryRun) {
          counts.embedded += 1;
          continue;
        }

        if (result.embedding.length > 0) {
          vectorDim = result.embedding.length;
        }

        idsBatch.push(`${runId}:${result.relPath}:${result.chunkIndex}`);
        documentsBatch.push(result.text);
        embeddingsBatch.push(result.embedding);
        const metadata: Metadata = {
          runId,
          root,
          relPath: result.relPath,
          fileHash: result.fileHash,
          chunkHash: result.chunkHash,
          embeddedAt: new Date().toISOString(),
          ingestedAtMs,
          model: embeddingModel,
          embeddingProvider,
          embeddingModel,
          embeddingDimensions: result.embedding.length,
          name,
        };
        if (description) metadata.description = description;
        metadatasBatch.push(metadata);

        if (embeddingsBatch.length >= ingestConfig.flushEvery) {
          await flushBatch();
        }
      }
    };

    const queuePersist = async () => {
      if (shouldFencePersistence()) {
        clearPendingPersistenceState();
        return;
      }
      const next = persistChain.then(() => persistReadyResults());
      persistChain = next.catch(() => undefined);
      await next;
    };

    let dispatcher: ReturnType<typeof createEmbeddingDispatcher> | null = null;

    async function completeReembedFastPathWithFence({
      counts,
      message,
      allowCollectionBootstrapFailure = false,
    }: {
      counts: { files: number; chunks: number; embedded: number };
      message: string;
      allowCollectionBootstrapFailure?: boolean;
    }) {
      let rootCollection = roots;
      let rootDim = existingRootDim;
      let rootCollectionDim = existingRootCollectionDim;
      if (!rootCollection && !allowCollectionBootstrapFailure) {
        try {
          const bootstrapped = await ensureCollectionsBootstrapped();
          rootCollection = bootstrapped.roots;
          rootDim = bootstrapped.existingRootDim;
          rootCollectionDim = bootstrapped.existingRootCollectionDim;
        } catch (error) {
          throw error;
        }
      }

      const rootEmbeddingDim = resolveKnownRootEmbeddingDimOrNull({
        existingRootDim: rootDim,
        collectionDim: rootCollectionDim,
        vectorDim,
        lockedDim: null,
      });
      if (rootCollection && rootEmbeddingDim) {
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
          state: 'completed',
          lastIngestAt: new Date().toISOString(),
          ingestedAtMs,
        };
        attachAstMetadata(rootMetadata);
        if (description) rootMetadata.description = description;

        const writeRootMetadata = async () => {
          const writeStarted = Promise.resolve().then(async () => {
            if (cancelledRuns.has(runId) || cancelCleanupStarted) {
              return false;
            }
            await ensureNonReplayableBarrierBeforeFinalization();
            await rootCollection.add({
              ids: [runId],
              embeddings: [Array(rootEmbeddingDim).fill(0)],
              metadatas: [rootMetadata],
            });
            return true;
          });
          const barrier = writeStarted.then(
            () => undefined,
            () => undefined,
          );
          finalizationBarriers.set(runId, barrier);
          try {
            return await writeStarted;
          } finally {
            if (finalizationBarriers.get(runId) === barrier) {
              finalizationBarriers.delete(runId);
            }
          }
        };

        const publishedRootMetadata = await writeRootMetadata();
        if (!publishedRootMetadata) {
          return;
        }
      } else if (!rootCollection) {
        logWarning('delta no-op fast path skipped Chroma bootstrap', {
          runId,
          root,
          operation,
          reason: allowCollectionBootstrapFailure
            ? 'collection_bootstrap_intentionally_skipped_after_zero_work_guard'
            : 'collection_bootstrap_unavailable_after_zero_work_guard',
        });
      } else {
        logWarning('ingest root metadata skipped without trusted dimension', {
          runId,
          root,
          operation,
          resultState: 'completed',
          reason: 'no_embedding_work_dimension_unresolved',
        });
      }

      const publishedTerminalStatus = await (async () => {
        const publishStarted = Promise.resolve().then(async () => {
          if (beforeTerminalStatusPublishHook) {
            await beforeTerminalStatusPublishHook(runId);
          }
          if (cancelledRuns.has(runId) || cancelCleanupStarted) {
            return false;
          }
          await ensureNonReplayableBarrierBeforeFinalization();
          setStatusAndPublish(
            runId,
            {
              runId,
              state: 'completed',
              counts,
              ast: astCounts,
              message,
              lastError: null,
              error: null,
              fileIndex: 0,
              fileTotal: 0,
              percent: 100,
              etaMs: 0,
            },
            { publishQueueTerminal: false },
          );
          logLifecycle('info', 'ingest completed', {
            runId,
            operation,
            path: startPath,
            root,
            model: embeddingModel,
            embeddingProvider,
            embeddingModel,
            name,
            description,
            state: 'completed',
            counts,
          });
          return true;
        });
        const barrier = publishStarted.then(
          () => undefined,
          () => undefined,
        );
        finalizationBarriers.set(runId, barrier);
        try {
          return await publishStarted;
        } finally {
          if (finalizationBarriers.get(runId) === barrier) {
            finalizationBarriers.delete(runId);
          }
        }
      })();

      if (!publishedTerminalStatus) {
        return;
      }
    }

    if (operation === 'reembed') {
      await validateExecutableIngestInput(input, {
        selection: requestedSelection,
      });
    }

    if (shouldEarlyReturnDeltaNoOp) {
      logLifecycle('info', '0000020 ingest delta no-op skipped', { root });
      logLifecycle(
        'info',
        `[DEV-0000038][T6] REEMBED_NO_CHANGE_EARLY_RETURN sourceId=${root} runId=${runId}`,
        { sourceId: root, runId },
      );
      if (cancelledRuns.has(runId)) {
        return;
      }

      const counts = { files: 0, chunks: 0, embedded: 0 };
      await completeReembedFastPathWithFence({
        counts,
        message: `No changes detected for ${root}`,
        allowCollectionBootstrapFailure: true,
      });
      return;
    }

    if (operation === 'reembed') {
      if (deltaMode === 'degraded_full') {
        await ensureNonReplayableBarrierBeforeFinalization();
        await deleteVectors({ where: { root } });
      } else if (deltaMode === 'legacy_upgrade') {
        await ensureNonReplayableBarrierBeforeFinalization();
        await deleteVectors({ where: { root } });
        await deleteRoots({ where: { root } });
      } else if (deltaMode === 'delta' && deltaPlan) {
        logLifecycle(
          'info',
          `[DEV-0000038][T6] REEMBED_DELTA_PATH deltaAdded=${deltaPlan.added.length} deltaModified=${deltaPlan.changed.length} deltaDeleted=${deltaPlan.deleted.length}`,
          {
            deltaAdded: deltaPlan.added.length,
            deltaModified: deltaPlan.changed.length,
            deltaDeleted: deltaPlan.deleted.length,
          },
        );
        if (
          deltaPlan.deleted.length > 0 &&
          workFiles.length === 0 &&
          !shouldRebuildAstForDelta
        ) {
          const deletedRelPaths = deltaPlan.deleted.map((file) => file.relPath);
          logLifecycle('info', '0000020 ingest delta deletions-only', {
            root,
            deleted: deltaPlan.deleted.length,
          });
          const message = `Removed vectors for ${deltaPlan.deleted.length} deleted file(s)`;
          if (cancelledRuns.has(runId)) {
            return;
          }
          await ensureNonReplayableBarrierBeforeFinalization();
          for (const file of deltaPlan.deleted) {
            await deleteVectors({
              where: { $and: [{ root }, { relPath: file.relPath }] },
            });
          }
          const persistedCleanup = await deleteIngestFilesByRelPaths({
            root,
            relPaths: deletedRelPaths,
          });
          if (!persistedCleanup) {
            await publishCleanupBlockedStatus({
              runId,
              errorMessage:
                'Persisted ingest_files cleanup was unavailable for deletions-only delta re-embed',
            });
            return;
          }
          const counts = { files: 0, chunks: 0, embedded: 0 };
          await completeReembedFastPathWithFence({
            counts,
            message,
            allowCollectionBootstrapFailure: true,
          });
          return;
        }
      }
    }

    const {
      vectors: bootstrappedVectors,
      roots: bootstrappedRoots,
      existingRootDim: bootstrappedExistingRootDim,
      existingRootCollectionDim: bootstrappedExistingRootCollectionDim,
    } = await ensureCollectionsBootstrapped();
    vectors = bootstrappedVectors;
    roots = bootstrappedRoots;
    existingRootDim = bootstrappedExistingRootDim;
    existingRootCollectionDim = bootstrappedExistingRootCollectionDim;

    const needsEmbeddingWork = workFiles.length > 0;
    let embeddingModelClient: ProviderEmbeddingModel | null = null;

    if (needsEmbeddingWork) {
      embeddingModelClient = await getEmbeddingModel(
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
      const effectiveBatchSize = Math.max(
        1,
        Math.min(
          embeddingProvider === 'openai'
            ? ingestConfig.openAiMaxBatchSize
            : ingestConfig.lmStudioMaxBatchSize,
          embeddingModelClient.effectiveBatchSize,
        ),
      );
      const effectiveMaxInFlight = Math.max(
        1,
        embeddingProvider === 'openai'
          ? ingestConfig.openAiMaxInFlight
          : ingestConfig.lmStudioMaxInFlight,
      );

      dispatcher = dryRun
        ? null
        : createEmbeddingDispatcher({
            model: embeddingModelClient,
            effectiveBatchSize,
            maxInFlight: effectiveMaxInFlight,
            maxQueueSize: ingestConfig.maxQueueSize,
            isCancelled: () => cancelledRuns.has(runId),
            onDispatch: ({
              batchSize,
              queueDepth,
              inFlight,
              effectiveBatchSize,
              effectiveMaxInFlight,
            }) => {
              logLifecycle(
                'info',
                'DEV-0000054:embedding_dispatch_slot_filled',
                {
                  runId,
                  provider: embeddingProvider,
                  batchSize,
                  queueDepth,
                  inFlight,
                  effectiveBatchSize,
                  effectiveMaxInFlight,
                },
              );
            },
            onCompleted: async (results) => {
              if (shouldFencePersistence()) {
                clearPendingPersistenceState();
                return;
              }
              for (const result of results) {
                pendingResults.set(result.sequence, {
                  ...(result.meta as {
                    relPath: string;
                    fileHash: string;
                    chunkHash: string;
                    chunkIndex: number;
                    text: string;
                  }),
                  embedding: result.embedding,
                });
              }
              await queuePersist();
            },
            onLateResultIgnored: ({ batchSize, queueDepth }) => {
              logLifecycle(
                'info',
                'DEV-0000054:embedding_result_ignored_after_cancel',
                {
                  runId,
                  provider: embeddingProvider,
                  batchSize,
                  queueDepth,
                },
              );
            },
          });
    }

    if (dispatcher) {
      activeDispatchers.set(runId, dispatcher);
    }

    if (shouldRunAstIndexing && !astWritesEnabled && !dryRun) {
      logWarning('AST indexing skipped; MongoDB is unavailable', {
        root,
        reason: 'mongo_disconnected',
      });
    }

    if (shouldRunAstIndexing && astCounts.skippedFileCount > 0) {
      logWarning('AST indexing skipped for unsupported language files', {
        root,
        skippedFileCount: astCounts.skippedFileCount,
        skippedExtensions: Array.from(astSkippedExtensions).sort(),
        examplePaths: astSkippedExamples,
        reason: 'unsupported_language',
      });
    }

    if (operation === 'reembed' && deltaMode === 'delta' && deltaPlan) {
      finalSkipMessage = undefined;
    }

    const handleCancellation = async (
      fileIndex: number,
      currentFile: string,
    ) => {
      if (!cancelledRuns.has(runId)) return false;
      cancelCleanupStarted = true;
      dispatcher?.cancel();
      activeDispatchers.delete(runId);
      clearPendingPersistenceState();
      await persistChain;
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
      await ensureNonReplayableBarrierBeforeFinalization();
      await deleteVectors({ where: { runId } });
      await deleteRoots({ where: { root } });
      await deleteVectorsCollectionIfEmpty();
      const currentLock = await getLockedEmbeddingModel();
      const rootEmbeddingDim = resolveKnownRootEmbeddingDim({
        existingRootDim,
        collectionDim: existingRootCollectionDim,
        vectorDim,
        lockedDim: currentLock?.embeddingDimensions ?? null,
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

      await roots!.add({
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

    const withFinalizationBarrier = async <T>(step: () => Promise<T>) => {
      await ensureNonReplayableBarrierBeforeFinalization();
      const stepPromise = step();
      const barrier = stepPromise.then(
        () => undefined,
        () => undefined,
      );
      finalizationBarriers.set(runId, barrier);
      try {
        return await stepPromise;
      } finally {
        if (finalizationBarriers.get(runId) === barrier) {
          finalizationBarriers.delete(runId);
        }
      }
    };

    const runFinalizationStep = async (step: () => Promise<unknown>) => {
      await withFinalizationBarrier(step);
      return handleCancellation(fileTotal, lastFileRelPath ?? root);
    };

    const runFinalizationStepWithResult = async <T>(step: () => Promise<T>) => {
      const result = await withFinalizationBarrier(step);
      const cancelled = await handleCancellation(
        fileTotal,
        lastFileRelPath ?? root,
      );
      return { result, cancelled };
    };

    const publishTerminalStatus = async () => {
      const published = await withFinalizationBarrier(async () => {
        if (beforeTerminalStatusPublishHook) {
          await beforeTerminalStatusPublishHook(runId);
        }
        if (cancelledRuns.has(runId) || cancelCleanupStarted) {
          return false;
        }
        setStatusAndPublish(
          runId,
          {
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
            percent: fileTotal > 0 ? 100 : 0,
            etaMs: 0,
          },
          { publishQueueTerminal: false },
        );
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
        return true;
      });
      if (!published) {
        await handleCancellation(fileTotal, lastFileRelPath ?? root);
      }
    };

    if (shouldRunAstIndexing) {
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
          successfulAstFiles.push({
            relPath: file.relPath,
            fileHash,
          });
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
    }

    if (shouldRunAstIndexing && astCounts.failedFileCount > 0) {
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
      for await (const chunk of chunkTextStream(
        text,
        embeddingModelClient!,
        ingestConfig,
        {
          logContext: {
            runId,
            relPath: file.relPath,
          },
          fileInfo: {
            relPath: file.relPath,
            ext: file.ext,
            sizeBytes: file.size ?? Buffer.byteLength(text, 'utf8'),
          },
        },
      )) {
        counts.chunks += 1;
        const chunkHash = hashChunk(file.relPath, chunk.chunkIndex, chunk.text);
        if (dryRun) {
          counts.embedded += 1;
          continue;
        }

        const accepted = await dispatcher!.enqueue({
          sequence: nextSequence++,
          text: chunk.text,
          meta: {
            relPath: file.relPath,
            fileHash,
            chunkHash,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
          },
        });
        if (!accepted || (await handleCancellation(fileIndex, file.relPath))) {
          return;
        }
      }
      progressSnapshot(fileIndex, file.relPath);
    }

    dispatcher?.completeProduction();
    if (dispatcher) {
      await dispatcher.waitForIdle();
      await persistChain;
      await persistReadyResults();
      if (await handleCancellation(fileTotal, lastFileRelPath ?? root)) {
        return;
      }
    }

    if (await runFinalizationStep(() => flushBatch())) {
      return;
    }

    if (operation === 'reembed' && deltaMode === 'delta' && deltaPlan) {
      for (const file of deltaPlan.changed) {
        if (
          await runFinalizationStep(() =>
            deleteVectors({
              where: {
                $and: [
                  { root },
                  { relPath: file.relPath },
                  { fileHash: { $ne: file.fileHash } },
                ],
              },
            }),
          )
        ) {
          return;
        }
      }

      for (const file of deltaPlan.deleted) {
        if (
          await runFinalizationStep(() =>
            deleteVectors({
              where: { $and: [{ root }, { relPath: file.relPath }] },
            }),
          )
        ) {
          return;
        }
      }
    }

    if (counts.embedded === 0) {
      if (await runFinalizationStep(() => deleteVectorsCollectionIfEmpty())) {
        return;
      }
    }

    if (operation === 'start' && counts.embedded === 0) {
      const errorStatus = buildNoEligibleFilesErrorStatus({
        runId,
        targetPath: startPath,
        provider: requestedSelection.providerId,
        counts,
        ast: astCounts,
        currentFile: lastFileRelPath,
        fileIndex: fileTotal,
        fileTotal,
        percent: fileTotal > 0 ? 100 : 0,
        etaMs: 0,
      });
      logLifecycle('error', 'DEV-0000046:T5:fresh-ingest-zero-embeddable', {
        runId,
        operation,
        path: startPath,
        root,
        model: embeddingModel,
        embeddingProvider,
        embeddingModel,
        name,
        description,
        discoveredFileCount: files.length,
        counts,
        error: errorStatus.error?.error,
      });
      setStatusAndPublish(runId, errorStatus);
      logLifecycle('error', 'ingest error', {
        runId,
        operation,
        path: startPath,
        root,
        model: embeddingModel,
        embeddingProvider,
        embeddingModel,
        name,
        description,
        state: 'error',
        lastError: errorStatus.lastError,
        counts,
        error: errorStatus.error,
      });
      return;
    }

    const resultState =
      operation === 'reembed' || dryRun || counts.embedded > 0
        ? 'completed'
        : 'skipped';
    const rootPersistenceResult = await runFinalizationStepWithResult(
      async () => {
        if (!needsEmbeddingWork) {
          const currentLock = await getLockedEmbeddingModel();
          const knownRootEmbeddingDim = resolveKnownRootEmbeddingDimOrNull({
            existingRootDim,
            collectionDim: existingRootCollectionDim,
            vectorDim,
            lockedDim: currentLock?.embeddingDimensions ?? null,
          });
          if (knownRootEmbeddingDim) {
            return {
              embeddingDim: knownRootEmbeddingDim,
              shouldWriteRoot: true,
            };
          }
          return {
            embeddingDim: null,
            shouldWriteRoot: false,
          };
        }

        return {
          embeddingDim: await resolveRootEmbeddingDim({
            existingRootDim,
            collectionDim: existingRootCollectionDim,
            vectorDim,
            modelKey: toProviderQualifiedModelId(requestedSelection),
          }),
          shouldWriteRoot: true,
        };
      },
    );
    if (rootPersistenceResult.cancelled) {
      return;
    }
    const { embeddingDim: rootEmbeddingDim, shouldWriteRoot } =
      rootPersistenceResult.result;
    if (shouldWriteRoot && rootEmbeddingDim !== null) {
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

      if (
        await runFinalizationStep(() =>
          roots!.add({
            ids: [runId],
            embeddings: [Array(rootEmbeddingDim).fill(0)],
            metadatas: [rootMetadata],
          }),
        )
      ) {
        return;
      }
    } else {
      logWarning('ingest root metadata skipped without trusted dimension', {
        runId,
        root,
        operation,
        resultState,
        reason: 'no_embedding_work_dimension_unresolved',
      });
    }

    if (!dryRun && operation === 'start') {
      if (await runFinalizationStep(() => clearIngestFilesByRoot(root))) {
        return;
      }
      if (
        await runFinalizationStep(() =>
          upsertIngestFiles({
            root,
            files: files
              .map((file) => ({
                relPath: file.relPath,
                fileHash: fileHashesByRelPath.get(file.relPath),
              }))
              .filter((row): row is { relPath: string; fileHash: string } =>
                Boolean(row.fileHash),
              ),
          }),
        )
      ) {
        return;
      }
    }

    if (!dryRun && operation === 'reembed') {
      if (deltaMode === 'legacy_upgrade') {
        if (await runFinalizationStep(() => clearIngestFilesByRoot(root))) {
          return;
        }
        if (
          await runFinalizationStep(() =>
            upsertIngestFiles({
              root,
              files:
                discoveredWithHashes?.map((file) => ({
                  relPath: file.relPath,
                  fileHash: file.fileHash,
                })) ?? [],
            }),
          )
        ) {
          return;
        }
      } else if (deltaMode === 'delta' && deltaPlan) {
        if (
          await runFinalizationStep(() =>
            upsertIngestFiles({
              root,
              files: [...deltaPlan.added, ...deltaPlan.changed].map((file) => ({
                relPath: file.relPath,
                fileHash: file.fileHash,
              })),
            }),
          )
        ) {
          return;
        }
        if (
          await runFinalizationStep(() =>
            deleteIngestFilesByRelPaths({
              root,
              relPaths: deltaPlan.deleted.map((file) => file.relPath),
            }),
          )
        ) {
          return;
        }
      }
    }

    if (astWritesEnabled && shouldRunAstIndexing) {
      const currentAstFiles = successfulAstFiles;
      if (
        await runFinalizationStep(() =>
          upsertAstSymbols({ root, symbols: astSymbols }),
        )
      ) {
        return;
      }
      if (
        await runFinalizationStep(() =>
          upsertAstEdges({ root, edges: astEdges }),
        )
      ) {
        return;
      }
      if (
        await runFinalizationStep(() =>
          upsertAstReferences({ root, references: astReferences }),
        )
      ) {
        return;
      }
      if (
        await runFinalizationStep(() =>
          upsertAstModuleImports({ root, modules: astModuleImports }),
        )
      ) {
        return;
      }
      if (
        await runFinalizationStep(() =>
          upsertAstCoverage({
            root,
            coverage: {
              root,
              ...astCounts,
              lastIndexedAt: new Date(),
            },
          }),
        )
      ) {
        return;
      }
      if (shouldReplaceAstByPrune) {
        if (
          await runFinalizationStep(() =>
            deleteStaleAstSymbolsByRootFiles({
              root,
              files: currentAstFiles,
            }),
          )
        ) {
          return;
        }
        if (
          await runFinalizationStep(() =>
            deleteStaleAstEdgesByRootFiles({
              root,
              files: currentAstFiles,
            }),
          )
        ) {
          return;
        }
        if (
          await runFinalizationStep(() =>
            deleteStaleAstReferencesByRootFiles({
              root,
              files: currentAstFiles,
            }),
          )
        ) {
          return;
        }
        if (
          await runFinalizationStep(() =>
            deleteStaleAstModuleImportsByRootFiles({
              root,
              files: currentAstFiles,
            }),
          )
        ) {
          return;
        }
      }
      logLifecycle('info', 'DEV-0000032:T5:ast-index-complete', {
        event: 'DEV-0000032:T5:ast-index-complete',
        root,
        ...astCounts,
      });
    }

    await publishTerminalStatus();
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
    activeDispatchers.delete(runId);
    await persistQueueTerminalBarrier(runId);
    const queueCleanupCompleted =
      jobs.get(runId)?.state === 'cleanup-blocked'
        ? false
        : await invokeFinalizeQueueRequestForRun(runId);
    if (queueCleanupCompleted) {
      releaseRunOwnership(runId);
    }
    ingestLock.release(runId);
    if (queueCleanupCompleted) {
      scheduleQueueAdvance();
    }
  }
}

function startManagedRun(params: {
  runId: string;
  input: IngestJobInput;
  queueRequestId?: string;
}) {
  setStatusAndPublish(params.runId, {
    runId: params.runId,
    state: 'queued',
    counts: { files: 0, chunks: 0, embedded: 0 },
    message: 'Queued',
    lastError: null,
    error: null,
  });
  jobInputs.set(params.runId, {
    ...params.input,
    root: params.input.canonicalTargetPath ?? params.input.path,
  });
  if (params.queueRequestId) {
    queueRequestIdsByRunId.set(params.runId, params.queueRequestId);
  }
  runScheduler(() => {
    launchDetachedIngestTask(
      {
        task: 'processRun',
        runId: params.runId,
        requestId: params.queueRequestId ?? null,
      },
      async () => {
        await getRunProcessor()(params.runId, {
          ...params.input,
          operation: params.input.operation ?? 'start',
        });
      },
    );
  });
}

export async function pumpIngestQueue() {
  const pendingCleanupOwner = getPendingQueueCleanupOwner();
  if (pendingCleanupOwner) {
    return {
      started: false,
      blockedByCleanup: true,
      requestId: pendingCleanupOwner.requestId,
      runId: pendingCleanupOwner.runId,
    };
  }

  if (ingestLock.isHeld()) {
    return {
      started: false,
      blockedByCleanup: false,
      requestId: null,
      runId: ingestLock.currentOwner(),
    };
  }

  const blocked = await queueRuntimeOps.findOldestCleanupBlockedQueueRequest();
  if (blocked) {
    const blockedRunId =
      typeof blocked.runId === 'string' && blocked.runId.length > 0
        ? blocked.runId
        : null;
    if (blockedRunId) {
      await finalizeQueueRequestForRun(blockedRunId);
    }
    return {
      started: false,
      blockedByCleanup: true,
      requestId: queueRuntimeOps.getQueueRequestId(blocked),
      runId: blockedRunId,
    };
  }

  if (!deps) {
    throw new Error('INGEST_DEPS_UNSET');
  }

  const runId = randomUUID();
  if (!ingestLock.acquire(runId)) {
    return {
      started: false,
      blockedByCleanup: false,
      requestId: null,
      runId: null,
    };
  }

  try {
    const queueRequest =
      await queueRuntimeOps.promoteOldestWaitingQueueRequest(runId);
    if (!queueRequest) {
      ingestLock.release(runId);
      return {
        started: false,
        blockedByCleanup: false,
        requestId: null,
        runId: null,
      };
    }

    const requestId = queueRuntimeOps.getQueueRequestId(queueRequest);
    const input = toQueueManagedInput(queueRequest);
    startManagedRun({
      runId,
      input,
      queueRequestId: requestId,
    });
    return { started: true, blockedByCleanup: false, requestId, runId };
  } catch (error) {
    ingestLock.release(runId);
    throw error;
  }
}

export async function recoverIngestQueueOnStartup() {
  if (ingestLock.isHeld()) {
    return { recovered: false, blockedByActiveLock: true };
  }

  const pendingCleanupOwner = getPendingQueueCleanupOwner();
  if (pendingCleanupOwner) {
    return {
      recovered: false,
      blockedByActiveLock: false,
      blockedByCleanup: true,
      requestId: pendingCleanupOwner.requestId,
      runId: pendingCleanupOwner.runId,
    };
  }

  const blocked = await queueRuntimeOps.findOldestCleanupBlockedQueueRequest();
  if (blocked) {
    const blockedRequestId = queueRuntimeOps.getQueueRequestId(blocked);
    const blockedRunId =
      typeof blocked.runId === 'string' && blocked.runId.length > 0
        ? blocked.runId
        : null;
    if (blockedRunId) {
      queueRequestIdsByRunId.set(blockedRunId, blockedRequestId);
      await finalizeQueueRequestForRun(blockedRunId);
      return { recovered: true, blockedByActiveLock: false };
    }

    logWarning(
      'startup recovery found cleanup-blocked queue request without runId',
      {
        requestId: blockedRequestId,
        canonicalTargetPath: blocked.canonicalTargetPath,
      },
    );
    return { recovered: false, blockedByActiveLock: false };
  }

  const running = await queueRuntimeOps.findOldestRunningQueueRequest();
  if (running && deps) {
    const runningRequestId = queueRuntimeOps.getQueueRequestId(running);
    const nonReplayableAt = parseQueueBarrierTimestamp(running.nonReplayableAt);
    const terminalPublishedAt = parseQueueBarrierTimestamp(
      running.terminalPublishedAt,
    );
    const existingRunId =
      typeof running.runId === 'string' && running.runId.length > 0
        ? running.runId
        : randomUUID();
    if (nonReplayableAt || terminalPublishedAt) {
      queueRequestIdsByRunId.set(existingRunId, runningRequestId);
      if (existingRunId !== running.runId) {
        await queueRuntimeOps.ensureQueueRequestRunId(
          runningRequestId,
          existingRunId,
        );
      }
      await finalizeQueueRequestForRun(existingRunId);
      logLifecycle('info', 'QUEUE_STARTUP_RECOVERY_SKIPPED_COMMITTED_RUN', {
        recoveryState: 'durable-replay-barrier',
        runId: existingRunId,
        requestId: runningRequestId,
        canonicalTargetPath: running.canonicalTargetPath,
        nonReplayableAt:
          nonReplayableAt?.toISOString?.() ?? nonReplayableAt ?? undefined,
        terminalPublishedAt:
          terminalPublishedAt?.toISOString?.() ??
          terminalPublishedAt ??
          undefined,
      });
      return { recovered: true, blockedByActiveLock: false };
    }
    if (!ingestLock.acquire(existingRunId)) {
      return { recovered: false, blockedByActiveLock: true };
    }

    try {
      if (existingRunId !== running.runId) {
        await queueRuntimeOps.ensureQueueRequestRunId(
          runningRequestId,
          existingRunId,
        );
      }
      startManagedRun({
        runId: existingRunId,
        input: toQueueManagedInput(running),
        queueRequestId: runningRequestId,
      });
      logLifecycle('info', 'QUEUE_STARTUP_RECOVERY_RESUMED_IN_ORDER', {
        recoveryState: 'running',
        runId: existingRunId,
        requestId: runningRequestId,
        canonicalTargetPath: running.canonicalTargetPath,
      });
      return { recovered: true, blockedByActiveLock: false };
    } catch (error) {
      ingestLock.release(existingRunId);
      throw error;
    }
  }

  const pumpResult = await pumpIngestQueue();
  if (pumpResult.started) {
    logLifecycle('info', 'QUEUE_STARTUP_RECOVERY_RESUMED_IN_ORDER', {
      recoveryState: 'waiting',
      requestId: pumpResult.requestId,
    });
  }
  return { recovered: pumpResult.started, blockedByActiveLock: false };
}

export async function startIngest(input: IngestJobInput, d: Deps) {
  deps = d;
  const operation = input.operation ?? 'start';
  const requested = resolveValidatedInputSelection(input);
  if (operation !== 'reembed') {
    await validateExecutableIngestInput(input, {
      selection: requested,
    });
  }
  const runId = randomUUID();
  if (!ingestLock.acquire(runId)) {
    const error = new Error('BUSY');
    (error as { code?: string }).code = 'BUSY';
    throw error;
  }
  startManagedRun({
    runId,
    input: { ...input, operation },
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

async function resolveQueueRequestRunState(requestId: string): Promise<{
  runId: string | null;
  status: IngestJobStatus | null;
  terminal: {
    runId: string;
    status: IngestJobStatus;
  } | null;
}> {
  const terminal = queueRequestTerminalStatuses.get(requestId) ?? null;
  if (terminal) {
    return {
      runId: terminal.runId,
      status: terminal.status,
      terminal,
    };
  }

  const queueRequest = await queueRuntimeOps.findQueueRequestById(requestId);
  const runId =
    queueRequest && typeof queueRequest.runId === 'string'
      ? queueRequest.runId
      : null;
  return {
    runId,
    status: runId ? getStatus(runId) : null,
    terminal: null,
  };
}

export async function waitForQueueRequestTerminalStatus(
  requestId: string,
  options: WaitForQueueRequestTerminalStatusOptions,
): Promise<WaitForQueueRequestTerminalStatusResult> {
  const timeoutMs = Math.max(1, options.timeoutMs);
  let lastKnown: IngestJobStatus | null = null;
  let activeRunId: string | null = null;

  return await new Promise((resolve) => {
    let settled = false;
    let settleTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const cleanup = () => {
      ingestEvents.off('run-status', onRunStatus);
      if (settleTimer) {
        globalThis.clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const settle = (result: WaitForQueueRequestTerminalStatusResult) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const onRunStatus = (event: RunStatusEvent) => {
      if (event.requestId !== requestId) {
        return;
      }
      activeRunId = event.runId;
      lastKnown = event.status;
      if (terminalStates.has(event.status.state)) {
        settle({
          reason: 'terminal',
          requestId,
          runId: event.runId,
          status: event.status,
          lastKnown: event.status,
        });
      }
    };

    const settleFromTimeout = async () => {
      try {
        const terminal = queueRequestTerminalStatuses.get(requestId);
        if (terminal) {
          settle({
            reason: 'terminal',
            requestId,
            runId: terminal.runId,
            status: terminal.status,
            lastKnown: terminal.status,
          });
          return;
        }

        const latest = await resolveQueueRequestRunState(requestId);
        const status = latest.terminal?.status ?? latest.status ?? null;
        settle({
          reason: latest.terminal ? 'terminal' : 'timeout',
          requestId,
          runId: latest.terminal?.runId ?? latest.runId,
          status: latest.terminal?.status ?? null,
          lastKnown: status ?? lastKnown,
        });
      } catch {
        settle({
          reason: QUEUE_READ_FAILED_WAIT_REASON,
          requestId,
          runId: activeRunId,
          status: null,
          lastKnown,
        });
      }
    };

    ingestEvents.on('run-status', onRunStatus);

    // Register the listener first, then wire the immediate state read before
    // starting the timeout fallback so setup-read failures keep their own
    // classified path instead of racing into a synthetic timeout result.
    void resolveQueueRequestRunState(requestId)
      .then((immediate) => {
        if (immediate.terminal) {
          settle({
            reason: 'terminal',
            requestId,
            runId: immediate.terminal.runId,
            status: immediate.terminal.status,
            lastKnown: immediate.terminal.status,
          });
          return;
        }
        if (immediate.runId) {
          activeRunId = immediate.runId;
        }
        if (immediate.status) {
          lastKnown = immediate.status;
          if (terminalStates.has(immediate.status.state) && activeRunId) {
            settle({
              reason: 'terminal',
              requestId,
              runId: activeRunId,
              status: immediate.status,
              lastKnown: immediate.status,
            });
          }
        }
      })
      .catch(() => {
        settle({
          reason: QUEUE_READ_FAILED_WAIT_REASON,
          requestId,
          runId: activeRunId,
          status: null,
          lastKnown,
        });
      });

    settleTimer = globalThis.setTimeout(() => {
      void settleFromTimeout();
    }, timeoutMs);
  });
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

export function getActiveRunContexts(): ActiveIngestRunContext[] {
  const toContext = (
    runId: string,
    status: IngestJobStatus,
  ): ActiveIngestRunContext => {
    const input = jobInputs.get(runId);
    const rootPath =
      (typeof input?.root === 'string' && input.root.length > 0
        ? input.root
        : typeof input?.path === 'string' && input.path.length > 0
          ? input.path
          : null) ?? null;
    return {
      runId: status.runId,
      state: status.state,
      counts: { ...status.counts },
      sourceId: rootPath,
      rootPath,
      name:
        typeof input?.name === 'string' && input.name.length > 0
          ? input.name
          : null,
      description:
        typeof input?.description === 'string' && input.description.length > 0
          ? input.description
          : null,
    };
  };

  const lockOwner = ingestLock.currentOwner();
  if (lockOwner) {
    const status = jobs.get(lockOwner);
    if (status && !terminalStates.has(status.state)) {
      return [toContext(lockOwner, status)];
    }
  }

  for (const [runId, status] of jobs.entries()) {
    if (!terminalStates.has(status.state)) {
      return [toContext(runId, status)];
    }
  }
  return [];
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
  options?: { publishQueueTerminal?: boolean },
) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__setStatusAndPublishForTest is only available in test mode',
    );
  }
  setStatusAndPublish(runId, status, options);
}

export function __setBeforeTerminalStatusPublishHookForTest(
  hook: ((runId: string) => Promise<void>) | null,
) {
  beforeTerminalStatusPublishHook = hook;
}

export function __setRunProcessorForTest(
  processor: ((runId: string, input: IngestJobInput) => Promise<void>) | null,
) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__setRunProcessorForTest is only available in test mode');
  }
  runProcessor = processor;
}

export async function __validateQueueReplayStartForTest(input: IngestJobInput) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__validateQueueReplayStartForTest is only available in test mode',
    );
  }
  if ((input.operation ?? 'start') !== 'reembed') {
    return;
  }

  try {
    resolveQueuedReembedExecutionPath(input);
  } catch (error) {
    if (
      (error as { code?: unknown })?.code === 'VALIDATION' &&
      error instanceof Error &&
      /canonicalTargetPath must stay within /u.test(error.message)
    ) {
      return;
    }
    throw error;
  }
  resolveValidatedInputSelection(input);

  try {
    const latestRootSelection = await getLatestRootSelection(
      input.canonicalTargetPath ?? input.path,
    );
    assertReembedRootStateAllowed(latestRootSelection?.meta.state);
  } catch (error) {
    if (
      (error as { code?: unknown })?.code === 'INVALID_REEMBED_STATE' ||
      (error as { code?: unknown })?.code === 'VALIDATION'
    ) {
      throw error;
    }
    throw createInvalidReembedStateError();
  }
}

export function __setQueueCleanupRetryDelayForTest(delayMs: number | null) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__setQueueCleanupRetryDelayForTest is only available in test mode',
    );
  }
  queueCleanupRetryDelayOverrideMs = delayMs;
}

export function __setQueueRequestTerminalStatusTtlForTest(
  ttlMs: number | null,
) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__setQueueRequestTerminalStatusTtlForTest is only available in test mode',
    );
  }
  queueRequestTerminalStatusTtlOverrideMs = ttlMs;
}

export function __setQueueRequestTerminalStatusNowForTest(
  nowMs: number | null,
) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__setQueueRequestTerminalStatusNowForTest is only available in test mode',
    );
  }
  queueRequestTerminalStatusNowForTestMs = nowMs;
  evictExpiredQueueRequestTerminalStatuses();
}

export function __setRunSchedulerForTest(scheduler: RunScheduler | null) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__setRunSchedulerForTest is only available in test mode');
  }
  runScheduler = scheduler ?? defaultRunScheduler;
}

export function __setQueueRuntimeOpsForTest(
  overrides: Partial<QueueRuntimeOps> | null,
) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__setQueueRuntimeOpsForTest is only available in test mode',
    );
  }
  queueRuntimeOps = overrides
    ? {
        ...defaultQueueRuntimeOps,
        ...overrides,
      }
    : defaultQueueRuntimeOps;
}

export function __setFinalizeQueueRequestForRunForTest(
  override: FinalizeQueueRequestForRunFn | null,
) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__setFinalizeQueueRequestForRunForTest is only available in test mode',
    );
  }
  finalizeQueueRequestForRunForTest = override;
}

export function __setQueueRequestIdForRunForTest(
  runId: string,
  requestId: string | null,
) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__setQueueRequestIdForRunForTest is only available in test mode',
    );
  }
  if (requestId) {
    queueRequestIdsByRunId.set(runId, requestId);
    return;
  }
  queueRequestIdsByRunId.delete(runId);
}

export async function __finalizeQueueRequestForRunForTest(runId: string) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__finalizeQueueRequestForRunForTest is only available in test mode',
    );
  }
  return finalizeQueueRequestForRun(runId);
}

export async function __persistQueueTerminalBarrierForTest(runId: string) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__persistQueueTerminalBarrierForTest is only available in test mode',
    );
  }
  await persistQueueTerminalBarrier(runId);
}

export function __scheduleQueueAdvanceForTest() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__scheduleQueueAdvanceForTest is only available in test mode',
    );
  }
  scheduleQueueAdvance();
}

export async function __scheduleQueueCleanupRetryForTest(params: {
  requestId: string;
  runId: string;
}) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__scheduleQueueCleanupRetryForTest is only available in test mode',
    );
  }
  await scheduleQueueCleanupRetry(params);
}

export function __resetIngestJobsForTest() {
  if (process.env.NODE_ENV !== 'test') return;
  jobs.clear();
  jobInputs.clear();
  queueRequestIdsByRunId.clear();
  cancelledRuns.clear();
  activeDispatchers.clear();
  finalizationBarriers.clear();
  queueNonReplayableBarrierPersistedRuns.clear();
  queueCleanupFinalizers.clear();
  blockedCleanupStatusSnapshots.clear();
  queueRequestTerminalStatuses.clear();
  queueRequestTerminalStatusExpiresAtMs.clear();
  for (const handle of queueRequestTerminalStatusEvictionTimers.values()) {
    globalThis.clearTimeout(handle);
  }
  queueRequestTerminalStatusEvictionTimers.clear();
  for (const handle of queueCleanupRetryTimers.values()) {
    globalThis.clearTimeout(handle);
  }
  queueCleanupRetryTimers.clear();
  queueCleanupRetryAttempts.clear();
  beforeTerminalStatusPublishHook = null;
  runProcessor = null;
  runScheduler = defaultRunScheduler;
  queueCleanupRetryDelayOverrideMs = null;
  queueRequestTerminalStatusTtlOverrideMs = null;
  queueRequestTerminalStatusNowForTestMs = null;
  queueRuntimeOps = defaultQueueRuntimeOps;
  finalizeQueueRequestForRunForTest = null;
}

export function __getIngestEventListenerCountForTest(
  eventName: 'run-status' = 'run-status',
) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__getIngestEventListenerCountForTest is only available in test mode',
    );
  }
  return ingestEvents.listenerCount(eventName);
}

export function __getQueueRequestTerminalStatusCountForTest() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__getQueueRequestTerminalStatusCountForTest is only available in test mode',
    );
  }
  return queueRequestTerminalStatuses.size;
}

export function __setJobInputForTest(
  runId: string,
  input: IngestJobInput & { root?: string },
) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__setJobInputForTest is only available in test mode');
  }
  jobInputs.set(runId, input);
}

export async function cancelRun(runId: string) {
  cancelledRuns.add(runId);
  activeDispatchers.get(runId)?.cancel();
  const finalizationBarrier = finalizationBarriers.get(runId);
  if (finalizationBarrier) {
    await finalizationBarrier;
  }
  const status = jobs.get(runId);
  const input = jobInputs.get(runId);
  const root = input?.root;
  const selected =
    input?.model && input.model.length > 0
      ? resolveInputSelection(input)
      : null;

  if (status?.state === 'cancelled') {
    return { cleanupState: 'complete', found: true } as const;
  }

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
    const existingRootCollectionDim = await resolveCollectionDimension(roots);
    const rootEmbeddingDim = resolveKnownRootEmbeddingDim({
      existingRootDim,
      collectionDim: existingRootCollectionDim,
      lockedDim: selected
        ? (await getLockedEmbeddingModel())?.embeddingDimensions
        : null,
    });
    if (rootEmbeddingDim <= 1) {
      logWarning('ingest cancel dimension fallback used without probe', {
        runId,
        root,
        fallback: 'dimension=1',
        reason: 'lookup_failed_after_cancel',
        ...(selected
          ? {
              embeddingProvider: selected.providerId,
              embeddingModel: selected.modelKey,
            }
          : {}),
      });
    }

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
  await persistQueueTerminalBarrier(runId);
  const queueCleanupCompleted = await finalizeQueueRequestForRun(runId);
  if (queueCleanupCompleted) {
    releaseRunOwnership(runId);
  }
  ingestLock.release(runId);
  if (queueCleanupCompleted) {
    scheduleQueueAdvance();
  }
  return { cleanupState: 'complete', found: !!status } as const;
}

export async function reembed(rootPath: string, d: Deps) {
  if (ingestLock.isHeld()) {
    const error = new Error('BUSY');
    (error as { code?: string }).code = 'BUSY';
    throw error;
  }
  deps = d;
  const best = await getLatestRootSelection(rootPath);
  if (!best) {
    const err = new Error('NOT_FOUND');
    (err as { code?: string }).code = 'NOT_FOUND';
    throw err;
  }

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
  assertReembedRootStateAllowed(meta.state);
  const selectedProvider = hasAnyCanonical
    ? (canonicalProvider as 'lmstudio' | 'openai')
    : 'lmstudio';
  const selectedModel = hasAnyCanonical
    ? (canonicalModel as string)
    : typeof meta.model === 'string'
      ? meta.model
      : '';
  if (!selectedModel) {
    throw createInvalidReembedStateError();
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
