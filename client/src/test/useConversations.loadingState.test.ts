import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversations } from '../hooks/useConversations';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const originalFetch = global.fetch;
const mockFetch = getFetchMock();

function makeAbortError() {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

describe('useConversations loading state', () => {
  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('keeps the newer request loading while stale abort cleanup completes', async () => {
    const resolveCalls: Array<(value: Response) => void> = [];

    mockFetch.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((resolve, reject) => {
          resolveCalls.push(resolve);
          const signal = init?.signal;
          signal?.addEventListener('abort', () => reject(makeAbortError()), {
            once: true,
          });
        });
      },
    );

    const { result } = renderHook(() => useConversations());

    await waitFor(() =>
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(result.current.isLoading).toBe(true);

    let refreshPromise: Promise<void> | undefined;
    await act(async () => {
      refreshPromise = result.current.refresh();
    });

    await waitFor(() =>
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(true);

    const resolveLatest = resolveCalls.at(-1);
    if (!resolveLatest) {
      throw new Error('Expected the latest conversations request resolver');
    }

    await act(async () => {
      resolveLatest(
        mockJsonResponse({
          items: [
            {
              conversationId: 'c2',
              title: 'Fresh convo',
              provider: 'codex',
              model: 'gpt-5',
              lastMessageAt: '2025-01-01T00:00:01.000Z',
            },
          ],
        }),
      );
      await refreshPromise;
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversations[0]?.conversationId).toBe('c2');
  });
});
