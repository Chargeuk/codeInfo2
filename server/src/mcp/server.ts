import { Router } from 'express';
import {
  AstIndexRequiredError,
  astCallGraph,
  astFindDefinition,
  astFindReferences,
  astListSymbols,
  astModuleImports,
  validateAstCallGraph,
  validateAstFindDefinition,
  validateAstFindReferences,
  validateAstListSymbols,
  validateAstModuleImports,
} from '../ast/toolService.js';
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
import { append } from '../logStore.js';
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
  astListSymbols: typeof astListSymbols;
  validateAstListSymbols: typeof validateAstListSymbols;
  astFindDefinition: typeof astFindDefinition;
  validateAstFindDefinition: typeof validateAstFindDefinition;
  astFindReferences: typeof astFindReferences;
  validateAstFindReferences: typeof validateAstFindReferences;
  astCallGraph: typeof astCallGraph;
  validateAstCallGraph: typeof validateAstCallGraph;
  astModuleImports: typeof astModuleImports;
  validateAstModuleImports: typeof validateAstModuleImports;
  getRootsCollection: typeof getRootsCollection;
  getVectorsCollection: typeof getVectorsCollection;
  getLockedModel: typeof getLockedModel;
};

const PROTOCOL_VERSION = '2024-11-05';

const rangeSchema = {
  type: 'object',
  properties: {
    start: {
      type: 'object',
      properties: {
        line: { type: 'integer' },
        column: { type: 'integer' },
      },
      required: ['line', 'column'],
      additionalProperties: false,
    },
    end: {
      type: 'object',
      properties: {
        line: { type: 'integer' },
        column: { type: 'integer' },
      },
      required: ['line', 'column'],
      additionalProperties: false,
    },
  },
  required: ['start', 'end'],
  additionalProperties: false,
};

const symbolSchema = {
  type: 'object',
  properties: {
    symbolId: { type: 'string' },
    root: { type: 'string' },
    relPath: { type: 'string' },
    fileHash: { type: 'string' },
    language: { type: 'string' },
    kind: { type: 'string' },
    name: { type: 'string' },
    container: { type: 'string' },
    range: rangeSchema,
  },
  required: [
    'symbolId',
    'root',
    'relPath',
    'fileHash',
    'language',
    'kind',
    'name',
    'range',
  ],
  additionalProperties: false,
};

const edgeSchema = {
  type: 'object',
  properties: {
    root: { type: 'string' },
    relPath: { type: 'string' },
    fileHash: { type: 'string' },
    fromSymbolId: { type: 'string' },
    toSymbolId: { type: 'string' },
    type: { type: 'string' },
  },
  required: [
    'root',
    'relPath',
    'fileHash',
    'fromSymbolId',
    'toSymbolId',
    'type',
  ],
  additionalProperties: false,
};

const referenceSchema = {
  type: 'object',
  properties: {
    relPath: { type: 'string' },
    range: rangeSchema,
    symbolId: { type: 'string' },
  },
  required: ['relPath', 'range'],
  additionalProperties: false,
};

const moduleImportSchema = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    names: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['source', 'names'],
  additionalProperties: false,
};

const moduleImportsSchema = {
  type: 'object',
  properties: {
    relPath: { type: 'string' },
    imports: {
      type: 'array',
      items: moduleImportSchema,
    },
  },
  required: ['relPath', 'imports'],
  additionalProperties: false,
};

