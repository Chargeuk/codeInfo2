import { Router } from 'express';
import {
  getActiveRunContexts,
  isBusy,
  removeRoot,
} from '../ingest/ingestJob.js';
import { normalizeCanonicalQueueTargetPath } from '../ingest/requestContracts.js';
import { findLiveQueueRequestForTarget } from '../ingest/requestQueue.js';
import { baseLogger } from '../logger.js';

export function createIngestRemoveRouter() {
  const router = Router();

  router.post('/ingest/remove/:root', async (req, res) => {
    const root = normalizeCanonicalQueueTargetPath(req.params.root);
    try {
      const liveQueueRequest = await findLiveQueueRequestForTarget(root);
      if (liveQueueRequest) {
        return res.status(409).json({
          status: 'error',
          code: 'QUEUE_STATE_BLOCKED',
          message:
            'Root removal is blocked while the ingest queue owns this target',
          queueState: liveQueueRequest.queueState,
          runId: liveQueueRequest.runId ?? null,
        });
      }

      const activeRun = getActiveRunContexts().find(
        (context) => context.rootPath === root || context.sourceId === root,
      );
      if (activeRun) {
        return res.status(409).json({
          status: 'error',
          code: 'QUEUE_STATE_BLOCKED',
          message:
            'Root removal is blocked while an active ingest run owns this target',
          queueState: 'running',
          runId: activeRun.runId,
        });
      }

      if (isBusy()) {
        return res.status(429).json({ status: 'error', code: 'BUSY' });
      }

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
