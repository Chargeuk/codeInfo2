import {
  InvalidParamsError,
  ProviderUnavailableError,
  ToolExecutionError,
  ToolNotFoundError,
} from '../mcp2/errors.js';
import type { ToolDefinition } from '../mcp2/types.js';
import {
  READ_WEB_PAGE_TOOL_NAME,
  readWebPageDefinition,
  runReadWebPageTool,
  type ReadWebPageToolDeps,
} from './tools/readWebPage.js';
import {
  WEB_SEARCH_TOOL_NAME,
  webSearchDefinition,
  runWebSearchTool,
  type WebSearchToolDeps,
} from './tools/webSearch.js';

export type ToolListResult = { tools: ToolDefinition[] };

export {
  InvalidParamsError,
  ProviderUnavailableError,
  ToolExecutionError,
  ToolNotFoundError,
};

type WebToolDeps = ReadWebPageToolDeps & WebSearchToolDeps;

const defaultDeps: Partial<WebToolDeps> = {};

export function setWebToolDeps(overrides: Partial<WebToolDeps>) {
  Object.assign(defaultDeps, overrides);
}

export function resetWebToolDeps() {
  for (const key of Object.keys(defaultDeps)) {
    delete (defaultDeps as Record<string, unknown>)[key];
  }
}

export async function listWebTools(): Promise<ToolListResult> {
  return {
    tools: [webSearchDefinition(), readWebPageDefinition()],
  };
}

export async function callWebTool(
  name: string,
  args?: unknown,
  deps?: Partial<WebToolDeps>,
) {
  const mergedDeps = {
    ...defaultDeps,
    ...deps,
  } satisfies Partial<WebToolDeps>;

  if (name === WEB_SEARCH_TOOL_NAME) {
    return runWebSearchTool(args, mergedDeps);
  }

  if (name === READ_WEB_PAGE_TOOL_NAME) {
    return runReadWebPageTool(args, mergedDeps);
  }

  throw new ToolNotFoundError(name);
}
