import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import {
  collectionIsEmpty,
  getLockedEmbeddingModel,
  InvalidLockMetadataError,
} from '../ingest/chromaClient.js';
import {
  getStatus,
  isBusy,
  startIngest,
  type IngestJobStatus,
} from '../ingest/ingestJob.js';
import {
  appendIngestFailureLog,
  classifyIngestFailure,
} from '../ingest/providers/index.js';
import { resolveRequestEmbeddingSelection } from '../ingest/requestContracts.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { toWebSocketUrl } from './lmstudioUrl.js';

type Deps = {
  clientFactory: (baseUrl: string) => LMStudioClient;
  collectionIsEmpty?: typeof collectionIsEmpty;
  getLockedEmbeddingModel?: typeof getLockedEmbeddingModel;
  startIngest?: typeof startIngest;
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
  clientFactory,
  collectionIsEmpty: collectionIsEmptyOverride = collectionIsEmpty,
  getLockedEmbeddingModel:
    getLockedEmbeddingModelOverride = getLockedEmbeddingModel,
  startIngest: startIngestOverride = startIngest,
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

    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? '';
    const wsBaseUrl = toWebSocketUrl(baseUrl);

    try {
      const locked = await getLockedEmbeddingModelOverride();
      const empty = await collectionIsEmptyOverride();
      logLockResolverState(requestId, 'ingest/start', locked);
      const requested = resolvedSelection.selection;
      if (
        !empty &&
        locked &&
        (locked.embeddingProvider !== requested.providerId ||
          locked.embeddingModel !== requested.modelKey)
      ) {
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
      if (isBusy()) {
        return res.status(429).json({ status: 'error', code: 'BUSY' });
      }
      const runId = await startIngestOverride(
        {
          path,
          name,
          description,
          model: resolvedSelection.requestedModelId,
          embeddingProvider: requested.providerId,
          embeddingModel: requested.modelKey,
          dryRun,
        },
        { lmClientFactory: clientFactory, baseUrl: wsBaseUrl },
      );
      return res.status(202).json({ runId });
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
      if (code === 'BUSY') {
        return res.status(429).json({ status: 'error', code });
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
