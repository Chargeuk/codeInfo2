import { act, render, screen } from '@testing-library/react';
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
            nextCursor: 'older',
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
          nextCursor: 'older2',
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
  const { turns, lastMode, refresh } = useConversationTurns('c1');
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
    createElement('span', { 'data-testid': 'mode' }, lastMode ?? 'none'),
    ...turns.map((t) => createElement('p', { key: t.createdAt }, t.content)),
  );
}

test('useConversationTurns.refresh re-fetches newest page in replace mode', async () => {
  mockApi();

  render(createElement(TestTurnsRefresh));

  expect(await screen.findByText('Initial reply')).toBeInTheDocument();

  await act(async () => {
    await Promise.resolve();
  });

  expect(await screen.findByText('Refreshed reply')).toBeInTheDocument();
  expect(screen.getByTestId('mode').textContent).toBe('replace');
  expect(mockFetch).toHaveBeenCalledTimes(2);
});
