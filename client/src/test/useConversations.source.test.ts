import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversations } from '../hooks/useConversations';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const originalFetch = global.fetch;
const mockFetch = getFetchMock();

describe('useConversations source metadata', () => {
  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      mockJsonResponse({
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
    );
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

  it('surfaces malformed present source values as a fetch error instead of normalizing them to REST', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        items: [
          {
            conversationId: 'c1',
            title: 'Broken convo',
            provider: 'lmstudio',
            model: 'llama',
            source: 'BROKEN',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe('Invalid conversation response');
    expect(result.current.conversations).toEqual([]);
  });

  it('surfaces malformed present flags values as a fetch error instead of normalizing them to an empty object', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        items: [
          {
            conversationId: 'c1',
            title: 'Broken convo',
            provider: 'lmstudio',
            model: 'llama',
            flags: ['not-an-object'],
            lastMessageAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe('Invalid conversation response');
    expect(result.current.conversations).toEqual([]);
  });

  it('includes agentName when provided', async () => {
    const { result } = renderHook(() =>
      useConversations({ agentName: '__none__' }),
    );

    await waitFor(() => expect(result.current.conversations.length).toBe(2));

    const fetchCalls = mockFetch.mock.calls;
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

    const fetchCalls = mockFetch.mock.calls;
    const conversationCall = fetchCalls.find((call) =>
      String(call[0]).includes('/conversations?'),
    );
    const firstUrl =
      conversationCall?.[0]?.toString?.() ?? String(conversationCall?.[0]);
    expect(firstUrl).toContain('flowName=__none__');
  });

  it('filters fetched conversations by agentName locally', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        items: [
          {
            conversationId: 'c1',
            title: 'Planner convo',
            provider: 'codex',
            model: 'gpt',
            agentName: 'planner',
            lastMessageAt: '2025-01-02T00:00:00.000Z',
          },
          {
            conversationId: 'c2',
            title: 'Reviewer convo',
            provider: 'codex',
            model: 'gpt',
            agentName: 'reviewer',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const { result } = renderHook(() =>
      useConversations({ agentName: 'planner' }),
    );

    await waitFor(() => expect(result.current.conversations.length).toBe(1));

    expect(result.current.conversations[0]?.conversationId).toBe('c1');
    expect(result.current.conversations[0]?.agentName).toBe('planner');
  });

  it('filters websocket upserts that do not match the active agentName', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        items: [
          {
            conversationId: 'c1',
            title: 'Planner convo',
            provider: 'codex',
            model: 'gpt',
            agentName: 'planner',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const { result } = renderHook(() =>
      useConversations({ agentName: 'planner' }),
    );

    await waitFor(() => expect(result.current.conversations.length).toBe(1));

    act(() => {
      result.current.applyWsUpsert({
        conversationId: 'c2',
        title: 'Reviewer convo',
        provider: 'codex',
        model: 'gpt',
        agentName: 'reviewer',
        lastMessageAt: '2025-01-03T00:00:00.000Z',
      });
    });

    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.conversations[0]?.conversationId).toBe('c1');
  });

  it('keeps the __none__ agent filter authoritative during websocket upserts', async () => {
    const { result } = renderHook(() =>
      useConversations({ agentName: '__none__' }),
    );

    await waitFor(() => expect(result.current.conversations.length).toBe(2));

    act(() => {
      result.current.applyWsUpsert({
        conversationId: 'c3',
        title: 'Agent convo',
        provider: 'codex',
        model: 'gpt',
        agentName: 'planner',
        lastMessageAt: '2025-01-03T00:00:00.000Z',
      });
    });

    expect(result.current.conversations).toHaveLength(2);
    expect(
      result.current.conversations.some((item) => item.conversationId === 'c3'),
    ).toBe(false);
  });

  it('applies websocket upserts that restore flags.workingFolder', async () => {
    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.conversations.length).toBe(2));

    act(() => {
      result.current.applyWsUpsert({
        conversationId: 'c1',
        title: 'Rest convo',
        provider: 'lmstudio',
        model: 'llama',
        lastMessageAt: '2025-01-03T00:00:00.000Z',
        flags: { workingFolder: '/repos/demo' },
      });
    });

    const updated = result.current.conversations.find(
      (item) => item.conversationId === 'c1',
    );
    expect(result.current.readWorkingFolder(updated)).toBe('/repos/demo');
  });

  it('applies websocket upserts that clear flags.workingFolder', async () => {
    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.conversations.length).toBe(2));

    act(() => {
      result.current.applyWsUpsert({
        conversationId: 'c1',
        title: 'Rest convo',
        provider: 'lmstudio',
        model: 'llama',
        lastMessageAt: '2025-01-03T00:00:00.000Z',
        flags: { workingFolder: '/repos/demo' },
      });
    });

    act(() => {
      result.current.applyWsUpsert({
        conversationId: 'c1',
        title: 'Rest convo',
        provider: 'lmstudio',
        model: 'llama',
        lastMessageAt: '2025-01-04T00:00:00.000Z',
        flags: {},
      });
    });

    const updated = result.current.conversations.find(
      (item) => item.conversationId === 'c1',
    );
    expect(result.current.readWorkingFolder(updated)).toBeUndefined();
  });

  it('clears stale flowName and agentName when a websocket upsert omits them', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        items: [
          {
            conversationId: 'c1',
            title: 'Flow convo',
            provider: 'codex',
            model: 'gpt',
            source: 'REST',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            flowName: 'daily',
            agentName: 'planner',
          },
        ],
      }),
    );

    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.conversations.length).toBe(1));

    act(() => {
      result.current.applyWsUpsert({
        conversationId: 'c1',
        title: 'Flow convo updated',
        provider: 'codex',
        model: 'gpt',
        source: 'REST',
        lastMessageAt: '2025-01-02T00:00:00.000Z',
      });
    });

    const updated = result.current.conversations.find(
      (item) => item.conversationId === 'c1',
    );
    expect(updated?.flowName).toBeUndefined();
    expect(updated?.agentName).toBeUndefined();
  });

  it('clears stale flowName and agentName when a working-folder refresh omits them', async () => {
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (
          target.includes('/conversations/c1/working-folder') &&
          init?.method === 'POST'
        ) {
          return Promise.resolve(
            mockJsonResponse({
              conversation: {
                conversationId: 'c1',
                title: 'Flow convo updated',
                provider: 'codex',
                model: 'gpt',
                source: 'REST',
                lastMessageAt: '2025-01-02T00:00:00.000Z',
                flags: { workingFolder: '/repos/demo' },
              },
            }),
          );
        }

        return Promise.resolve(
          mockJsonResponse({
            items: [
              {
                conversationId: 'c1',
                title: 'Flow convo',
                provider: 'codex',
                model: 'gpt',
                source: 'REST',
                lastMessageAt: '2025-01-01T00:00:00.000Z',
                flowName: 'daily',
                agentName: 'planner',
              },
            ],
          }),
        );
      },
    );

    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.conversations.length).toBe(1));

    await act(async () => {
      await result.current.updateWorkingFolder({
        conversationId: 'c1',
        workingFolder: '/repos/demo',
        surface: 'flows',
      });
    });

    const updated = result.current.conversations.find(
      (item) => item.conversationId === 'c1',
    );
    expect(updated?.flowName).toBeUndefined();
    expect(updated?.agentName).toBeUndefined();
    expect(result.current.readWorkingFolder(updated)).toBe('/repos/demo');
  });

  it('ignores websocket upserts with malformed present source values instead of relabeling them as REST', async () => {
    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.conversations.length).toBe(2));

    const before = result.current.conversations.find(
      (item) => item.conversationId === 'c1',
    );

    act(() => {
      result.current.applyWsUpsert({
        conversationId: 'c1',
        title: 'Rest convo',
        provider: 'lmstudio',
        model: 'llama',
        source: 'BROKEN',
        lastMessageAt: '2025-01-05T00:00:00.000Z',
      });
    });

    const after = result.current.conversations.find(
      (item) => item.conversationId === 'c1',
    );
    expect(after).toEqual(before);
    expect(result.current.conversations).toHaveLength(2);
  });

  it('ignores websocket upserts with malformed present flags values instead of flattening them into object state', async () => {
    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.conversations.length).toBe(2));

    act(() => {
      result.current.applyWsUpsert({
        conversationId: 'c1',
        title: 'Rest convo',
        provider: 'lmstudio',
        model: 'llama',
        lastMessageAt: '2025-01-03T00:00:00.000Z',
        flags: { workingFolder: '/repos/demo' },
      });
    });

    const before = result.current.conversations.find(
      (item) => item.conversationId === 'c1',
    );

    act(() => {
      result.current.applyWsUpsert({
        conversationId: 'c1',
        title: 'Rest convo',
        provider: 'lmstudio',
        model: 'llama',
        lastMessageAt: '2025-01-06T00:00:00.000Z',
        flags: ['not-an-object'],
      });
    });

    const after = result.current.conversations.find(
      (item) => item.conversationId === 'c1',
    );
    expect(result.current.readWorkingFolder(after)).toBe('/repos/demo');
    expect(after).toEqual(before);
  });
});
