type ConversationsApiErrorDetails = {
  error?: string;
  message?: string;
  missingIds?: string[];
  activeIds?: string[];
};

export class ConversationsApiError extends Error {
  status: number;
  error?: string;
  missingIds?: string[];
  activeIds?: string[];

  constructor(params: {
    status: number;
    message: string;
    error?: string;
    missingIds?: string[];
    activeIds?: string[];
  }) {
    super(params.message);
    this.status = params.status;
    this.error = params.error;
    this.missingIds = params.missingIds;
    this.activeIds = params.activeIds;
  }
}

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

async function parseErrorDetails(
  res: Response,
): Promise<ConversationsApiErrorDetails> {
  const contentType =
    typeof res.headers?.get === 'function'
      ? res.headers.get('content-type')
      : null;

  if (contentType && contentType.includes('application/json')) {
    try {
      const data = (await res.json()) as unknown;
      if (data && typeof data === 'object') {
        const record = data as Record<string, unknown>;
        return {
          error: typeof record.error === 'string' ? record.error : undefined,
          message:
            typeof record.message === 'string' ? record.message : undefined,
          missingIds: Array.isArray(record.missingIds)
            ? (record.missingIds.filter(
                (v) => typeof v === 'string',
              ) as string[])
            : undefined,
          activeIds: Array.isArray(record.activeIds)
            ? (record.activeIds.filter(
                (v) => typeof v === 'string',
              ) as string[])
            : undefined,
        };
      }
    } catch {
      // ignore
    }
  }

  return {};
}

async function throwApiError(
  res: Response,
  baseMessage: string,
): Promise<never> {
  const details = await parseErrorDetails(res);
  const extra = details.message ? `: ${details.message}` : '';
  throw new ConversationsApiError({
    status: res.status,
    error: details.error,
    missingIds: details.missingIds,
    activeIds: details.activeIds,
    message: `${baseMessage} (${res.status})${extra}`,
  });
}

export async function archiveConversation(params: {
  conversationId: string;
}): Promise<void> {
  const res = await fetch(
    new URL(
      `/conversations/${encodeURIComponent(params.conversationId)}/archive`,
      serverBase,
    ).toString(),
    { method: 'POST' },
  );
  if (!res.ok) {
    await throwApiError(res, 'Failed to archive conversation');
  }
}

export async function restoreConversation(params: {
  conversationId: string;
}): Promise<void> {
  const res = await fetch(
    new URL(
      `/conversations/${encodeURIComponent(params.conversationId)}/restore`,
      serverBase,
    ).toString(),
    { method: 'POST' },
  );
  if (!res.ok) {
    await throwApiError(res, 'Failed to restore conversation');
  }
}

export async function bulkArchiveConversations(params: {
  conversationIds: string[];
}): Promise<void> {
  const res = await fetch(
    new URL('/conversations/bulk/archive', serverBase).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationIds: params.conversationIds }),
    },
  );
  if (!res.ok) {
    await throwApiError(res, 'Failed to bulk archive conversations');
  }
}

export async function bulkRestoreConversations(params: {
  conversationIds: string[];
}): Promise<void> {
  const res = await fetch(
    new URL('/conversations/bulk/restore', serverBase).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationIds: params.conversationIds }),
    },
  );
  if (!res.ok) {
    await throwApiError(res, 'Failed to bulk restore conversations');
  }
}

export async function bulkDeleteConversations(params: {
  conversationIds: string[];
}): Promise<void> {
  const res = await fetch(
    new URL('/conversations/bulk/delete', serverBase).toString(),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationIds: params.conversationIds }),
    },
  );
  if (!res.ok) {
    await throwApiError(res, 'Failed to bulk delete conversations');
  }
}
