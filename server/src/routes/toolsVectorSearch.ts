import { Router } from 'express';
import {
  EmbedModelMissingError,
  IngestRequiredError,
  getLockedModel,
  getRootsCollection,
  getVectorsCollection,
} from '../ingest/chromaClient.js';
import {
  RepoNotFoundError,
  ValidationError,
  validateVectorSearch,
  vectorSearch,
} from '../lmstudio/toolService.js';
import { baseLogger } from '../logger.js';

type Deps = {
  getRootsCollection: typeof getRootsCollection;
  getVectorsCollection: typeof getVectorsCollection;
  getLockedModel: typeof getLockedModel;
};

type VectorSearchBody = {
  query?: unknown;
  repository?: unknown;
  limit?: unknown;
};

export function createToolsVectorSearchRouter(
  deps: Deps = {
    getRootsCollection,
    getVectorsCollection,
    getLockedModel,
  },
) {
  const router = Router();

  router.post('/tools/vector-search', async (req, res) => {
    try {
      const validated = validateVectorSearch(req.body as VectorSearchBody);
      const payload = await vectorSearch(validated, {
        getRootsCollection: deps.getRootsCollection,
        getVectorsCollection: deps.getVectorsCollection,
        getLockedModel: deps.getLockedModel,
      });
      const requestId =
        (res.locals?.requestId as string | undefined) ?? undefined;
      baseLogger.info(
        {
          requestId,
          repository: validated.repository ?? 'all',
          limit: validated.limit,
          results: payload.results.length,
          modelId: payload.modelId,
        },
        'tools vector search',
      );
      return res.json(payload);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.code, details: err.details });
      }
      if (err instanceof RepoNotFoundError) {
        return res.status(404).json({ error: err.code });
      }
      if (err instanceof IngestRequiredError) {
        const requestId =
          (res.locals?.requestId as string | undefined) ?? undefined;
        baseLogger.warn(
          { requestId },
          'tools vector search missing locked model',
        );
        return res.status(409).json({ error: err.code, message: err.message });
      }
      if (err instanceof EmbedModelMissingError) {
        const requestId =
          (res.locals?.requestId as string | undefined) ?? undefined;
        baseLogger.error(
          { requestId, modelId: err.modelId, cause: err.cause },
          'tools vector search embedding model missing',
        );
        return res.status(503).json({
          error: err.code,
          modelId: err.modelId,
          message: err.message,
        });
      }
      return res
        .status(502)
        .json({ error: 'CHROMA_UNAVAILABLE', message: `${err}` });
    }
  });

  return router;
}
