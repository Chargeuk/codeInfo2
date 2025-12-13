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
import { dispatchJsonRpc } from '../mcpCommon/dispatch.js';
import { isObject } from '../mcpCommon/guards.js';
import { jsonRpcError, jsonRpcResult } from '../mcpCommon/jsonRpc.js';

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

type JsonRpcLikeResponse = ReturnType<typeof jsonRpcResult>;

const invalidRequest = (id: unknown) =>
  jsonRpcError(id as never, -32600, 'Invalid Request') as JsonRpcLikeResponse;

const methodNotFound = (id: unknown) =>
  jsonRpcError(id as never, -32601, 'Method not found') as JsonRpcLikeResponse;

const invalidParams = (id: unknown, message: string, data?: unknown) =>
  jsonRpcError(id as never, -32602, message, data) as JsonRpcLikeResponse;

const internalError = (id: unknown, message: string, data?: unknown) =>
  jsonRpcError(id as never, -32603, message, data) as JsonRpcLikeResponse;

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
    const requestId =
      (res.locals?.requestId as string | undefined) ?? undefined;

    const response = await dispatchJsonRpc({
      message: body,
      getId: (message) => (isObject(message) ? message.id : undefined),
      handlers: {
        initialize: (id) =>
          jsonRpcResult(id as never, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'codeinfo2-mcp', version: '1.0.0' },
          }) as JsonRpcLikeResponse,
        resourcesList: (id) =>
          jsonRpcResult(id as never, { resources: [] }) as JsonRpcLikeResponse,
        resourcesListTemplates: (id) =>
          jsonRpcResult(id as never, {
            resourceTemplates: [],
          }) as JsonRpcLikeResponse,
        toolsList: (id) =>
          jsonRpcResult(id as never, {
            tools: toolDefinitions,
          }) as JsonRpcLikeResponse,
        toolsCall: async (id, params) => {
          if (!isObject(params)) {
            return invalidParams(id, 'params must be an object');
          }
          const toolCall = params as ToolCallParams;
          if (typeof toolCall.name !== 'string' || !toolCall.name.trim()) {
            return invalidParams(id, 'name is required');
          }
          const args = isObject(toolCall.arguments) ? toolCall.arguments : {};

          try {
            if (toolCall.name === 'ListIngestedRepositories') {
              const payload = await resolved.listIngestedRepositories({
                getRootsCollection: resolved.getRootsCollection,
                getLockedModel: resolved.getLockedModel,
              });
              baseLogger.info(
                {
                  requestId,
                  tool: toolCall.name,
                  repos: payload.repos.length,
                },
                'mcp tool call',
              );
              return jsonRpcResult(id as never, {
                content: [{ type: 'text', text: JSON.stringify(payload) }],
              }) as JsonRpcLikeResponse;
            }

            if (toolCall.name === 'VectorSearch') {
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
                  tool: toolCall.name,
                  repository: validated.repository ?? 'all',
                  limit: validated.limit,
                  results: payload.results.length,
                  modelId: payload.modelId,
                },
                'mcp tool call',
              );
              return jsonRpcResult(id as never, {
                content: [{ type: 'text', text: JSON.stringify(payload) }],
              }) as JsonRpcLikeResponse;
            }

            return invalidParams(id, `Unknown tool ${toolCall.name}`);
          } catch (err) {
            if (err instanceof ValidationError) {
              return invalidParams(id, err.message, { details: err.details });
            }
            if (err instanceof RepoNotFoundError) {
              return jsonRpcError(id as never, 404, err.code, {
                repo: err.repo,
              }) as JsonRpcLikeResponse;
            }
            if (err instanceof IngestRequiredError) {
              baseLogger.warn(
                { requestId },
                'mcp vector search missing locked model',
              );
              return jsonRpcError(
                id as never,
                409,
                err.code,
              ) as JsonRpcLikeResponse;
            }
            if (err instanceof EmbedModelMissingError) {
              baseLogger.error(
                { requestId, modelId: err.modelId },
                'mcp vector search missing embed model',
              );
              return jsonRpcError(id as never, 503, err.code, {
                modelId: err.modelId,
              }) as JsonRpcLikeResponse;
            }
            baseLogger.error({ requestId, err }, 'mcp tool call failed');
            return internalError(id, 'Internal error', { message: `${err}` });
          }
        },
        methodNotFound,
        invalidRequest,
      },
    });

    return res.json(response);
  });

  return router;
}
