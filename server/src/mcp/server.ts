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
  listIngestedRepositories,
  validateVectorSearch,
  vectorSearch,
} from '../lmstudio/toolService.js';
import { baseLogger } from '../logger.js';

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type ToolCallParams = {
  name?: unknown;
  arguments?: unknown;
};

type Deps = {
  listIngestedRepositories: typeof listIngestedRepositories;
  vectorSearch: typeof vectorSearch;
  validateVectorSearch: typeof validateVectorSearch;
  getRootsCollection: typeof getRootsCollection;
  getVectorsCollection: typeof getVectorsCollection;
  getLockedModel: typeof getLockedModel;
};

const PROTOCOL_VERSION = '2024-11-05';

const toolDefinitions = [
  {
    name: 'ListIngestedRepositories',
    description:
      'List repositories that have been ingested, including host/container paths, counts, lock status, and last error.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    outputSchema: {
      type: 'object',
      required: ['repos', 'lockedModelId'],
      properties: {
        repos: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'containerPath', 'hostPath', 'counts', 'modelId'],
            properties: {
              id: { type: 'string' },
              description: { type: ['string', 'null'] },
              containerPath: { type: 'string' },
              hostPath: { type: 'string' },
              hostPathWarning: { type: 'string' },
              lastIngestAt: { type: ['string', 'null'], format: 'date-time' },
              modelId: { type: 'string' },
              counts: {
                type: 'object',
                required: ['files', 'chunks', 'embedded'],
                properties: {
                  files: { type: 'number' },
                  chunks: { type: 'number' },
                  embedded: { type: 'number' },
                },
              },
              lastError: { type: ['string', 'null'] },
            },
            additionalProperties: false,
          },
        },
        lockedModelId: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'VectorSearch',
    description:
      'Search ingested chunks (optionally scoped to a repository) and return ranked matches with host and container paths.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
        repository: {
          type: 'string',
          description: 'Optional repo id to scope results',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Max results to return (default 5, capped at 20)',
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['results', 'modelId', 'files'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'repo',
              'relPath',
              'containerPath',
              'hostPath',
              'chunk',
              'chunkId',
              'modelId',
            ],
            properties: {
              repo: { type: 'string' },
              relPath: { type: 'string' },
              containerPath: { type: 'string' },
              hostPath: { type: 'string' },
              hostPathWarning: { type: 'string' },
              score: { type: ['number', 'null'] },
              chunk: { type: 'string' },
              chunkId: { type: 'string' },
              modelId: { type: 'string' },
              lineCount: { type: ['number', 'null'] },
            },
            additionalProperties: false,
          },
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            required: ['hostPath', 'chunkCount'],
            properties: {
              hostPath: { type: 'string' },
              highestMatch: { type: ['number', 'null'] },
              chunkCount: { type: 'number' },
              lineCount: { type: ['number', 'null'] },
              hostPathWarning: { type: 'string' },
              repo: { type: 'string' },
              modelId: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        modelId: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
  },
];

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
) {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const invalidRequest = (id: unknown) =>
  jsonRpcError(id, -32600, 'Invalid Request');

const methodNotFound = (id: unknown) =>
  jsonRpcError(id, -32601, 'Method not found');

const invalidParams = (id: unknown, message: string, data?: unknown) =>
  jsonRpcError(id, -32602, message, data);

const internalError = (id: unknown, message: string, data?: unknown) =>
  jsonRpcError(id, -32603, message, data);

export function createMcpRouter(
  deps: Partial<Deps> = {},
): ReturnType<typeof Router> {
  const resolved: Deps = {
    listIngestedRepositories,
    vectorSearch,
    validateVectorSearch,
    getRootsCollection,
    getVectorsCollection,
    getLockedModel,
    ...deps,
  };

  const router = Router();

  router.post('/mcp', async (req, res) => {
    const body = req.body as JsonRpcRequest;

    if (
      !isObject(body) ||
      body.jsonrpc !== '2.0' ||
      typeof body.method !== 'string'
    ) {
      return res.json(invalidRequest(body?.id));
    }

    const { id, method } = body;
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;

    if (method === 'initialize') {
      return res.json(
        jsonRpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'codeinfo2-mcp', version: '1.0.0' },
        }),
      );
    }

    if (method === 'tools/list') {
      return res.json(jsonRpcResult(id, { tools: toolDefinitions }));
    }

    if (method === 'resources/list') {
      return res.json(jsonRpcResult(id, { resources: [] }));
    }

    if (method === 'resources/listTemplates') {
      return res.json(jsonRpcResult(id, { resourceTemplates: [] }));
    }

    if (method === 'tools/call') {
      if (!isObject(body.params)) {
        return res.json(invalidParams(id, 'params must be an object'));
      }
      const params = body.params as ToolCallParams;
      if (typeof params.name !== 'string' || !params.name.trim()) {
        return res.json(invalidParams(id, 'name is required'));
      }
      const args = isObject(params.arguments) ? params.arguments : {};

      try {
        if (params.name === 'ListIngestedRepositories') {
          const payload = await resolved.listIngestedRepositories({
            getRootsCollection: resolved.getRootsCollection,
            getLockedModel: resolved.getLockedModel,
          });
          baseLogger.info(
            { requestId, tool: params.name, repos: payload.repos.length },
            'mcp tool call',
          );
          return res.json(
            jsonRpcResult(id, {
              content: [{ type: 'text', text: JSON.stringify(payload) }],
            }),
          );
        }

        if (params.name === 'VectorSearch') {
          const validated = resolved.validateVectorSearch(
            args as Record<string, unknown>,
          );
          const payload = await resolved.vectorSearch(validated, {
            getRootsCollection: resolved.getRootsCollection,
            getVectorsCollection: resolved.getVectorsCollection,
            getLockedModel: resolved.getLockedModel,
          });
          baseLogger.info(
            {
              requestId,
              tool: params.name,
              repository: validated.repository ?? 'all',
              limit: validated.limit,
              results: payload.results.length,
              modelId: payload.modelId,
            },
            'mcp tool call',
          );
          return res.json(
            jsonRpcResult(id, {
              content: [{ type: 'text', text: JSON.stringify(payload) }],
            }),
          );
        }

        return res.json(invalidParams(id, `Unknown tool ${params.name}`));
      } catch (err) {
        if (err instanceof ValidationError) {
          return res.json(
            invalidParams(id, err.message, { details: err.details }),
          );
        }
        if (err instanceof RepoNotFoundError) {
          return res.json(jsonRpcError(id, 404, err.code, { repo: err.repo }));
        }
        if (err instanceof IngestRequiredError) {
          baseLogger.warn(
            { requestId },
            'mcp vector search missing locked model',
          );
          return res.json(jsonRpcError(id, 409, err.code));
        }
        if (err instanceof EmbedModelMissingError) {
          baseLogger.error(
            { requestId, modelId: err.modelId },
            'mcp vector search missing embed model',
          );
          return res.json(
            jsonRpcError(id, 503, err.code, { modelId: err.modelId }),
          );
        }
        baseLogger.error({ requestId, err }, 'mcp tool call failed');
        return res.json(
          internalError(id, 'Internal error', { message: `${err}` }),
        );
      }
    }

    return res.json(methodNotFound(id));
  });

  return router;
}
