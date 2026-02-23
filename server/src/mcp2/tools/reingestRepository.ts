import { runReingestRepository } from '../../ingest/reingestService.js';
import { append } from '../../logStore.js';
import { InvalidParamsError } from '../errors.js';

export const REINGEST_REPOSITORY_TOOL_NAME = 'reingest_repository';

export type ReingestRepositoryDeps = {
  runReingestRepository?: typeof runReingestRepository;
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
      'Start a re-embed run for an already ingested repository root by sourceId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceId'],
      properties: {
        sourceId: {
          type: 'string',
          description:
            'Absolute normalized containerPath of an already ingested repository root',
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
  const result = await runReingest(args);

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
