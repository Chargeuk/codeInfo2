import { tool } from '@lmstudio/sdk';
import type { ToolCallContext } from '@lmstudio/sdk';
import { z } from 'zod';
import { baseLogger } from '../logger.js';
import {
  RepoNotFoundError,
  ValidationError,
  listIngestedRepositories,
  validateVectorSearch,
  vectorSearch,
  type ListReposResult,
  type ToolDeps,
  type VectorSearchResult,
} from './toolService.js';

export type ToolFactoryOptions = {
  deps?: Partial<ToolDeps>;
  log?: (payload: Record<string, unknown>) => void;
};

export function createLmStudioTools(options: ToolFactoryOptions = {}) {
  const { deps = {}, log } = options;

  const listIngestedRepositoriesTool = tool({
    name: 'ListIngestedRepositories',
    description:
      'List ingested repositories with container and host paths for citation and file access.',
    parameters: {},
    implementation: async (
      _params: Record<string, never>,
      _ctx: ToolCallContext,
    ): Promise<ListReposResult> => {
      baseLogger.info(
        { tool: 'ListIngestedRepositories', params: _params },
        'lmstudio tool start',
      );
      void _params;
      void _ctx;
      const result = await listIngestedRepositories(deps);
      log?.({
        tool: 'ListIngestedRepositories',
        repos: result.repos.length,
        lockedModelId: result.lockedModelId,
      });
      return result;
    },
  });

  const vectorSearchTool = tool({
    name: 'VectorSearch',
    description:
      'Search ingested chunks optionally scoped to a repository. Returns chunk text and file paths for citations.',
    // Broad schema so SDK accepts the call; we validate manually inside the implementation.
    parameters: {
      query: z.any(),
      repository: z.any().optional(),
      limit: z.any().optional(),
    },
    implementation: async (
      params: {
        query?: unknown;
        repository?: unknown;
        limit?: unknown;
      },
      _ctx: ToolCallContext,
    ): Promise<VectorSearchResult> => {
      baseLogger.info({ tool: 'VectorSearch', params }, 'lmstudio tool start');
      void _ctx;
      try {
        const validated = validateVectorSearch(params ?? {});
        baseLogger.info(
          { tool: 'VectorSearch', params: validated },
          'lmstudio validated Params',
        );
        const result = await vectorSearch(validated, deps);
        log?.({
          tool: 'VectorSearch',
          repository: validated.repository ?? 'all',
          limit: validated.limit,
          results: result.results.length,
          modelId: result.modelId,
        });
        return result;
      } catch (err) {
        if (err instanceof ValidationError) {
          throw new Error(err.details.join(', '));
        }
        if (err instanceof RepoNotFoundError) {
          throw new Error('REPO_NOT_FOUND');
        }
        throw err;
      }
    },
  });

  return {
    listIngestedRepositoriesTool,
    vectorSearchTool,
    tools: [listIngestedRepositoriesTool, vectorSearchTool],
  } as const;
}
