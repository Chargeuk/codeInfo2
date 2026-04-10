import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import {
  getLockedEmbeddingModel,
  InvalidLockMetadataError,
} from '../ingest/chromaClient.js';
import {
  getStatus,
  type IngestJobStatus,
  pumpIngestQueue,
  validateExecutableIngestInput,
} from '../ingest/ingestJob.js';
import {
  appendIngestFailureLog,
  classifyIngestFailure,
} from '../ingest/providers/index.js';
import {
  normalizeCanonicalQueueTargetPath,
  resolveRequestEmbeddingSelection,
} from '../ingest/requestContracts.js';
import {
  enqueueOrReuseIngestRequest,
  QUEUE_REQUEST_UPDATED_IN_PLACE_LOG_MESSAGE,
} from '../ingest/requestQueue.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';

type Deps = {
  clientFactory: (baseUrl: string) => LMStudioClient;
  getLockedEmbeddingModel?: typeof getLockedEmbeddingModel;
  enqueueOrReuseIngestRequest?: typeof enqueueOrReuseIngestRequest;
  pumpIngestQueue?: typeof pumpIngestQueue;
};

function sanitizeErrorMessage(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-***')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'bearer ***')
    .replace(/authorization\s*:\s*[^\s]+/gi, 'authorization:***')
    .slice(0, 300);
}

function logLockResolverState(
  requestId: string | undefined,
  surface: string,
  lock: {
    embeddingProvider: 'lmstudio' | 'openai';
    embeddingModel: string;
    embeddingDimensions: number;
  } | null,
) {
  const lockedModelId = lock?.embeddingModel ?? null;
  append({
    level: 'info',
    message: 'DEV-0000036:T2:lock_resolver_source_selected',
    timestamp: new Date().toISOString(),
    source: 'server',
    requestId,
    context: {
      surface,
      source: 'canonical',
      lockedModelId,
    },
  });
  append({
    level: 'info',
    message: 'DEV-0000036:T2:lock_resolver_surface_parity',
    timestamp: new Date().toISOString(),
    source: 'server',
    requestId,
    context: {
      surface,
      embeddingProvider: lock?.embeddingProvider ?? null,
      embeddingModel: lock?.embeddingModel ?? null,
      embeddingDimensions: lock?.embeddingDimensions ?? null,
    },
  });
}

