import type { LmStudioModel, LmStudioStatusResponse } from '@codeinfo2/common';
import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';

type ClientFactory = (baseUrl: string) => LMStudioClient;
const BASE_URL_REGEX = /^(https?|wss?):\/\//i;
const REQUEST_TIMEOUT_MS = 60_000;

const scrubBaseUrl = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return '[invalid-url]';
  }
};

export function createLmStudioRouter({
  clientFactory,
}: {
  clientFactory: ClientFactory;
}) {
  const router = Router();
  router.get('/lmstudio/status', async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const baseUrlParam = req.query.baseUrl;
    const baseUrl =
      (typeof baseUrlParam === 'string' ? baseUrlParam : undefined) ??
      process.env.LMSTUDIO_BASE_URL ??
      '';
    const safeBase = scrubBaseUrl(baseUrl);

    if (!BASE_URL_REGEX.test(baseUrl)) {
      const body: LmStudioStatusResponse = {
        status: 'error',
        baseUrl,
        error: 'Invalid baseUrl',
      };
      append({
        level: 'warn',
        message: 'lmstudio status invalid baseUrl',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase },
      });
      baseLogger.warn(
        { requestId, baseUrl: safeBase },
        'lmstudio invalid baseUrl',
      );
      return res.status(400).json(body);
    }

    try {
      const clientBaseUrl = baseUrl.startsWith('http://')
        ? baseUrl.replace(/^http:/i, 'ws:')
        : baseUrl.startsWith('https://')
          ? baseUrl.replace(/^https:/i, 'wss:')
          : baseUrl;
      const client = clientFactory(clientBaseUrl);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Request timed out')),
          REQUEST_TIMEOUT_MS,
        ),
      );
      const models = await Promise.race([
        client.system.listDownloadedModels(),
        timeoutPromise,
      ]);

      const mapped: LmStudioModel[] = models.map((model) => {
        const vision =
          'vision' in model
            ? ((model as { vision?: boolean }).vision ?? false)
            : false;
        const trainedForToolUse =
          'trainedForToolUse' in model
            ? ((model as { trainedForToolUse?: boolean }).trainedForToolUse ??
              false)
            : false;

        return {
          modelKey: model.modelKey,
          displayName: model.displayName,
          type: model.type,
          format: model.format ?? null,
          path: model.path ?? null,
          sizeBytes: model.sizeBytes ?? null,
          architecture: model.architecture ?? null,
          paramsString: model.paramsString ?? null,
          maxContextLength: model.maxContextLength ?? null,
          vision,
          trainedForToolUse,
        };
      });

      const body: LmStudioStatusResponse = {
        status: 'ok',
        baseUrl,
        models: mapped,
      };
      append({
        level: 'info',
        message: 'lmstudio status success',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, models: mapped.length },
      });
      baseLogger.info(
        { requestId, baseUrl: safeBase, models: mapped.length },
        'lmstudio status success',
      );
      res.json(body);
    } catch (err) {
      const message = (err as Error).message;
      const body: LmStudioStatusResponse = {
        status: 'error',
        baseUrl,
        error: message,
      };
      append({
        level: 'error',
        message: 'lmstudio status failed',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId,
        context: { baseUrl: safeBase, error: message },
      });
      baseLogger.error(
        { requestId, baseUrl: safeBase, error: message },
        'lmstudio status failed',
      );
      res.status(502).json(body);
    }
  });
  return router;
}
