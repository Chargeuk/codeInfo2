import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import { getLockedModel } from '../ingest/modelLock.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { BASE_URL_REGEX, scrubBaseUrl, toWebSocketUrl } from './lmstudioUrl.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
const mapModel = (model: {
  modelKey?: string;
  displayName?: string;
  type?: string;
  contextLength?: number;
  maxContextLength?: number;
  format?: string;
  sizeBytes?: number;
  filename?: string;
  path?: string;
  capabilities?: string[];
}) => ({
  id: model.modelKey ?? model.displayName ?? 'unknown',
  displayName: model.displayName ?? model.modelKey ?? 'unknown',
  contextLength: model.contextLength ?? model.maxContextLength ?? null,
  format: model.format ?? null,
  size: model.sizeBytes ?? null,
  filename:
    model.filename ??
    (model.path ? (model.path.split('/').pop() ?? null) : null),
});

export function createIngestModelsRouter({
  clientFactory,
}: {
  clientFactory: ClientFactory;
}) {
  const router = Router();
  router.get('/ingest/models', async (_req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? '';
    const safeBase = scrubBaseUrl(baseUrl);

    if (!BASE_URL_REGEX.test(baseUrl)) {
      append({
        level: 'error',
        message: 'ingest models invalid baseUrl',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase },
      });
      baseLogger.error(
        { requestId, baseUrl: safeBase },
        'ingest models invalid baseUrl',
      );
      return res
        .status(502)
        .json({ status: 'error', message: 'lmstudio unavailable' });
    }

    append({
      level: 'info',
      message: 'ingest models fetch start',
      timestamp: new Date().toISOString(),
      source: 'server',
      requestId,
      context: { baseUrl: safeBase },
    });

    try {
      const client = clientFactory(toWebSocketUrl(baseUrl));
      const models = await client.system.listDownloadedModels();
      const embedding = models.filter((m) => {
        const type = (m.type ?? '').toLowerCase();
        const caps = Array.isArray(
          (m as { capabilities?: string[] }).capabilities,
        )
          ? ((m as { capabilities?: string[] }).capabilities as string[])
          : [];
        return type === 'embedding' || caps.includes('embedding');
      });

      const mapped = embedding.map(mapModel);
      const lockedModelId = await getLockedModel();

      append({
        level: 'info',
        message: 'ingest models fetch success',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, models: mapped.length },
      });
      baseLogger.info(
        { requestId, baseUrl: safeBase, models: mapped.length },
        'ingest models fetch success',
      );

      res.json({ models: mapped, lockedModelId });
    } catch (err) {
      const error = (err as Error).message ?? 'lmstudio unavailable';
      append({
        level: 'error',
        message: 'ingest models fetch failed',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, error },
      });
      baseLogger.error(
        { requestId, baseUrl: safeBase, error },
        'ingest models fetch failed',
      );
      res.status(502).json({ status: 'error', message: error });
    }
  });

  return router;
}