export function createIngestStartRouter({
  getLockedEmbeddingModel:
    getLockedEmbeddingModelOverride = getLockedEmbeddingModel,
  enqueueOrReuseIngestRequest:
    enqueueOrReuseIngestRequestOverride = enqueueOrReuseIngestRequest,
  pumpIngestQueue: pumpIngestQueueOverride = pumpIngestQueue,
}: Deps) {
  const router = Router();

  router.post('/ingest/start', async (req, res) => {
    const { path, name, description, dryRun = false } = req.body ?? {};
    if (!path || !name) {
      return res.status(400).json({
        status: 'error',
        code: 'VALIDATION',
        message: 'path and name are required',
      });
    }
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;
    const resolvedSelection = resolveRequestEmbeddingSelection(req.body ?? {});
    if ('status' in resolvedSelection) {
      append({
        level: 'info',
        message: 'DEV-0000036:T9:ingest_request_contract_validated',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          endpoint: '/ingest/start',
          validation: 'failed',
          code: resolvedSelection.code,
          canonicalProvided:
            (req.body?.embeddingProvider !== undefined ||
              req.body?.embeddingModel !== undefined) ??
            false,
        },
      });
      return res.status(resolvedSelection.status).json({
        status: 'error',
        code: resolvedSelection.code,
        message: resolvedSelection.message,
      });
    }
    append({
      level: 'info',
      message: 'DEV-0000036:T9:ingest_request_contract_validated',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: {
        endpoint: '/ingest/start',
        validation: 'ok',
        embeddingProvider: resolvedSelection.selection.providerId,
        embeddingModel: resolvedSelection.selection.modelKey,
        canonicalProvided: resolvedSelection.canonicalProvided,
      },
    });

    try {
      const locked = await getLockedEmbeddingModelOverride();
      logLockResolverState(requestId, 'ingest/start', locked);
      const requested = resolvedSelection.selection;
      try {
        await validateExecutableIngestInput(req.body ?? {}, {
          selection: requested,
          getLockedEmbeddingModel: async () => locked,
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'MODEL_LOCKED' && locked) {
          return res.status(409).json({
            status: 'error',
            code: 'MODEL_LOCKED',
            lock: {
              embeddingProvider: locked.embeddingProvider,
              embeddingModel: locked.embeddingModel,
              embeddingDimensions: locked.embeddingDimensions,
            },
            lockedModelId: locked.embeddingModel,
          });
        }
        throw err;
      }
      const queueResult = await enqueueOrReuseIngestRequestOverride({
        canonicalTargetPath: normalizeCanonicalQueueTargetPath(path),
        operation: 'start',
        sourceSurface: 'rest:ingest/start',
        requestPayload: {
          path,
          name,
          description,
          model: resolvedSelection.requestedModelId,
          embeddingProvider: requested.providerId,
          embeddingModel: requested.modelKey,
          dryRun,
        },
      });
      const pumpResult = await pumpIngestQueueOverride();
      const runId =
        queueResult.runId ??
        (pumpResult.requestId === queueResult.requestId
          ? (pumpResult.runId ?? null)
          : null);
      if (queueResult.updatedExisting) {
        append({
          level: 'info',
          message: QUEUE_REQUEST_UPDATED_IN_PLACE_LOG_MESSAGE,
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId,
          context: {
            endpoint: '/ingest/start',
            queueRequestId: queueResult.requestId,
            canonicalTargetPath: queueResult.canonicalTargetPath,
            runId,
            queued: !runId,
            queuePosition: runId ? undefined : queueResult.queuePosition,
            reusedExisting: queueResult.reusedExisting,
            updatedExisting: queueResult.updatedExisting,
          },
        });
      }
      append({
        level: 'info',
        message: 'QUEUE_REQUEST_ACCEPTED_WITH_REQUEST_ID',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: {
          endpoint: '/ingest/start',
          queueRequestId: queueResult.requestId,
          runId,
          queued: !runId,
          queuePosition: runId ? undefined : queueResult.queuePosition,
        },
      });
      return res.status(202).json(
        runId
          ? {
              queued: false,
              requestId: queueResult.requestId,
              runId,
            }
          : {
              queued: true,
              requestId: queueResult.requestId,
              queuePosition: queueResult.queuePosition,
            },
      );
    } catch (err) {
      const classified = classifyIngestFailure(err, {
        surface: 'ingest/start',
        defaultCode: 'INGEST_START_FAILED',
      });
      appendIngestFailureLog(classified.severity, {
        provider: classified.provider,
        code: classified.code,
        retryable: classified.retryable,
        model: resolvedSelection.selection.modelKey,
        path,
        message: classified.message,
        stage: 'terminal',
        surface: classified.surface,
        operation: 'start',
        ...(typeof classified.upstreamStatus === 'number'
          ? { upstreamStatus: classified.upstreamStatus }
          : {}),
        ...(typeof classified.retryAfterMs === 'number'
          ? { retryAfterMs: classified.retryAfterMs }
          : {}),
      });
      baseLogger.error(
        { path, model: resolvedSelection.selection.modelKey, err },
        'ingest start failed',
      );
      if (err instanceof InvalidLockMetadataError) {
        return res.status(409).json({ status: 'error', code: err.code });
      }
      const code = (err as { code?: string }).code;
      if (code === 'MODEL_LOCKED') {
        return res.status(409).json({ status: 'error', code });
      }
      if (code === 'OPENAI_MODEL_UNAVAILABLE') {
        return res.status(409).json({ status: 'error', code });
      }
      if (code === 'QUEUE_UNAVAILABLE') {
        if (typeof classified.retryAfterMs === 'number') {
          res.setHeader(
            'Retry-After',
            String(Math.max(1, Math.ceil(classified.retryAfterMs / 1000))),
          );
        }
        return res.status(503).json({
          status: 'error',
          code: 'QUEUE_UNAVAILABLE',
          retryable: true,
          message: classified.message,
        });
      }
      return res.status(500).json({
        status: 'error',
        code: classified.code,
        message: sanitizeErrorMessage(
          (err as Error).message ?? 'Unknown error',
        ),
      });
    }
  });

  router.get('/ingest/status/:runId', (req, res) => {
    const status: IngestJobStatus | null = getStatus(req.params.runId);
    if (!status)
      return res.status(404).json({ status: 'error', code: 'NOT_FOUND' });
    return res.json(status);
  });

  return router;
}
