import { Router } from 'express';
import { getLockedModel, getRootsCollection } from '../ingest/chromaClient.js';
import { listIngestedRepositories } from '../lmstudio/toolService.js';
import { baseLogger } from '../logger.js';

type Deps = {
  getRootsCollection: typeof getRootsCollection;
  getLockedModel: typeof getLockedModel;
};

export function createToolsIngestedReposRouter(
  deps: Deps = {
    getRootsCollection,
    getLockedModel,
  },
) {
  const router = Router();

  router.get('/tools/ingested-repos', async (_req, res) => {
    try {
      const { repos, lockedModelId } = await listIngestedRepositories({
        getRootsCollection: deps.getRootsCollection,
        getLockedModel: deps.getLockedModel,
      });
      const requestId =
        (res.locals?.requestId as string | undefined) ?? undefined;
      baseLogger.info(
        { requestId, repos: repos.length, lockedModelId },
        'tools ingested repos',
      );

      res.json({ repos, lockedModelId });
    } catch (err) {
      res.status(502).json({ error: 'CHROMA_UNAVAILABLE', message: `${err}` });
    }
  });

  return router;
}
