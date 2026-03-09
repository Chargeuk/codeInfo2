import {
  ArchivedConversationError,
  InvalidParamsError,
  ProviderUnavailableError,
  ToolExecutionError,
  ToolNotFoundError,
} from './errors.js';
import {
  CODEBASE_QUESTION_TOOL_NAME,
  codebaseQuestionDefinition,
  runCodebaseQuestion,
  type CodebaseQuestionDeps,
} from './tools/codebaseQuestion.js';
import {
  REINGEST_REPOSITORY_TOOL_NAME,
  ReingestRepositoryToolError,
  reingestRepositoryDefinition,
  runReingestRepositoryTool,
  type ReingestRepositoryDeps,
} from './tools/reingestRepository.js';
import type { ToolDefinition } from './types.js';

export type ToolListResult = { tools: ToolDefinition[] };

export {
  InvalidParamsError,
  ToolNotFoundError,
  ArchivedConversationError,
  ProviderUnavailableError,
  ToolExecutionError,
  ReingestRepositoryToolError,
};

type CallToolDeps = CodebaseQuestionDeps & ReingestRepositoryDeps;

const defaultDeps: Partial<CallToolDeps> = {};

export function setToolDeps(overrides: Partial<CallToolDeps>) {
  Object.assign(defaultDeps, overrides);
}

export function resetToolDeps() {
  for (const key of Object.keys(defaultDeps)) {
    delete (defaultDeps as Record<string, unknown>)[key];
  }
}

export async function listTools(): Promise<ToolListResult> {
  return {
    tools: [codebaseQuestionDefinition(), reingestRepositoryDefinition()],
  };
}

export async function callTool(
  name: string,
  args?: unknown,
  deps?: Partial<CallToolDeps>,
) {
  if (name === CODEBASE_QUESTION_TOOL_NAME) {
    const mergedDeps = {
      ...defaultDeps,
      ...deps,
    } satisfies Partial<CallToolDeps>;
    return runCodebaseQuestion(args, mergedDeps);
  }

  if (name === REINGEST_REPOSITORY_TOOL_NAME) {
    const mergedDeps = {
      ...defaultDeps,
      ...deps,
    } satisfies Partial<CallToolDeps>;
    return runReingestRepositoryTool(args, mergedDeps);
  }

  throw new ToolNotFoundError(name);
}
