import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ConversationApiSummary } from '../api/conversations';
import useSelectedConversation from '../hooks/useSelectedConversation';
import { mockJsonResponse } from './support/fetchMock';

const originalFetch = global.fetch;
const mockFetch = jest.fn<typeof fetch>();
const a: ConversationApiSummary = {
  conversationId: 'a',
  title: 'A',
  provider: 'codex',
  model: 'm1',
};
const b: ConversationApiSummary = { ...a, conversationId: 'b', title: 'B' };
type Props = {
  conversationId?: string;
  conversations: ConversationApiSummary[];
  enabled?: boolean;
};

beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
});
afterEach(() => {
  global.fetch = originalFetch;
});

it('uses a loaded match immediately without an exact request', () => {
  const conversations = [a];
  const { result } = renderHook(() =>
    useSelectedConversation({ conversationId: 'a', conversations }),
  );
  expect(result.current.summary).toBe(a);
  expect(result.current.isLoading).toBe(false);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('retains a selected summary when a filter omits it and refreshes the fallback', async () => {
  let resolve!: (response: Response) => void;
  mockFetch.mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const { result, rerender } = renderHook(
    (props: Props) => useSelectedConversation(props),
    {
      initialProps: { conversationId: 'a', conversations: [a] },
    },
  );
  rerender({ conversationId: 'a', conversations: [] });
  expect(result.current.summary).toBe(a);
  expect(result.current.isLoading).toBe(true);
  const updated = {
    ...a,
    archived: true,
    flags: { workingFolder: '/updated' },
  };
  await act(async () => {
    resolve(mockJsonResponse({ items: [updated] }));
  });
  await waitFor(() => expect(result.current.summary).toMatchObject(updated));
  mockFetch.mockResolvedValue(
    mockJsonResponse({ items: [{ ...updated, title: 'Refreshed' }] }),
  );
  rerender({ conversationId: 'a', conversations: [] });
  await waitFor(() => expect(result.current.summary?.title).toBe('Refreshed'));
});

it('ignores a late A lookup after B has been selected', async () => {
  let resolveA!: (response: Response) => void;
  mockFetch.mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolveA = done;
      }),
  );
  const { result, rerender } = renderHook<
    ReturnType<typeof useSelectedConversation>,
    Props
  >((props: Props) => useSelectedConversation(props), {
    initialProps: { conversationId: 'a', conversations: [] },
  });
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  rerender({ conversationId: 'b', conversations: [b] });
  expect(result.current.summary).toBe(b);
  await act(async () => {
    resolveA(mockJsonResponse({ items: [a] }));
  });
  expect(result.current.summary).toBe(b);
  expect(result.current.error).toBeUndefined();
});

it('lets a newly loaded match supersede an outstanding lookup of that same ID', async () => {
  let resolve!: (response: Response) => void;
  mockFetch.mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const { result, rerender } = renderHook<
    ReturnType<typeof useSelectedConversation>,
    Props
  >((props: Props) => useSelectedConversation(props), {
    initialProps: { conversationId: 'a', conversations: [] },
  });
  rerender({ conversationId: 'a', conversations: [{ ...a, title: 'Latest' }] });
  await act(async () => {
    resolve(mockJsonResponse({ items: [a] }));
  });
  expect(result.current.summary?.title).toBe('Latest');
});

it('reports a missing target without substituting another summary', async () => {
  mockFetch.mockResolvedValue(mockJsonResponse({ items: [] }));
  const conversations = [b];
  const { result } = renderHook(() =>
    useSelectedConversation({ conversationId: 'a', conversations }),
  );
  await waitFor(() =>
    expect(result.current.error).toBe('Conversation not found.'),
  );
  expect(result.current.summary).toBeUndefined();
  expect(result.current.isLoading).toBe(false);
});

it('reports lookup failures and respects persistence being disabled', async () => {
  mockFetch.mockRejectedValue(new Error('History unavailable'));
  const { result, rerender } = renderHook(
    (props: Props) => useSelectedConversation(props),
    {
      initialProps: { conversationId: 'a', conversations: [], enabled: false },
    },
  );
  expect(mockFetch).not.toHaveBeenCalled();
  rerender({ conversationId: 'a', conversations: [], enabled: true });
  await waitFor(() => expect(result.current.error).toBe('History unavailable'));
  expect(result.current.summary).toBeUndefined();
});
