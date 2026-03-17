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
});
