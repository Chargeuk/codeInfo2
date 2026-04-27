import { Router } from 'express';
import {
  getActiveRunContexts,
  isBusy,
  removeRoot,
} from '../ingest/ingestJob.js';
import { validateExactDestructiveRootPath } from '../ingest/requestContracts.js';
import { findLiveQueueRequestForTarget } from '../ingest/requestQueue.js';
import { listIngestedRepositories } from '../lmstudio/toolService.js';
import { baseLogger } from '../logger.js';

export function createIngestRemoveRouter({
  getActiveRunContexts: getActiveRunContextsOverride = getActiveRunContexts,
  isBusy: isBusyOverride = isBusy,
  removeRoot: removeRootOverride = removeRoot,
  findLiveQueueRequestForTarget:
    findLiveQueueRequestForTargetOverride = findLiveQueueRequestForTarget,
  listIngestedRepositories:
    listIngestedRepositoriesOverride = listIngestedRepositories,
}: {
  getActiveRunContexts?: typeof getActiveRunContexts;
  isBusy?: typeof isBusy;
  removeRoot?: typeof removeRoot;
  findLiveQueueRequestForTarget?: typeof findLiveQueueRequestForTarget;
  listIngestedRepositories?: typeof listIngestedRepositories;
} = {}) {
  const router = Router();

  router.post('/ingest/remove/:root', async (req, res) => {
    let root: string;
    try {
      try {
        root = validateExactDestructiveRootPath(req.params.root);
      } catch {
        return res.status(404).json({ status: 'error', code: 'NOT_FOUND' });
      }

      const repos = await listIngestedRepositoriesOverride();
      const targetRepo = repos.repos.find((repo) => repo.containerPath === root);
      if (!targetRepo) {
        return res.status(404).json({ status: 'error', code: 'NOT_FOUND' });
      }

      const activeRun = getActiveRunContextsOverride().find(
        (context) =>
          context.rootPath === targetRepo.containerPath ||
          context.sourceId === targetRepo.containerPath,
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

      const liveQueueRequest = await findLiveQueueRequestForTargetOverride(
        targetRepo.containerPath,
      );
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

      if (isBusyOverride()) {
        return res.status(429).json({ status: 'error', code: 'BUSY' });
      }

      baseLogger.info({ root }, 'ingest remove start');
      const result = await removeRootOverride(targetRepo.containerPath);
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
