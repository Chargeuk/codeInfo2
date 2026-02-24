import { Router } from 'express';
import {
  getLockedEmbeddingModel,
  getLockedModel,
  getRootsCollection,
} from '../ingest/chromaClient.js';
import {
  INGEST_REPO_SCHEMA_VERSION,
  listIngestedRepositories,
} from '../lmstudio/toolService.js';
import { baseLogger } from '../logger.js';

type Deps = {
  getRootsCollection: typeof getRootsCollection;
  getLockedModel: typeof getLockedModel;
  getLockedEmbeddingModel?: typeof getLockedEmbeddingModel;
};

export function createToolsIngestedReposRouter(
  deps: Deps = {
    getRootsCollection,
    getLockedModel,
    getLockedEmbeddingModel,
  },
) {
  const router = Router();

  router.get('/tools/ingested-repos', async (_req, res) => {
    try {
      const payload = await listIngestedRepositories({
        getRootsCollection: deps.getRootsCollection,
        getLockedModel: deps.getLockedModel,
        ...(typeof deps.getLockedEmbeddingModel === 'function'
          ? { getLockedEmbeddingModel: deps.getLockedEmbeddingModel }
          : {}),
      });
      baseLogger.info(
        {
          surface: 'tools/ingested-repos',
          source: 'canonical',
          lockedModelId: payload.lockedModelId,
          count: payload.repos.length,
          requestId: res.locals?.requestId as string | undefined,
        },
        'DEV-0000036:T2:lock_resolver_source_selected',
      );
      baseLogger.info(
        {
          surface: 'tools/ingested-repos',
          embeddingProvider: payload.lock?.embeddingProvider ?? null,
          embeddingModel: payload.lock?.embeddingModel ?? null,
          embeddingDimensions: payload.lock?.embeddingDimensions ?? null,
          requestId: res.locals?.requestId as string | undefined,
        },
        'DEV-0000036:T2:lock_resolver_surface_parity',
      );
      const requestId =
        (res.locals?.requestId as string | undefined) ?? undefined;
      baseLogger.info(
        {
          requestId,
          repos: payload.repos.length,
          lockedModelId: payload.lockedModelId,
        },
        'tools ingested repos',
      );
      baseLogger.info(
        {
          requestId,
          surface: 'tools/ingested-repos',
          repoCount: payload.repos.length,
          embeddingProvider: payload.lock?.embeddingProvider ?? null,
          embeddingModel: payload.lock?.embeddingModel ?? null,
          embeddingDimensions: payload.lock?.embeddingDimensions ?? null,
          aliasLockedModelIdPresent: payload.lockedModelId != null,
          aliasModelIdPresent: payload.lock?.modelId != null,
        },
        'DEV-0000036:T10:ingest_repo_payload_emitted',
      );
      baseLogger.info(
        {
          requestId,
          surface: 'tools/ingested-repos',
          schemaVersion: payload.schemaVersion ?? INGEST_REPO_SCHEMA_VERSION,
        },
        'DEV-0000036:T10:ingest_repo_schema_version_emitted',
      );

      res.json(payload);
    } catch (err) {
      res.status(502).json({ error: 'CHROMA_UNAVAILABLE', message: `${err}` });
    }
  });

  return router;
}
