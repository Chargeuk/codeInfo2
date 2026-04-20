import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import { pumpIngestQueue } from '../ingest/ingestJob.js';
import {
  appendIngestFailureLog,
  classifyIngestFailure,
} from '../ingest/providers/index.js';
import {
  buildQueuedReingestRequest,
  findReingestableRepoByExactSourceId,
  validateExactReingestSourceId,
} from '../ingest/reingestService.js';
import {
  enqueueOrReuseIngestRequest,
  QUEUE_REQUEST_UPDATED_IN_PLACE_LOG_MESSAGE,
} from '../ingest/requestQueue.js';
import { listIngestedRepositories } from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';

export function createIngestReembedRouter({
  listIngestedRepositories:
    listIngestedRepositoriesOverride = listIngestedRepositories,
  enqueueOrReuseIngestRequest:
    enqueueOrReuseIngestRequestOverride = enqueueOrReuseIngestRequest,
  pumpIngestQueue: pumpIngestQueueOverride = pumpIngestQueue,
}: {
  clientFactory: (baseUrl: string) => LMStudioClient;
  listIngestedRepositories?: typeof listIngestedRepositories;
  enqueueOrReuseIngestRequest?: typeof enqueueOrReuseIngestRequest;
  pumpIngestQueue?: typeof pumpIngestQueue;
}) {
  const router = Router();

  router.post('/ingest/reembed/:root', async (req, res) => {
    const { root } = req.params;
    try {
      const validatedRoot = validateExactReingestSourceId(root);
      if (!validatedRoot.ok) {
        const error = new Error('NOT_FOUND');
        (error as { code?: string }).code = 'NOT_FOUND';
        throw error;
      }
      const repos = await listIngestedRepositoriesOverride();
      const selectedRepo = findReingestableRepoByExactSourceId(
        repos,
        validatedRoot.sourceId,
      );
      if (!selectedRepo) {
        const error = new Error('NOT_FOUND');
        (error as { code?: string }).code = 'NOT_FOUND';
        throw error;
      }

      const queueResult = await enqueueOrReuseIngestRequestOverride(
        buildQueuedReingestRequest(selectedRepo),
      );
      const pumpResult = await pumpIngestQueueOverride();
      const runId =
        queueResult.runId ??
        (pumpResult.requestId === queueResult.requestId
          ? (pumpResult.runId ?? null)
          : null);
      if (queueResult.updatedExisting) {
        append({
          level: 'info',
          message: QUEUE_REQUEST_UPDATED_IN_PLACE_LOG_MESSAGE,
          timestamp: new Date().toISOString(),
          source: 'server',
          requestId: (res.locals?.requestId as string | undefined) ?? undefined,
          context: {
            endpoint: '/ingest/reembed/:root',
            queueRequestId: queueResult.requestId,
            canonicalTargetPath: queueResult.canonicalTargetPath,
            runId,
            queued: !runId,
            queuePosition: runId ? undefined : queueResult.queuePosition,
            reusedExisting: queueResult.reusedExisting,
            updatedExisting: queueResult.updatedExisting,
          },
        });
      }
      append({
        level: 'info',
        message: 'QUEUE_REQUEST_ACCEPTED_WITH_REQUEST_ID',
        timestamp: new Date().toISOString(),
        source: 'server',
        requestId: (res.locals?.requestId as string | undefined) ?? undefined,
        context: {
          endpoint: '/ingest/reembed/:root',
          queueRequestId: queueResult.requestId,
          canonicalTargetPath: queueResult.canonicalTargetPath,
          runId,
          queued: !runId,
          queuePosition: runId ? undefined : queueResult.queuePosition,
        },
      });
      return res.status(202).json(
        runId
          ? {
              queued: false,
              requestId: queueResult.requestId,
              runId,
            }
          : {
              queued: true,
              requestId: queueResult.requestId,
              queuePosition: queueResult.queuePosition,
            },
      );
    } catch (err) {
      const classified = classifyIngestFailure(err, {
        surface: 'ingest/reembed',
        defaultCode: 'INGEST_REEMBED_FAILED',
      });
      appendIngestFailureLog(classified.severity, {
        provider: classified.provider,
        code: classified.code,
        retryable: classified.retryable,
        root,
        message: classified.message,
        stage: 'terminal',
        surface: classified.surface,
        operation: 'reembed',
        ...(typeof classified.upstreamStatus === 'number'
          ? { upstreamStatus: classified.upstreamStatus }
          : {}),
        ...(typeof classified.retryAfterMs === 'number'
          ? { retryAfterMs: classified.retryAfterMs }
          : {}),
      });
      baseLogger.error({ root, err }, 'ingest reembed failed');
      const code = (err as { code?: string }).code;
      if (code === 'MODEL_LOCKED')
        return res.status(409).json({ status: 'error', code });
      if (code === 'OPENAI_MODEL_UNAVAILABLE')
        return res.status(409).json({ status: 'error', code });
      if (code === 'INVALID_REEMBED_STATE')
        return res.status(409).json({ status: 'error', code });
      if (code === 'INVALID_LOCK_METADATA')
        return res.status(409).json({ status: 'error', code });
      if (code === 'NOT_FOUND')
        return res.status(404).json({ status: 'error', code });
      if (code === 'QUEUE_UNAVAILABLE') {
        if (typeof classified.retryAfterMs === 'number') {
          res.setHeader(
            'Retry-After',
            String(Math.max(1, Math.ceil(classified.retryAfterMs / 1000))),
          );
        }
        return res.status(503).json({
          status: 'error',
          code: 'QUEUE_UNAVAILABLE',
          retryable: true,
          message: classified.message,
        });
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
