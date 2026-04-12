import { Router } from 'express';
import { isBusy, removeRoot } from '../ingest/ingestJob.js';
import { normalizeCanonicalQueueTargetPath } from '../ingest/requestContracts.js';
import { deleteWaitingQueueRequestsByTargetPath } from '../ingest/requestQueue.js';
import { baseLogger } from '../logger.js';

const APPROVED_E2E_FIXTURE_ROOT = '/fixtures/repo';

function resolveApprovedCleanupRoot(rawRoot: string) {
  const canonicalRoot = normalizeCanonicalQueueTargetPath(rawRoot);
  const allowed =
    canonicalRoot === APPROVED_E2E_FIXTURE_ROOT ||
    canonicalRoot.startsWith(`${APPROVED_E2E_FIXTURE_ROOT}/`);
  if (allowed) {
    return { ok: true as const, canonicalRoot };
  }
  return {
    ok: false as const,
    canonicalRoot,
    status: 'error' as const,
    code: 'ROOT_NOT_ALLOWED' as const,
    message:
      'The e2e cleanup route only accepts /fixtures/repo and its descendants',
    approvedRoot: APPROVED_E2E_FIXTURE_ROOT,
  };
}

export function createIngestE2eCleanupRouter({
  enabled = process.env.CODEINFO_E2E_CLEANUP_ROUTE === 'true',
  isBusy: isBusyOverride = isBusy,
  removeRoot: removeRootOverride = removeRoot,
  deleteWaitingQueueRequestsByTargetPath:
    deleteWaitingQueueRequestsByTargetPathOverride = deleteWaitingQueueRequestsByTargetPath,
}: {
  enabled?: boolean;
  isBusy?: typeof isBusy;
  removeRoot?: typeof removeRoot;
  deleteWaitingQueueRequestsByTargetPath?: typeof deleteWaitingQueueRequestsByTargetPath;
} = {}) {
  const router = Router();
  if (!enabled) {
    return router;
  }

  router.post('/ingest/e2e/cleanup/:root', async (req, res) => {
    const rootCheck = resolveApprovedCleanupRoot(req.params.root);
    const canonicalRoot = rootCheck.canonicalRoot;
    if (!rootCheck.ok) {
      baseLogger.warn(
        { requestedRoot: req.params.root, canonicalRoot },
        'ingest e2e cleanup rejected unknown root',
      );
      return res.status(403).json({
        status: rootCheck.status,
        code: rootCheck.code,
        message: rootCheck.message,
        requestedRoot: canonicalRoot,
        approvedRoot: rootCheck.approvedRoot,
      });
    }
    try {
      const waitingRemoved =
        await deleteWaitingQueueRequestsByTargetPathOverride(canonicalRoot);
      const busy = isBusyOverride();
      if (busy && waitingRemoved === 0) {
        return res.status(429).json({ status: 'error', code: 'BUSY' });
      }

      if (busy) {
        baseLogger.info(
          { root: canonicalRoot, waitingRemoved },
          'ingest e2e cleanup removed waiting queue items while active work was still draining',
        );
        return res.json({
          status: 'ok',
          waitingRemoved,
          rootRemoved: false,
          unlocked: false,
        });
      }

      const removeResult = await removeRootOverride(canonicalRoot);
      baseLogger.info(
        {
          root: canonicalRoot,
          waitingRemoved,
          unlocked: removeResult.unlocked,
        },
        'ingest e2e cleanup completed',
      );
      return res.json({
        status: 'ok',
        waitingRemoved,
        rootRemoved: true,
        unlocked: removeResult.unlocked,
      });
    } catch (err) {
      baseLogger.error(
        { root: canonicalRoot, err },
        'ingest e2e cleanup failed',
      );
      return res.status(500).json({
        status: 'error',
        message: (err as Error).message,
      });
    }
  });

  return router;
}
