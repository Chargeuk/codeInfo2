import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import { collectionIsEmpty, getLockedModel } from '../ingest/chromaClient.js';
import {
  getStatus,
  isBusy,
  startIngest,
  type IngestJobStatus,
} from '../ingest/ingestJob.js';
import { toWebSocketUrl } from './lmstudioUrl.js';
import { append } from '../logStore.js';

type Deps = {
  clientFactory: (baseUrl: string) => LMStudioClient;
  collectionIsEmpty?: typeof collectionIsEmpty;
  getLockedModel?: typeof getLockedModel;
};

function logLockResolverState(
  requestId: string | undefined,
  surface: string,
  lockedModelId: string | null,
) {
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
      embeddingProvider: 'lmstudio',
      embeddingModel: lockedModelId,
    },
  });
}

export function createIngestStartRouter({
  clientFactory,
  collectionIsEmpty: collectionIsEmptyOverride = collectionIsEmpty,
  getLockedModel: getLockedModelResolver = getLockedModel,
}: Deps) {
  const router = Router();

  router.post('/ingest/start', async (req, res) => {
    const { path, name, description, model, dryRun = false } = req.body ?? {};
    if (!path || !name || !model) {
      return res.status(400).json({ status: 'error', code: 'VALIDATION' });
    }

    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? '';
    const wsBaseUrl = toWebSocketUrl(baseUrl);

    try {
      const requestId =
        (res.locals?.requestId as string | undefined) ?? undefined;
      const locked = await getLockedModelResolver();
      const empty = await collectionIsEmptyOverride();
      logLockResolverState(requestId, 'ingest/start', locked);
      if (!empty && locked && locked !== model) {
        return res.status(409).json({
          status: 'error',
          code: 'MODEL_LOCKED',
          lockedModelId: locked,
        });
      }
      if (isBusy()) {
        return res.status(429).json({ status: 'error', code: 'BUSY' });
      }
      const runId = await startIngest(
        { path, name, description, model, dryRun },
        { lmClientFactory: clientFactory, baseUrl: wsBaseUrl },
      );
      return res.status(202).json({ runId });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'MODEL_LOCKED') {
        return res.status(409).json({ status: 'error', code });
      }
      if (code === 'BUSY') {
        return res.status(429).json({ status: 'error', code });
      }
      return res
        .status(500)
        .json({ status: 'error', message: (err as Error).message });
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
