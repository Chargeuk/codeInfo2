import { Router } from 'express';
import { isBusy, removeRoot } from '../ingest/ingestJob.js';
import { baseLogger } from '../logger.js';

export function createIngestRemoveRouter() {
  const router = Router();

  router.post('/ingest/remove/:root', async (req, res) => {
    if (isBusy()) {
      return res.status(429).json({ status: 'error', code: 'BUSY' });
    }
    const { root } = req.params;
    try {
      baseLogger.info({ root }, 'ingest remove start');
      const result = await removeRoot(root);
      baseLogger.info({ root, unlocked: result.unlocked }, 'ingest remove ok');
      return res.json({ status: 'ok', unlocked: result.unlocked });
    } catch (err) {
      baseLogger.error({ root, err }, 'ingest remove failed');
      return res
        .status(500)
        .json({ status: 'error', message: (err as Error).message });
    }
  });

  return router;
}
