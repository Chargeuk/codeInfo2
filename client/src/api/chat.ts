const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

async function throwApiError(
  res: Response,
  baseMessage: string,
): Promise<never> {
  let extra = '';
  try {
    const contentType =
      typeof res.headers?.get === 'function'
        ? res.headers.get('content-type')
        : null;
    if (contentType && contentType.includes('application/json')) {
      const data = (await res.json()) as unknown;
      if (data && typeof data === 'object') {
        const record = data as Record<string, unknown>;
        if (typeof record.message === 'string' && record.message) {
          extra = `: ${record.message}`;
        }
      }
    }
  } catch {
    // ignore
  }
  throw new Error(`${baseMessage} (${res.status})${extra}`);
}

export async function cancelChatInflight(params: {
  conversationId: string;
  inflightId: string;
}): Promise<void> {
  const res = await fetch(new URL('/chat/cancel', serverBase).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      conversationId: params.conversationId,
      inflightId: params.inflightId,
    }),
  });

  if (!res.ok) {
    await throwApiError(res, 'Failed to cancel in-flight chat');
  }
}
