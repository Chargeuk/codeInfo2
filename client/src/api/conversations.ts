import { getApiBaseUrl } from './baseUrl';

const serverBase = getApiBaseUrl();

export type ConversationApiSummary = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  source?: 'REST' | 'MCP';
  lastMessageAt?: string;
  archived?: boolean;
  flags?: Record<string, unknown>;
  agentName?: string;
  flowName?: string;
};

export type ConversationsApiErrorDetails = {
  status: number;
  code?: string;
  message: string;
};

export class ConversationsApiError extends Error {
  status: number;
  code?: string;

  constructor(details: ConversationsApiErrorDetails) {
    super(details.message);
    this.name = 'ConversationsApiError';
    this.status = details.status;
    this.code = details.code;
  }
}

function isJsonContentType(contentType: string | null | undefined) {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('application/json') || normalized.includes('+json')
  );
}

async function parseConversationsApiErrorResponse(res: Response): Promise<{
  code?: string;
  message?: string;
  text?: string;
}> {
  const contentType =
    typeof res.headers?.get === 'function'
      ? res.headers.get('content-type')
      : null;

  if (isJsonContentType(contentType)) {
    try {
      const data = (await res.json()) as unknown;
      if (data && typeof data === 'object') {
        const record = data as Record<string, unknown>;
        return {
          code: typeof record.code === 'string' ? record.code : undefined,
          message:
            typeof record.message === 'string' ? record.message : undefined,
        };
      }
      return {};
    } catch {
      return {};
    }
  }

  const text = await res.text().catch(() => '');
  return { text: text || undefined };
}

async function throwConversationsApiError(
  res: Response,
  baseMessage: string,
): Promise<never> {
  const parsed = await parseConversationsApiErrorResponse(res);
  const message =
    parsed.message ?? `${baseMessage}${parsed.text ? `: ${parsed.text}` : ''}`;
  throw new ConversationsApiError({
    status: res.status,
    code: parsed.code,
    message,
  });
}

function parseConversationSummary(data: unknown): ConversationApiSummary {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid conversation response');
  }

  const record = data as Record<string, unknown>;
  const conversationId =
    typeof record.conversationId === 'string' ? record.conversationId : '';
  const title = typeof record.title === 'string' ? record.title : '';
  const provider = typeof record.provider === 'string' ? record.provider : '';
  const model = typeof record.model === 'string' ? record.model : '';

  if (!conversationId || !title || !provider || !model) {
    throw new Error('Invalid conversation response');
  }

  return {
    conversationId,
    title,
    provider,
    model,
    source: record.source === 'MCP' ? 'MCP' : 'REST',
    lastMessageAt:
      typeof record.lastMessageAt === 'string'
        ? record.lastMessageAt
        : undefined,
    archived:
      typeof record.archived === 'boolean' ? record.archived : undefined,
    flags:
      record.flags && typeof record.flags === 'object'
        ? (record.flags as Record<string, unknown>)
        : {},
    agentName:
      typeof record.agentName === 'string' ? record.agentName : undefined,
    flowName: typeof record.flowName === 'string' ? record.flowName : undefined,
  };
}

export async function updateConversationWorkingFolder(params: {
  conversationId: string;
  workingFolder: string | null;
}): Promise<{ conversation: ConversationApiSummary }> {
  const trimmedConversationId = params.conversationId.trim();
  if (!trimmedConversationId) {
    throw new Error('conversationId is required');
  }

  if (params.workingFolder === undefined) {
    throw new Error('workingFolder must be a non-empty string or null');
  }

  const trimmedWorkingFolder =
    typeof params.workingFolder === 'string' ? params.workingFolder.trim() : '';
  if (params.workingFolder !== null && trimmedWorkingFolder.length === 0) {
    throw new Error('workingFolder must be a non-empty string or null');
  }

  const res = await fetch(
    new URL(
      `/conversations/${encodeURIComponent(trimmedConversationId)}/working-folder`,
      serverBase,
    ).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workingFolder:
          params.workingFolder === null ? null : trimmedWorkingFolder,
      }),
    },
  );

  if (!res.ok) {
    await throwConversationsApiError(
      res,
      `Failed to update working folder (${res.status})`,
    );
  }

  const payload = (await res.json()) as Record<string, unknown>;
  return {
    conversation: parseConversationSummary(payload.conversation),
  };
}
