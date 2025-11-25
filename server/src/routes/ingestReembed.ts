import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import { isBusy, reembed } from '../ingest/ingestJob.js';
import { toWebSocketUrl } from './lmstudioUrl.js';

export function createIngestReembedRouter({
  clientFactory,
}: {
  clientFactory: (baseUrl: string) => LMStudioClient;
}) {
  const router = Router();

  router.post('/ingest/reembed/:root', async (req, res) => {
    if (isBusy()) {
      return res.status(429).json({ status: 'error', code: 'BUSY' });
    }
    const { root } = req.params;
    const baseUrl = toWebSocketUrl(process.env.LMSTUDIO_BASE_URL ?? '');
    try {
      const runId = await reembed(root, {
        lmClientFactory: clientFactory,
        baseUrl,
      });
      return res.status(202).json({ runId });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'BUSY')
        return res.status(429).json({ status: 'error', code });
      if (code === 'NOT_FOUND')
        return res.status(404).json({ status: 'error', code });
      return res
        .status(500)
        .json({ status: 'error', message: (err as Error).message });
    }
  });

  return router;
}
