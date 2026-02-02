import { z } from 'zod';

import {
  listAgents,
  listAgentCommands,
  runAgentCommand,
  runAgentInstruction,
} from '../agents/service.js';
import { append } from '../logStore.js';
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
export const LIST_COMMANDS_TOOL_NAME = 'list_commands';
export const RUN_AGENT_INSTRUCTION_TOOL_NAME = 'run_agent_instruction';
export const RUN_COMMAND_TOOL_NAME = 'run_command';

type AgentRunError =
  | { code: 'AGENT_NOT_FOUND' }
  | { code: 'CONVERSATION_ARCHIVED' }
  | { code: 'AGENT_MISMATCH' }
  | { code: 'RUN_IN_PROGRESS'; reason?: string }
  | { code: 'COMMAND_NOT_FOUND' }
  | { code: 'COMMAND_INVALID' }
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

const safeCommandNameSchema = z
  .string()
  .min(1)
  .refine((value) => {
    const name = value.trim();
    if (!name) return false;
    if (name.includes('/') || name.includes('\\')) return false;
    if (name.includes('..')) return false;
    return true;
  }, 'commandName must not contain path separators or ..');

const runCommandParamsSchema = z
  .object({
    agentName: z.string().min(1),
    commandName: safeCommandNameSchema,
    sourceId: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional(),
    working_folder: z.string().min(1).optional(),
  })
  .strict();

type RunCommandParams = z.infer<typeof runCommandParamsSchema>;

const listCommandsParamsSchema = z
  .object({
    agentName: z.string().min(1).optional(),
  })
  .strict();

type ListCommandsParams = z.infer<typeof listCommandsParamsSchema>;

type CallToolDeps = {
  listAgents: typeof listAgents;
  listAgentCommands: typeof listAgentCommands;
  runAgentInstruction: typeof runAgentInstruction;
  runAgentCommand: typeof runAgentCommand;
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

function listCommandsDefinition() {
  return {
    name: LIST_COMMANDS_TOOL_NAME,
    description:
      'List the available command macros for Codex agents. When agentName is omitted, returns commands for all agents.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agentName: {
          type: 'string',
          description: 'Optional agent folder name to list commands for.',
        },
      },
    },
  } as const;
}

function runAgentInstructionDefinition() {
  return {
    name: RUN_AGENT_INSTRUCTION_TOOL_NAME,
    description:
      'Run an instruction against a named Codex agent and return a final answer segment plus conversationId and modelId for continuation.',
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

function runCommandDefinition() {
  return {
    name: RUN_COMMAND_TOOL_NAME,
    description:
      'Run a named command macro for a Codex agent and return a minimal response including conversationId and modelId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentName', 'commandName'],
      properties: {
        agentName: {
          type: 'string',
          description: 'Agent folder name under CODEINFO_CODEX_AGENT_HOME.',
        },
        commandName: {
          type: 'string',
          description:
            'Command macro name (without .json) under <agent>/commands/.',
        },
        sourceId: {
          type: 'string',
          description:
            'Optional ingested repository container path when running a command discovered from an ingested repo (for example, /data/my-repo).',
        },
        conversationId: {
          type: 'string',
          description:
            'Optional conversation id to continue an existing agent conversation.',
        },
        working_folder: {
          type: 'string',
          description:
            'Optional absolute working folder to run the command from. When provided, the server may map host paths under HOST_INGEST_DIR into the Codex workdir and validates that the resolved directory exists.',
        },
      },
    },
  } as const;
}

export async function listTools(): Promise<ToolListResult> {
  return {
    tools: [
      listAgentsDefinition(),
      listCommandsDefinition(),
      runAgentInstructionDefinition(),
      runCommandDefinition(),
    ],
  };
}

async function runListAgents(deps: Partial<CallToolDeps>) {
  const resolvedListAgents = deps.listAgents ?? listAgents;
  const result = await resolvedListAgents();
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  } as const;
}

