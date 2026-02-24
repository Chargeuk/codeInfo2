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
      baseLogger.info(
        {
          surface: 'tools/ingested-repos',
          source: 'canonical',
          lockedModelId,
          count: repos.length,
          requestId: res.locals?.requestId as string | undefined,
        },
        'DEV-0000036:T2:lock_resolver_source_selected',
      );
      baseLogger.info(
        {
          surface: 'tools/ingested-repos',
          embeddingProvider: 'lmstudio',
          embeddingModel: lockedModelId,
          requestId: res.locals?.requestId as string | undefined,
        },
        'DEV-0000036:T2:lock_resolver_surface_parity',
      );
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
