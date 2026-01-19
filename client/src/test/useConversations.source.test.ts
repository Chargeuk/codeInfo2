import { jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import { useConversations } from '../hooks/useConversations';

const originalFetch = global.fetch;

describe('useConversations source metadata', () => {
  beforeEach(() => {
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              conversationId: 'c1',
              title: 'Rest convo',
              provider: 'lmstudio',
              model: 'llama',
              lastMessageAt: '2025-01-01T00:00:00.000Z',
            },
            {
              conversationId: 'c2',
              title: 'MCP convo',
              provider: 'codex',
              model: 'gpt',
              source: 'MCP',
              lastMessageAt: '2025-01-02T00:00:00.000Z',
            },
          ],
        }),
      } as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('defaults missing source to REST and preserves MCP', async () => {
    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.conversations.length).toBe(2));

    const restItem = result.current.conversations.find(
      (c) => c.conversationId === 'c1',
    );
    const mcpItem = result.current.conversations.find(
      (c) => c.conversationId === 'c2',
    );

    expect(restItem?.source).toBe('REST');
    expect(mcpItem?.source).toBe('MCP');
  });

  it('includes agentName when provided', async () => {
    const { result } = renderHook(() =>
      useConversations({ agentName: '__none__' }),
    );

    await waitFor(() => expect(result.current.conversations.length).toBe(2));

    const fetchCalls = (global as typeof globalThis & { fetch: jest.Mock })
      .fetch.mock.calls;
    const conversationCall = fetchCalls.find((call) =>
      String(call[0]).includes('/conversations?'),
    );
    const firstUrl =
      conversationCall?.[0]?.toString?.() ?? String(conversationCall?.[0]);
    expect(firstUrl).toContain('agentName=__none__');
  });

  it('includes flowName when provided', async () => {
    const { result } = renderHook(() =>
      useConversations({ agentName: '__none__', flowName: '__none__' }),
    );

    await waitFor(() => expect(result.current.conversations.length).toBe(2));

    const fetchCalls = (global as typeof globalThis & { fetch: jest.Mock })
      .fetch.mock.calls;
    const conversationCall = fetchCalls.find((call) =>
      String(call[0]).includes('/conversations?'),
    );
    const firstUrl =
      conversationCall?.[0]?.toString?.() ?? String(conversationCall?.[0]);
    expect(firstUrl).toContain('flowName=__none__');
  });
});
