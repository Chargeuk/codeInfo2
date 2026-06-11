import http from 'node:http';

export type ExternalOpenAiCompatServerScenario = {
  models?: string[];
  modelEntries?: Array<Record<string, unknown>>;
  responseMode?: 'success' | 'malformed-payload' | 'slow' | 'transport-failure';
  delayMs?: number;
  requiredBearerToken?: string;
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

  const httpServer = http.createServer(async (req, res) => {
    requestCount += 1;
    lastAuthorizationHeader =
      typeof req.headers.authorization === 'string'
        ? req.headers.authorization
        : undefined;
    const url = req.url ?? '';

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

    if (
      requiredBearerToken &&
      req.headers.authorization !== `Bearer ${requiredBearerToken}`
    ) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'unauthorized' }));
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
