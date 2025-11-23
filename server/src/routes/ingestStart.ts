import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import { collectionIsEmpty, getLockedModel } from '../ingest/chromaClient.js';
import { getStatus, isBusy, startIngest } from '../ingest/ingestJob.js';
import { toWebSocketUrl } from './lmstudioUrl.js';

export function createIngestStartRouter({
  clientFactory,
}: {
  clientFactory: (baseUrl: string) => LMStudioClient;
}) {
  const router = Router();

  router.post('/ingest/start', async (req, res) => {
    const { path, name, description, model, dryRun = false } = req.body ?? {};
    if (!path || !name || !model) {
      return res.status(400).json({ status: 'error', code: 'VALIDATION' });
    }

    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? '';
    const wsBaseUrl = toWebSocketUrl(baseUrl);

    try {
      const locked = await getLockedModel();
      const empty = await collectionIsEmpty();
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
    const status = getStatus(req.params.runId);
    if (!status)
      return res.status(404).json({ status: 'error', code: 'NOT_FOUND' });
    return res.json(status);
  });

  return router;
}
