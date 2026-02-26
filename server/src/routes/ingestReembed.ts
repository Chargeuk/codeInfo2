import type { LMStudioClient } from '@lmstudio/sdk';
import { Router } from 'express';
import { isBusy, reembed } from '../ingest/ingestJob.js';
import {
  appendIngestFailureLog,
  classifyIngestFailure,
} from '../ingest/providers/index.js';
import { baseLogger } from '../logger.js';
import { toWebSocketUrl } from './lmstudioUrl.js';

export function createIngestReembedRouter({
  clientFactory,
  reembed: reembedOverride = reembed,
  isBusy: isBusyOverride = isBusy,
}: {
  clientFactory: (baseUrl: string) => LMStudioClient;
  reembed?: typeof reembed;
  isBusy?: typeof isBusy;
}) {
  const router = Router();

  router.post('/ingest/reembed/:root', async (req, res) => {
    if (isBusyOverride()) {
      return res.status(429).json({ status: 'error', code: 'BUSY' });
    }
    const { root } = req.params;
    const baseUrl = toWebSocketUrl(process.env.LMSTUDIO_BASE_URL ?? '');
    try {
      const runId = await reembedOverride(root, {
        lmClientFactory: clientFactory,
        baseUrl,
      });
      return res.status(202).json({ runId });
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
      if (code === 'BUSY')
        return res.status(429).json({ status: 'error', code });
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
      return res.status(500).json({
        status: 'error',
        code: classified.code,
        message: classified.message,
      });
    }
  });

  return router;
}