const baseToolDefinitions = [
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

const astToolDefinitions = [
  {
    name: 'AstListSymbols',
    description: 'List indexed AST symbols for a repository.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['repository'],
      properties: {
        repository: { type: 'string' },
        kinds: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['symbols'],
      properties: {
        symbols: { type: 'array', items: symbolSchema },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'AstFindDefinition',
    description: 'Find a single AST symbol definition by id or name.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['repository'],
      properties: {
        repository: { type: 'string' },
        symbolId: { type: 'string' },
        name: { type: 'string' },
        kind: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['symbol'],
      properties: {
        symbol: {
          anyOf: [{ type: 'null' }, symbolSchema],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'AstFindReferences',
    description: 'Find AST references by symbol id or name.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['repository'],
      properties: {
        repository: { type: 'string' },
        symbolId: { type: 'string' },
        name: { type: 'string' },
        kind: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['references'],
      properties: {
        references: { type: 'array', items: referenceSchema },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'AstCallGraph',
    description: 'Return an AST call graph for a symbol.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['repository', 'symbolId'],
      properties: {
        repository: { type: 'string' },
        symbolId: { type: 'string' },
        depth: { type: 'integer', minimum: 1 },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['nodes', 'edges'],
      properties: {
        nodes: { type: 'array', items: symbolSchema },
        edges: { type: 'array', items: edgeSchema },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'AstModuleImports',
    description: 'List module imports captured for AST-indexed files.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['repository'],
      properties: {
        repository: { type: 'string' },
        relPath: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['modules'],
      properties: {
        modules: { type: 'array', items: moduleImportsSchema },
      },
      additionalProperties: false,
    },
  },
];

const toolDefinitions = [...baseToolDefinitions, ...astToolDefinitions];

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
    astListSymbols,
    validateAstListSymbols,
    astFindDefinition,
    validateAstFindDefinition,
    astFindReferences,
    validateAstFindReferences,
    astCallGraph,
    validateAstCallGraph,
    astModuleImports,
    validateAstModuleImports,
    getRootsCollection,
    getVectorsCollection,
    getLockedModel,
    ...deps,
  };

  const router = Router();

  const registrationContext = {
    event: 'DEV-0000032:T9:ast-mcp-tools-registered',
    toolCount: astToolDefinitions.length,
  };
  append({
    level: 'info',
    message: 'DEV-0000032:T9:ast-mcp-tools-registered',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: registrationContext,
  });
  baseLogger.info(registrationContext, 'AST MCP tools registered');

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

            if (toolCall.name === 'AstListSymbols') {
              const validated = resolved.validateAstListSymbols(
                args as Record<string, unknown>,
              );
              const payload = await resolved.astListSymbols(validated);
              baseLogger.info(
                {
                  requestId,
                  tool: toolCall.name,
                  repository: validated.repository,
                  symbols: payload.symbols.length,
                },
                'mcp tool call',
              );
              return jsonRpcResult(id as never, {
                content: [{ type: 'text', text: JSON.stringify(payload) }],
              }) as JsonRpcLikeResponse;
            }

            if (toolCall.name === 'AstFindDefinition') {
              const validated = resolved.validateAstFindDefinition(
                args as Record<string, unknown>,
              );
              const payload = await resolved.astFindDefinition(validated);
              baseLogger.info(
                {
                  requestId,
                  tool: toolCall.name,
                  repository: validated.repository,
                  symbolId: validated.symbolId,
                  name: validated.name,
                  found: Boolean(payload.symbol),
                },
                'mcp tool call',
              );
              return jsonRpcResult(id as never, {
                content: [{ type: 'text', text: JSON.stringify(payload) }],
              }) as JsonRpcLikeResponse;
            }

            if (toolCall.name === 'AstFindReferences') {
              const validated = resolved.validateAstFindReferences(
                args as Record<string, unknown>,
              );
              const payload = await resolved.astFindReferences(validated);
              baseLogger.info(
                {
                  requestId,
                  tool: toolCall.name,
                  repository: validated.repository,
                  symbolId: validated.symbolId,
                  name: validated.name,
                  references: payload.references.length,
                },
                'mcp tool call',
              );
              return jsonRpcResult(id as never, {
                content: [{ type: 'text', text: JSON.stringify(payload) }],
              }) as JsonRpcLikeResponse;
            }

            if (toolCall.name === 'AstCallGraph') {
              const validated = resolved.validateAstCallGraph(
                args as Record<string, unknown>,
              );
              const payload = await resolved.astCallGraph(validated);
              baseLogger.info(
                {
                  requestId,
                  tool: toolCall.name,
                  repository: validated.repository,
                  symbolId: validated.symbolId,
                  depth: validated.depth,
                  nodes: payload.nodes.length,
                  edges: payload.edges.length,
                },
                'mcp tool call',
              );
              return jsonRpcResult(id as never, {
                content: [{ type: 'text', text: JSON.stringify(payload) }],
              }) as JsonRpcLikeResponse;
            }

            if (toolCall.name === 'AstModuleImports') {
              const validated = resolved.validateAstModuleImports(
                args as Record<string, unknown>,
              );
              const payload = await resolved.astModuleImports(validated);
              baseLogger.info(
                {
                  requestId,
                  tool: toolCall.name,
                  repository: validated.repository,
                  modules: payload.modules.length,
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
            if (err instanceof AstIndexRequiredError) {
              return jsonRpcError(id as never, 409, err.code, {
                repository: err.repository,
              }) as JsonRpcLikeResponse;
            }
            if (err instanceof IngestRequiredError) {
              baseLogger.warn(
                { requestId, tool: toolCall.name },
                'mcp tool missing ingest',
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
