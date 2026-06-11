import { Readable } from 'node:stream';
import express, { Router, type Request, type Response } from 'express';

import {
  fetchOpenAiCompatModels,
  forwardOpenAiCompatProxyRequest,
  isValidOpenAiCompatProxySecret,
  resolveOpenAiCompatEndpointFromProxyToken,
  serializeOpenAiCompatModelsForConsumer,
  type OpenAiCompatAdapterConsumer,
} from '../chat/openaiCompatAdapter.js';

function copyResponseHeaders(source: Headers, res: Response) {
  source.forEach((value, key) => {
    if (key.toLowerCase() === 'content-length') {
      return;
    }
    res.setHeader(key, value);
  });
}

function buildRouterErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid endpoint token|openaicompatendpointtoken/i.test(message)
    ? 404
    : 502;
}

function parseConsumer(value: string): OpenAiCompatAdapterConsumer | null {
  return value === 'codex' || value === 'copilot' ? value : null;
}

export function createOpenAiCompatProxyRouter() {
  const router = Router();
  router.use(
    '/internal/openai-compat',
    express.text({ type: '*/*', limit: '25mb' }),
  );

  router.get(
    '/internal/openai-compat/:secret/:consumer/:endpointToken/v1/models',
    async (req, res) => {
      if (!isValidOpenAiCompatProxySecret(req.params.secret ?? '')) {
        return res.status(404).json({ error: 'not found' });
      }
      const consumer = parseConsumer(req.params.consumer ?? '');
      if (!consumer) {
        return res.status(404).json({ error: 'not found' });
      }
      try {
        const endpoint = resolveOpenAiCompatEndpointFromProxyToken({
          endpointToken: req.params.endpointToken ?? '',
        });
        const models = await fetchOpenAiCompatModels({
          endpoint,
          consumer,
        });
        return res
          .status(200)
          .json(
            serializeOpenAiCompatModelsForConsumer({
              endpoint,
              consumer,
              models,
            }),
          );
      } catch (error) {
        const status = buildRouterErrorStatus(error);
        const message =
          error instanceof Error ? error.message : String(error ?? 'unknown');
        return res.status(status).json({ error: message });
      }
    },
  );

  const handlePostProxy = async (
    req: Request,
    res: Response,
    path: 'responses' | 'chat/completions',
  ) => {
    if (!isValidOpenAiCompatProxySecret(req.params.secret ?? '')) {
      return res.status(404).json({ error: 'not found' });
    }
    const consumer = parseConsumer(req.params.consumer ?? '');
    if (!consumer) {
      return res.status(404).json({ error: 'not found' });
    }
    try {
      const endpoint = resolveOpenAiCompatEndpointFromProxyToken({
        endpointToken: req.params.endpointToken ?? '',
      });
      const response = await forwardOpenAiCompatProxyRequest({
        endpoint,
        method: 'POST',
        path,
        bodyText:
          typeof req.body === 'string'
            ? req.body
            : req.body === undefined
              ? undefined
              : JSON.stringify(req.body),
        contentType: req.get('content-type') ?? 'application/json',
        accept: req.get('accept') ?? undefined,
      });

      res.status(response.status);
      copyResponseHeaders(response.headers, res);
      if (!response.body) {
        return res.end();
      }
      Readable.fromWeb(response.body as never).pipe(res);
      return undefined;
    } catch (error) {
      const status = buildRouterErrorStatus(error);
      const message =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      return res.status(status).json({ error: message });
    }
  };

  router.post(
    '/internal/openai-compat/:secret/:consumer/:endpointToken/v1/responses',
    async (req, res) => await handlePostProxy(req, res, 'responses'),
  );
  router.post(
    '/internal/openai-compat/:secret/:consumer/:endpointToken/v1/chat/completions',
    async (req, res) => await handlePostProxy(req, res, 'chat/completions'),
  );

  return router;
}
