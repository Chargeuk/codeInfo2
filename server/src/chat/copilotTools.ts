import { defineTool, type Tool } from '@github/copilot-sdk';
import {
  listIngestedRepositories,
  validateVectorSearch,
  vectorSearch,
  type ToolDeps,
} from '../lmstudio/toolService.js';

export type CopilotToolBundle = {
  tools: Tool[];
  toolNames: string[];
};

export function createCopilotTools(
  deps: Partial<ToolDeps> = {},
): CopilotToolBundle {
  const listIngestedRepositoriesTool = defineTool('ListIngestedRepositories', {
    description:
      'List ingested repositories with container and host paths for citation and file access.',
    handler: async () => listIngestedRepositories(deps),
    skipPermission: true,
  }) as Tool;

  const vectorSearchTool = defineTool('VectorSearch', {
    description:
      'Search ingested chunks optionally scoped to a repository. Returns chunk text and file paths for citations.',
    parameters: {
      type: 'object',
      properties: {
        query: {},
        repository: {},
        limit: {},
      },
    },
    handler: async (params: {
      query?: unknown;
      repository?: unknown;
      limit?: unknown;
    }) => {
      const validated = validateVectorSearch(params ?? {});
      return vectorSearch(validated, deps);
    },
    skipPermission: true,
  }) as Tool;

  const tools: Tool[] = [listIngestedRepositoriesTool, vectorSearchTool];
  return {
    tools,
    toolNames: tools.map((tool) => tool.name),
  };
}
