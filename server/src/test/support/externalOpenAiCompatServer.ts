import http from 'node:http';

type ExternalOpenAiCompatMockResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: Record<string, unknown> | string | Buffer;
  bodyChunks?: Array<string | Buffer>;
  delayMs?: number;
  destroySocket?: boolean;
  destroySocketAfterBodyStart?: boolean;
};

export type ExternalOpenAiCompatServerScenario = {
  models?: string[];
  modelEntries?: Array<Record<string, unknown>>;
  responseMode?: 'success' | 'malformed-payload' | 'slow' | 'transport-failure';
  delayMs?: number;
  requiredBearerToken?: string;
  modelResponses?: ExternalOpenAiCompatMockResponse[];
  responsesResponses?: ExternalOpenAiCompatMockResponse[];
  completionsResponses?: ExternalOpenAiCompatMockResponse[];
};

export type ExternalOpenAiCompatServer = {
  baseUrl: string;
  requestCount: () => number;
  lastAuthorizationHeader: () => string | undefined;
  stop: () => Promise<void>;
};

function buildSuccessResponse(
  models: string[],
  modelEntries?: Array<Record<string, unknown>>,
) {
  const data = modelEntries?.length
    ? modelEntries
    : models.map((id, index) => ({
        id,
        object: 'model',
        created: 1_700_000_000 + index,
        owned_by: 'organization-owner',
      }));
  return {
    object: 'list',
    data,
  };
}

function cloneResponse(
  response: ExternalOpenAiCompatMockResponse | undefined,
): ExternalOpenAiCompatMockResponse {
  return {
    ...(response ?? {}),
    ...(response?.headers ? { headers: { ...response.headers } } : {}),
  };
}

export async function startExternalOpenAiCompatServer(
  params: ExternalOpenAiCompatServerScenario = {},
): Promise<ExternalOpenAiCompatServer> {
  let requestCount = 0;
  let lastAuthorizationHeader: string | undefined;
  const responseMode = params.responseMode ?? 'success';
  const models = params.models ?? ['alpha'];
  const modelEntries = params.modelEntries;
  const delayMs = params.delayMs ?? 0;
  const requiredBearerToken = params.requiredBearerToken?.trim();
  const modelResponses = params.modelResponses?.map(cloneResponse) ?? [];
  const responsesResponses = params.responsesResponses?.map(cloneResponse) ?? [];
  const completionsResponses =
    params.completionsResponses?.map(cloneResponse) ?? [];

  const takeResponse = (
    responses: ExternalOpenAiCompatMockResponse[],
  ): ExternalOpenAiCompatMockResponse | undefined => {
    if (responses.length === 0) return undefined;
    return responses.shift();
  };

  const sendMockResponse = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    response: ExternalOpenAiCompatMockResponse | undefined,
    fallbackBody: Record<string, unknown> | string,
  ) => {
    const delayMs = response?.delayMs ?? 0;
    if (response?.destroySocket) {
      req.socket.destroy(new Error('transport failure'));
      return;
    }
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    res.statusCode = response?.status ?? 200;
    for (const [key, value] of Object.entries(response?.headers ?? {})) {
      res.setHeader(key, value);
    }
    if (!res.getHeader('content-type')) {
      res.setHeader('content-type', 'application/json');
    }
    if (Array.isArray(response?.bodyChunks) && response.bodyChunks.length > 0) {
      for (const chunk of response.bodyChunks) {
        res.write(chunk);
      }
      if (response.destroySocketAfterBodyStart) {
        req.socket.destroy(new Error('stream terminated'));
        return;
      }
      res.end();
      return;
    }
    res.end(
      typeof response?.body === 'string' || Buffer.isBuffer(response?.body)
        ? response.body
        : JSON.stringify(response?.body ?? fallbackBody),
    );
  };

  const httpServer = http.createServer(async (req, res) => {
    requestCount += 1;
    lastAuthorizationHeader =
      typeof req.headers.authorization === 'string'
        ? req.headers.authorization
        : undefined;
    const url = req.url ?? '';

    if (
      requiredBearerToken &&
      req.headers.authorization !== `Bearer ${requiredBearerToken}`
    ) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (
      req.method === 'GET' &&
      url === '/v1/models' &&
      modelResponses.length > 0
    ) {
      const response = takeResponse(modelResponses) ?? {};
      await sendMockResponse(req, res, response, buildSuccessResponse(models, modelEntries));
      return;
    }

    if (
      req.method === 'POST' &&
      url === '/v1/responses' &&
      responsesResponses.length > 0
    ) {
      const response = takeResponse(responsesResponses) ?? {};
      await sendMockResponse(req, res, response, {
        output: [{ type: 'output_text', text: 'ok' }],
      });
      return;
    }

    if (
      req.method === 'POST' &&
      url === '/v1/chat/completions' &&
      completionsResponses.length > 0
    ) {
      const response = takeResponse(completionsResponses) ?? {};
      await sendMockResponse(req, res, response, {
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      });
      return;
    }

    if (req.method !== 'GET' || url !== '/v1/models') {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    if (responseMode === 'transport-failure') {
      req.socket.destroy(new Error('transport failure'));
      return;
    }

    if (responseMode === 'slow' && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    switch (responseMode) {
      case 'malformed-payload':
        res.end(
          JSON.stringify({
            object: 'list',
            data: [{ object: 'model', created: 1_700_000_000, owned_by: 'owner' }],
          }),
        );
        break;
      case 'slow':
      case 'success':
      default:
        res.end(JSON.stringify(buildSuccessResponse(models, modelEntries)));
        break;
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  if (!address || typeof address !== 'object') {
    throw new Error('failed to start external OpenAI-compatible test server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestCount: () => requestCount,
    lastAuthorizationHeader: () => lastAuthorizationHeader,
    stop: async () =>
      await new Promise<void>((resolve) => httpServer.close(() => resolve())),
  };
}
