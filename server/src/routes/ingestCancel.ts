import { Router } from 'express';
import { cancelRun, getStatus, isBusy } from '../ingest/ingestJob.js';

export function createIngestCancelRouter() {
  const router = Router();

  router.post('/ingest/cancel/:runId', async (req, res) => {
    if (isBusy()) {
      // allow cancel even if busy; lock is released in cancelRun
    }
    const { runId } = req.params;
    const existing = getStatus(runId);
    if (!existing) {
      return res.status(404).json({ status: 'error', code: 'NOT_FOUND' });
    }
    const result = await cancelRun(runId);
    return res.json({ status: 'ok', cleanup: result.cleanupState });
  });

  return router;
}
