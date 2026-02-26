import { Router } from 'express';
import { cancelRun, getStatus, isBusy } from '../ingest/ingestJob.js';
import {
  appendIngestFailureLog,
  classifyIngestFailure,
} from '../ingest/providers/index.js';
import { baseLogger } from '../logger.js';

type Deps = {
  cancelRun?: typeof cancelRun;
  getStatus?: typeof getStatus;
  isBusy?: typeof isBusy;
};

export function createIngestCancelRouter(deps: Deps = {}) {
  const router = Router();
  const cancelRunOverride = deps.cancelRun ?? cancelRun;
  const getStatusOverride = deps.getStatus ?? getStatus;
  const isBusyOverride = deps.isBusy ?? isBusy;

  router.post('/ingest/cancel/:runId', async (req, res) => {
    try {
      if (isBusyOverride()) {
        // allow cancel even if busy; lock is released in cancelRun
      }
      const { runId } = req.params;
      const existing = getStatusOverride(runId);
      if (!existing) {
        return res.status(404).json({ status: 'error', code: 'NOT_FOUND' });
      }
      const result = await cancelRunOverride(runId);
      return res.json({ status: 'ok', cleanup: result.cleanupState });
    } catch (error) {
      const runId = req.params.runId;
      const classified = classifyIngestFailure(error, {
        surface: 'ingest/cancel',
        defaultCode: 'INGEST_CANCEL_FAILED',
      });
      appendIngestFailureLog(classified.severity, {
        runId,
        provider: classified.provider,
        code: classified.code,
        retryable: classified.retryable,
        message: classified.message,
        stage: 'terminal',
        surface: classified.surface,
        operation: 'cancel',
        ...(typeof classified.upstreamStatus === 'number'
          ? { upstreamStatus: classified.upstreamStatus }
          : {}),
        ...(typeof classified.retryAfterMs === 'number'
          ? { retryAfterMs: classified.retryAfterMs }
          : {}),
      });
      baseLogger.error({ runId, err: error }, 'ingest cancel failed');

      if (classified.code === 'NOT_FOUND') {
        return res.status(404).json({ status: 'error', code: classified.code });
      }
      if (classified.code === 'BUSY') {
        return res.status(429).json({ status: 'error', code: classified.code });
      }
      return res.status(500).json({
        status: 'error',
        code: classified.code,
        message: classified.message,
      });
    }
  });

  return router;
}
