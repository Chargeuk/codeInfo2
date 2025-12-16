import { z } from 'zod';

import { listAgents, runAgentInstruction } from '../agents/service.js';
import {
  ArchivedConversationError,
  InvalidParamsError,
  RunInProgressError,
  ToolNotFoundError,
} from '../mcp2/errors.js';

import { CodexUnavailableError } from './errors.js';
import type { ToolDefinition } from './types.js';

export type ToolListResult = { tools: ToolDefinition[] };

export {
  InvalidParamsError,
  ToolNotFoundError,
  ArchivedConversationError,
  RunInProgressError,
};

export const LIST_AGENTS_TOOL_NAME = 'list_agents';
export const RUN_AGENT_INSTRUCTION_TOOL_NAME = 'run_agent_instruction';

type AgentRunError =
  | { code: 'AGENT_NOT_FOUND' }
  | { code: 'CONVERSATION_ARCHIVED' }
  | { code: 'AGENT_MISMATCH' }
  | { code: 'RUN_IN_PROGRESS'; reason?: string }
  | { code: 'WORKING_FOLDER_INVALID'; reason?: string }
  | { code: 'WORKING_FOLDER_NOT_FOUND'; reason?: string }
  | { code: 'CODEX_UNAVAILABLE'; reason?: string };

const isAgentRunError = (err: unknown): err is AgentRunError =>
  Boolean(err) &&
  typeof err === 'object' &&
  typeof (err as { code?: unknown }).code === 'string';

const runParamsSchema = z
  .object({
    agentName: z.string().min(1),
    instruction: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    working_folder: z.string().min(1).optional(),
  })
  .strict();

type RunParams = z.infer<typeof runParamsSchema>;

type CallToolDeps = {
  listAgents: typeof listAgents;
  runAgentInstruction: typeof runAgentInstruction;
  signal?: AbortSignal;
};

const defaultDeps: Partial<CallToolDeps> = {};

export function setToolDeps(overrides: Partial<CallToolDeps>) {
  Object.assign(defaultDeps, overrides);
}

export function resetToolDeps() {
  for (const key of Object.keys(defaultDeps)) {
    delete (defaultDeps as Record<string, unknown>)[key];
  }
}

function listAgentsDefinition() {
  return {
    name: LIST_AGENTS_TOOL_NAME,
    description:
      'List the available Codex agents discovered under CODEINFO_CODEX_AGENT_HOME. Returns agent names plus optional descriptions and warnings.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  } as const;
}

function runAgentInstructionDefinition() {
  return {
    name: RUN_AGENT_INSTRUCTION_TOOL_NAME,
    description:
      'Run an instruction against a named Codex agent and return ordered thinking/vector summaries/answer segments plus a conversationId for continuation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentName', 'instruction'],
      properties: {
        agentName: {
          type: 'string',
          description: 'Agent folder name under CODEINFO_CODEX_AGENT_HOME.',
        },
        instruction: {
          type: 'string',
          description: 'User instruction to run against the selected agent.',
        },
        conversationId: {
          type: 'string',
          description:
            'Optional conversation id to continue an existing agent conversation.',
        },
        working_folder: {
          type: 'string',
          description:
            'Optional absolute working folder to run the agent instruction from. When provided, the server may map host paths under HOST_INGEST_DIR into the Codex workdir and validates that the resolved directory exists.',
        },
      },
    },
  } as const;
}

export async function listTools(): Promise<ToolListResult> {
  return { tools: [listAgentsDefinition(), runAgentInstructionDefinition()] };
}

async function runListAgents(deps: Partial<CallToolDeps>) {
  const resolvedListAgents = deps.listAgents ?? listAgents;
  const result = await resolvedListAgents();
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  } as const;
}

function validateRunParams(params: unknown): RunParams {
  const parsed = runParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidParamsError('Invalid params', parsed.error.format());
  }
  return parsed.data;
}

async function runRunAgentInstruction(
  params: unknown,
  deps: Partial<CallToolDeps>,
) {
  const parsed = validateRunParams(params);

  const resolvedRunAgentInstruction =
    deps.runAgentInstruction ?? runAgentInstruction;

  try {
    const result = await resolvedRunAgentInstruction({
      agentName: parsed.agentName,
      instruction: parsed.instruction,
      conversationId: parsed.conversationId,
      working_folder: parsed.working_folder,
      signal: deps.signal,
      source: 'MCP',
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    } as const;
  } catch (err) {
    if (isAgentRunError(err)) {
      if (err.code === 'CONVERSATION_ARCHIVED') {
        throw new ArchivedConversationError(
          'Conversation is archived and must be restored before use',
        );
      }
      if (err.code === 'CODEX_UNAVAILABLE') {
        throw new CodexUnavailableError(err.reason);
      }
      if (err.code === 'AGENT_MISMATCH') {
        throw new InvalidParamsError(
          'Conversation belongs to a different agent',
        );
      }
      if (err.code === 'AGENT_NOT_FOUND') {
        throw new InvalidParamsError('Agent not found');
      }
      if (err.code === 'RUN_IN_PROGRESS') {
        throw new RunInProgressError('RUN_IN_PROGRESS', {
          code: 'RUN_IN_PROGRESS',
          message:
            err.reason ?? 'A run is already in progress for this conversation.',
        });
      }
      if (err.code === 'WORKING_FOLDER_INVALID') {
        throw new InvalidParamsError(err.reason ?? 'Invalid working_folder');
      }
      if (err.code === 'WORKING_FOLDER_NOT_FOUND') {
        throw new InvalidParamsError(
          err.reason ?? 'working_folder directory not found',
        );
      }
    }
    throw err;
  }
}

export async function callTool(
  name: string,
  args?: unknown,
  deps?: Partial<CallToolDeps>,
) {
  const mergedDeps = {
    ...defaultDeps,
    ...deps,
  } satisfies Partial<CallToolDeps>;

  if (name === LIST_AGENTS_TOOL_NAME) {
    return runListAgents(mergedDeps);
  }

  if (name === RUN_AGENT_INSTRUCTION_TOOL_NAME) {
    return runRunAgentInstruction(args, mergedDeps);
  }

  throw new ToolNotFoundError(name);
}
