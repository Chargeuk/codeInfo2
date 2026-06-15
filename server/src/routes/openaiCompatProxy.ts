import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import express, { Router, type Request, type Response } from 'express';

import {
  fetchOpenAiCompatModels,
  forwardOpenAiCompatProxyRequest,
  isValidOpenAiCompatProxySecret,
  resolveOpenAiCompatEndpointFromProxyToken,
  serializeOpenAiCompatModelsForConsumer,
  type OpenAiCompatAdapterConsumer,
} from '../chat/openaiCompatAdapter.js';
import {
  flattenCodexNamespaceToolsForCustomProvider,
  restoreCodexNamespaceToolCallsFromCustomProviderResponse,
} from '../chat/openaiCompatToolFlattening.js';
import { supportsOpenAiCompatBuiltInWebSearch } from '../config/openaiCompatEndpoints.js';

function copyResponseHeaders(source: Headers, res: Response) {
  const blockedHeaders = new Set([
    'connection',
    'content-encoding',
    'content-length',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'set-cookie',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);
  source.forEach((value, key) => {
    if (blockedHeaders.has(key.toLowerCase())) {
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

function isStreamingProxyResponse(response: globalThis.Response): boolean {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return contentType.includes('text/event-stream');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWebSearchToolEntry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.type === 'string' && /web_search/i.test(value.type);
}

function resolveExplicitWebSearchAvailability(
  body: Record<string, unknown>,
): boolean | undefined {
  const mode =
    typeof body.webSearchMode === 'string'
      ? body.webSearchMode
      : typeof body.web_search_mode === 'string'
        ? body.web_search_mode
        : undefined;
  if (mode !== undefined) {
    return mode === 'live';
  }

  if (typeof body.webSearchEnabled === 'boolean') {
    return body.webSearchEnabled;
  }
  if (typeof body.web_search_enabled === 'boolean') {
    return body.web_search_enabled;
  }

  return undefined;
}

function prepareUnslothBuiltInWebSearchBody(
  bodyText: string | undefined,
  endpointSupportsBuiltInWebSearch: boolean,
): string | undefined {
  if (!endpointSupportsBuiltInWebSearch || !bodyText) {
    return bodyText;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }

  if (!isRecord(parsed)) {
    return bodyText;
  }

  const explicitAvailability = resolveExplicitWebSearchAvailability(parsed);
  const existingTools = Array.isArray(parsed.tools) ? parsed.tools : undefined;
  const hasWebSearchTool = existingTools?.some(isWebSearchToolEntry) ?? false;
  const shouldEnableWebSearch =
    explicitAvailability !== undefined
      ? explicitAvailability
      : hasWebSearchTool;

  if (!shouldEnableWebSearch) {
    return bodyText;
  }

  const nextBody: Record<string, unknown> = { ...parsed };
  if (existingTools) {
    nextBody.tools = existingTools.filter((tool) => !isWebSearchToolEntry(tool));
  }
  const enabledTools = Array.isArray(nextBody.enabled_tools)
    ? nextBody.enabled_tools.filter((entry) => typeof entry === 'string')
    : [];
  if (!enabledTools.includes('web_search')) {
    enabledTools.push('web_search');
  }
  nextBody.enable_tools = true;
  nextBody.enabled_tools = enabledTools;
  return JSON.stringify(nextBody);
}

function createCodexNamespaceToolCallRestoreStream(params: {
  restoreResponse: (rawBodyText: string) => string;
}) {
  let remainder = '';
  const decoder = new StringDecoder('utf8');

  const rewriteLine = (line: string) => {
    const dataPrefix = 'data:';
    if (!line.startsWith(dataPrefix)) {
      return `${line}\n`;
    }
    const payload = line.slice(dataPrefix.length).trimStart();
    if (payload === '' || payload === '[DONE]') {
      return `${line}\n`;
    }
    return `data: ${params.restoreResponse(payload)}\n`;
  };

  return new Transform({
    transform(chunk, _encoding, callback) {
      remainder += decoder.write(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
      );
      const lines = remainder.split('\n');
      remainder = lines.pop() ?? '';
      const rewritten = lines.map((line) => rewriteLine(line)).join('');
      callback(null, rewritten);
    },
    flush(callback) {
      remainder += decoder.end();
      if (remainder.length === 0) {
        callback();
        return;
      }
      callback(null, rewriteLine(remainder));
    },
  });
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
      const bodyText =
        typeof req.body === 'string'
          ? req.body
          : req.body === undefined
            ? undefined
            : JSON.stringify(req.body);
      const preparedBodyText = prepareUnslothBuiltInWebSearchBody(
        bodyText,
        supportsOpenAiCompatBuiltInWebSearch(endpoint),
      );
      const flattenedCodexToolPayload =
        consumer === 'codex' && path === 'responses'
          ? flattenCodexNamespaceToolsForCustomProvider(preparedBodyText)
          : {
              bodyText: preparedBodyText,
              namespaceToolCallMap: {},
            };
      const response = await forwardOpenAiCompatProxyRequest({
        endpoint,
        method: 'POST',
        path,
        bodyText: flattenedCodexToolPayload.bodyText,
        contentType: req.get('content-type') ?? 'application/json',
        accept: req.get('accept') ?? undefined,
      });

      if (!response.body) {
        res.status(response.status);
        copyResponseHeaders(response.headers, res);
        return res.end();
      }
      if (!isStreamingProxyResponse(response)) {
        const bodyBuffer = Buffer.from(await response.arrayBuffer());
        const body =
          consumer === 'codex' && path === 'responses'
            ? Buffer.from(
                restoreCodexNamespaceToolCallsFromCustomProviderResponse(
                  bodyBuffer.toString('utf8'),
                  flattenedCodexToolPayload.namespaceToolCallMap,
                ),
                'utf8',
              )
            : bodyBuffer;
        res.status(response.status);
        copyResponseHeaders(response.headers, res);
        return res.end(body);
      }

      res.status(response.status);
      copyResponseHeaders(response.headers, res);
      try {
        const upstreamStream = Readable.fromWeb(response.body as never);
        const restoreResponse = (rawBodyText: string) =>
          restoreCodexNamespaceToolCallsFromCustomProviderResponse(
            rawBodyText,
            flattenedCodexToolPayload.namespaceToolCallMap,
          );
        if (
          consumer === 'codex' &&
          path === 'responses' &&
          Object.keys(flattenedCodexToolPayload.namespaceToolCallMap).length > 0
        ) {
          await pipeline(
            upstreamStream,
            createCodexNamespaceToolCallRestoreStream({ restoreResponse }),
            res,
          );
          return undefined;
        }
        await pipeline(upstreamStream, res);
      } catch (error) {
        if (!res.destroyed) {
          res.destroy(error instanceof Error ? error : undefined);
        }
      }
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
