import { runReingestRepository } from '../../ingest/reingestService.js';
import { listIngestedRepositories } from '../../lmstudio/toolService.js';
import { append } from '../../logStore.js';
import { resolveRepositorySelector } from '../../mcpCommon/repositorySelector.js';
import { InvalidParamsError } from '../errors.js';

export const REINGEST_REPOSITORY_TOOL_NAME = 'reingest_repository';

export type ReingestRepositoryDeps = {
  runReingestRepository?: typeof runReingestRepository;
  listIngestedRepositories?: typeof listIngestedRepositories;
};

export class ReingestRepositoryToolError extends Error {
  code: number;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ReingestRepositoryToolError';
    this.code = code;
    this.data = data;
  }
}

export function reingestRepositoryDefinition() {
  return {
    name: REINGEST_REPOSITORY_TOOL_NAME,
    description:
      'Run a blocking re-embed for an already ingested repository root by sourceId and return a terminal summary payload.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceId'],
      properties: {
        sourceId: {
          type: 'string',
          description:
            'Repository selector for the ingested root. Supports repository id (case-insensitive), mounted container path, or host path; MCP canonicalizes to the normalized container path before execution.',
        },
      },
    },
  } as const;
}

export async function runReingestRepositoryTool(
  args: unknown,
  deps: Partial<ReingestRepositoryDeps> = {},
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  append({
    level: 'info',
    source: 'server',
    timestamp: new Date().toISOString(),
    message: 'DEV-0000035:T7:mcp2_reingest_tool_call_evaluated',
    context: {
      tool: REINGEST_REPOSITORY_TOOL_NAME,
      args,
    },
  });

  const runReingest = deps.runReingestRepository ?? runReingestRepository;
  let resolvedArgs = args;
  if (
    args &&
    typeof args === 'object' &&
    !Array.isArray(args) &&
    typeof (args as { sourceId?: unknown }).sourceId === 'string'
  ) {
    try {
      const repo = await resolveRepositorySelector(
        (args as { sourceId: string }).sourceId,
        {
          listIngestedRepositories:
            deps.listIngestedRepositories ?? listIngestedRepositories,
        },
      );
      if (repo) {
        resolvedArgs = {
          ...(args as Record<string, unknown>),
          sourceId: repo.containerPath,
        };
      }
    } catch {
      resolvedArgs = args;
    }
  }

  const result = await runReingest(resolvedArgs);

  if (!result.ok) {
    if (result.error.code === -32602) {
      throw new InvalidParamsError(result.error.message, result.error.data);
    }

    throw new ReingestRepositoryToolError(
      result.error.code,
      result.error.message,
      result.error.data,
    );
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result.value) }],
  };
}
