import { Router } from 'express';
import { isBusy, removeRoot } from '../ingest/ingestJob.js';

export function createIngestRemoveRouter() {
  const router = Router();

  router.post('/ingest/remove/:root', async (req, res) => {
    if (isBusy()) {
      return res.status(429).json({ status: 'error', code: 'BUSY' });
    }
    const { root } = req.params;
    try {
      const result = await removeRoot(root);
      return res.json({ status: 'ok', unlocked: result.unlocked });
    } catch (err) {
      return res
        .status(500)
        .json({ status: 'error', message: (err as Error).message });
    }
  });

  return router;
}
