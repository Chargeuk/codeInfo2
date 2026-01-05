import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, useEffect, useRef } from 'react';
import useConversationTurns from '../hooks/useConversationTurns';

const mockFetch = global.fetch as jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
});

function mockApi() {
  let turnsCall = 0;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversations/c1/turns')) {
      turnsCall += 1;
      if (turnsCall === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                conversationId: 'c1',
                role: 'assistant',
                content: 'Initial reply',
                model: 'm1',
                provider: 'lmstudio',
                toolCalls: null,
                status: 'ok',
                createdAt: '2025-01-01T00:00:00Z',
              },
            ],
          }),
        }) as Response;
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              conversationId: 'c1',
              role: 'assistant',
              content: 'Refreshed reply',
              model: 'm1',
              provider: 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: '2025-01-02T00:00:00Z',
            },
          ],
        }),
      }) as Response;
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Response;
  });
}

function TestTurnsRefresh() {
  const { turns, refresh } = useConversationTurns('c1');
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (
      !refreshedRef.current &&
      turns.some((t) => t.content === 'Initial reply')
    ) {
      refreshedRef.current = true;
      void refresh();
    }
  }, [refresh, turns]);

  return createElement(
    'div',
    null,
    ...turns.map((t) => createElement('p', { key: t.createdAt }, t.content)),
  );
}

test('useConversationTurns.refresh replaces turn state from full snapshot', async () => {
  mockApi();

  render(createElement(TestTurnsRefresh));

  expect(await screen.findByText('Initial reply')).toBeInTheDocument();

  await act(async () => {
    await Promise.resolve();
  });

  expect(await screen.findByText('Refreshed reply')).toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledTimes(2);

  const urls = mockFetch.mock.calls.map((call) =>
    typeof call[0] === 'string' ? call[0] : call[0].toString(),
  );
  expect(urls.every((url) => url.includes('/conversations/c1/turns'))).toBe(
    true,
  );
  expect(urls.some((url) => url.includes('?'))).toBe(false);
});

test('useConversationTurns.refresh error does not clear existing turns', async () => {
  let turnsCall = 0;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (!url.includes('/conversations/c1/turns')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as Response;
    }

    turnsCall += 1;
    if (turnsCall === 1) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              conversationId: 'c1',
              role: 'assistant',
              content: 'Initial reply',
              model: 'm1',
              provider: 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: '2025-01-01T00:00:00Z',
            },
          ],
        }),
      }) as Response;
    }

    return Promise.resolve({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as Response;
  });

  function TestTurnsError() {
    const { turns, isError, error, refresh } = useConversationTurns('c1');
    const refreshedRef = useRef(false);

    useEffect(() => {
      if (!refreshedRef.current && turns.length > 0) {
        refreshedRef.current = true;
        void refresh();
      }
    }, [refresh, turns]);

    return createElement(
      'div',
      null,
      createElement(
        'span',
        { 'data-testid': 'error' },
        isError ? (error ?? 'error') : 'ok',
      ),
      ...turns.map((t) => createElement('p', { key: t.createdAt }, t.content)),
    );
  }

  render(createElement(TestTurnsError));
  expect(await screen.findByText('Initial reply')).toBeInTheDocument();

  await act(async () => {
    await Promise.resolve();
  });

  expect(screen.getByText('Initial reply')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByTestId('error').textContent).toContain('Failed to load'),
  );
});