function validateListCommandsParams(params: unknown): ListCommandsParams {
  const parsed = listCommandsParamsSchema.safeParse(params ?? {});
  if (!parsed.success) {
    throw new InvalidParamsError('Invalid params', parsed.error.format());
  }
  return parsed.data;
}

async function runListCommands(params: unknown, deps: Partial<CallToolDeps>) {
  const parsed = validateListCommandsParams(params);

  const resolvedListAgents = deps.listAgents ?? listAgents;
  const resolvedListAgentCommands = deps.listAgentCommands ?? listAgentCommands;

  if (parsed.agentName) {
    try {
      const result = await resolvedListAgentCommands({
        agentName: parsed.agentName,
      });
      const commands = result.commands
        .filter((command) => !command.disabled)
        .map((command) => ({
          name: command.name,
          description: command.description,
          ...(command.sourceId && command.sourceLabel
            ? {
                sourceId: command.sourceId,
                sourceLabel: command.sourceLabel,
              }
            : {}),
        }));
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ agentName: parsed.agentName, commands }),
          },
        ],
      } as const;
    } catch (err) {
      if (isAgentRunError(err) && err.code === 'AGENT_NOT_FOUND') {
        throw new InvalidParamsError('Agent not found');
      }
      throw err;
    }
  }

  const agentsResult = await resolvedListAgents();
  const agents = await Promise.all(
    agentsResult.agents.map(async (agent) => {
      const result = await resolvedListAgentCommands({ agentName: agent.name });
      const commands = result.commands
        .filter((command) => !command.disabled)
        .map((command) => ({
          name: command.name,
          description: command.description,
          ...(command.sourceId && command.sourceLabel
            ? {
                sourceId: command.sourceId,
                sourceLabel: command.sourceLabel,
              }
            : {}),
        }));
      return { agentName: agent.name, commands };
    }),
  );

  return {
    content: [{ type: 'text', text: JSON.stringify({ agents }) }],
  } as const;
}

function validateRunParams(params: unknown): RunParams {
  const parsed = runParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidParamsError('Invalid params', parsed.error.format());
  }
  return parsed.data;
}

function validateRunCommandParams(params: unknown): RunCommandParams {
  const parsed = runCommandParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new InvalidParamsError('Invalid params', parsed.error.format());
  }
  return parsed.data;
}

async function runRunCommand(params: unknown, deps: Partial<CallToolDeps>) {
  const parsed = validateRunCommandParams(params);

  const resolvedRunAgentCommand = deps.runAgentCommand ?? runAgentCommand;

  try {
    const result = await resolvedRunAgentCommand({
      agentName: parsed.agentName,
      commandName: parsed.commandName,
      sourceId: parsed.sourceId,
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
      if (err.code === 'COMMAND_NOT_FOUND') {
        throw new InvalidParamsError('Command not found');
      }
      if (err.code === 'COMMAND_INVALID') {
        throw new InvalidParamsError('Invalid command');
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
    const answerOnly = result.segments.filter(
      (segment) => (segment as { type?: string }).type === 'answer',
    ) as Array<{ type: 'answer'; text: string }>;
    const segments: Array<{ type: 'answer'; text: string }> =
      answerOnly.length > 0 ? answerOnly : [{ type: 'answer', text: '' }];

    append({
      level: 'info',
      message: 'DEV-0000025:T2:agent_answer_only_filtered',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        conversationId: result.conversationId,
        modelId: result.modelId,
        segmentTypes: segments.map((segment) => segment.type),
      },
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ...result, segments }),
        },
      ],
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

  if (name === LIST_COMMANDS_TOOL_NAME) {
    return runListCommands(args, mergedDeps);
  }

  if (name === RUN_COMMAND_TOOL_NAME) {
    return runRunCommand(args, mergedDeps);
  }

  if (name === RUN_AGENT_INSTRUCTION_TOOL_NAME) {
    return runRunAgentInstruction(args, mergedDeps);
  }

  throw new ToolNotFoundError(name);
}
