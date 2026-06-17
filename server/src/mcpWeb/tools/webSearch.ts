import { z } from 'zod';
import { InvalidParamsError, ToolExecutionError } from '../../mcp2/errors.js';
import {
  webSearch,
  type WebSearchResult,
  type WebSearchParams,
} from '../../webTools/toolService.js';

export const WEB_SEARCH_TOOL_NAME = 'web_search';

export type WebSearchToolDeps = {
  webSearchImpl?: (params: WebSearchParams) => Promise<WebSearchResult>;
};

const webSearchSchema = z.object({
  query: z.string().trim().min(1),
  maxResults: z.number().int().min(1).max(10).optional(),
  safeSearch: z.enum(['strict', 'moderate', 'off']).optional(),
  region: z.string().trim().min(1).max(24).optional(),
  locale: z.string().trim().min(1).max(24).optional(),
});

export function webSearchDefinition() {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      'Search the public web and return titles, URLs, snippets, and result metadata.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'The web search query to run.',
        },
        maxResults: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description: 'Optional maximum result count. Defaults to 5.',
        },
        safeSearch: {
          type: 'string',
          enum: ['strict', 'moderate', 'off'],
          description: 'Optional safe search mode. Defaults to moderate.',
        },
        region: {
          type: 'string',
          description:
            'Optional DuckDuckGo region hint such as wt-wt or uk-en.',
        },
        locale: {
          type: 'string',
          description: 'Optional locale hint such as en-us.',
        },
      },
    },
  } as const;
}

export async function runWebSearchTool(
  args: unknown,
  deps: Partial<WebSearchToolDeps> = {},
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const parsed = webSearchSchema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new InvalidParamsError(
      'Invalid web_search arguments',
      parsed.error.flatten(),
    );
  }

  try {
    const result = await (deps.webSearchImpl ?? webSearch)(parsed.data);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error) {
    throw new ToolExecutionError(
      -32002,
      'WEB_SEARCH_FAILED',
      error instanceof Error
        ? { message: error.message }
        : { message: String(error) },
    );
  }
}
