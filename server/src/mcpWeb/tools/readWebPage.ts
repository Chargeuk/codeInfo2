import { isIP } from 'node:net';
import { z } from 'zod';
import { InvalidParamsError, ToolExecutionError } from '../../mcp2/errors.js';
import {
  readWebPage,
  type ReadWebPageParams,
  type ReadWebPageResult,
} from '../../webTools/toolService.js';

export const READ_WEB_PAGE_TOOL_NAME = 'read_web_page';

export type ReadWebPageToolDeps = {
  readWebPageImpl?: (params: ReadWebPageParams) => Promise<ReadWebPageResult>;
};

const httpUrlSchema = z.string().url().superRefine((value, ctx) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'URL must use http or https',
    });
  }

  if (parsed.username || parsed.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'URL must not include embedded credentials',
    });
  }
});

const readWebPageSchema = z.object({
  url: httpUrlSchema,
  mode: z.enum(['auto', 'http', 'playwright']).optional(),
  extractReadableContent: z.boolean().optional(),
  includeRawHtml: z.boolean().optional(),
  includeLinks: z.boolean().optional(),
  includeMetadata: z.boolean().optional(),
  maxChars: z.number().int().min(500).max(250_000).optional(),
  timeoutMs: z.number().int().min(1_000).max(60_000).optional(),
  likelyDynamic: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode !== 'playwright') {
    return;
  }

  try {
    const hostname = new URL(value.url).hostname;
    if (isIP(hostname) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message:
          'Playwright mode currently requires an IP-literal URL',
      });
    }
  } catch {
    // URL shape issues are already reported by the base url validator.
  }
});

export function readWebPageDefinition() {
  return {
    name: READ_WEB_PAGE_TOOL_NAME,
    description:
      'Read a web page, extract readable text and metadata, and use a browser fallback only when the runtime can safely render the target.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          pattern: '^https?://',
          description:
            'The http or https page URL to read. Embedded credentials are not allowed.',
        },
        mode: {
          type: 'string',
          enum: ['auto', 'http', 'playwright'],
          description:
            'Optional fetch mode. Defaults to auto, which starts with HTTP and escalates only when needed. Direct Playwright mode currently requires an IP-literal URL.',
        },
        extractReadableContent: {
          type: 'boolean',
          description:
            'Whether to prefer article-style readable extraction. Defaults to true.',
        },
        includeRawHtml: {
          type: 'boolean',
          description: 'Whether to include raw HTML in the result payload.',
        },
        includeLinks: {
          type: 'boolean',
          description: 'Whether to include extracted page links.',
        },
        includeMetadata: {
          type: 'boolean',
          description: 'Whether to include extracted metadata.',
        },
        maxChars: {
          type: 'integer',
          minimum: 500,
          maximum: 250000,
          description: 'Maximum returned text length. Defaults to 120000.',
        },
        timeoutMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 60000,
          description: 'Fetch timeout in milliseconds.',
        },
        likelyDynamic: {
          type: 'boolean',
          description:
            'Hint that the page is probably client-rendered and may need the browser fallback when the target can be rendered safely.',
        },
      },
    },
  } as const;
}

export async function runReadWebPageTool(
  args: unknown,
  deps: Partial<ReadWebPageToolDeps> = {},
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const parsed = readWebPageSchema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new InvalidParamsError(
      'Invalid read_web_page arguments',
      parsed.error.flatten(),
    );
  }

  try {
    const result = await (deps.readWebPageImpl ?? readWebPage)(parsed.data);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error) {
    throw new ToolExecutionError(
      -32002,
      'READ_WEB_PAGE_FAILED',
      error instanceof Error
        ? { message: error.message }
        : { message: String(error) },
    );
  }
}
