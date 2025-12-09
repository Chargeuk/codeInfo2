import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import useConversationTurns from '../hooks/useConversationTurns';

const mockFetch = global.fetch as jest.Mock;

beforeAll(() => {
  // @ts-expect-error jsdom lacks IntersectionObserver
  global.IntersectionObserver = class {
    constructor() {}
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof IntersectionObserver;
});

beforeEach(() => {
  mockFetch.mockReset();
});

function mockApi() {
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (
      url.includes('/conversations/c1/turns') &&
      url.includes('cursor=older')
    ) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              conversationId: 'c1',
              role: 'assistant',
              content: 'Older reply',
              model: 'm1',
              provider: 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: '2024-12-30T00:00:00Z',
            },
          ],
          nextCursor: undefined,
        }),
      }) as Response;
    }
    if (url.includes('/conversations/c1/turns')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              conversationId: 'c1',
              role: 'assistant',
              content: 'Newest reply',
              model: 'm1',
              provider: 'lmstudio',
              toolCalls: null,
              status: 'ok',
              createdAt: '2025-01-02T00:00:00Z',
            },
            {
              conversationId: 'c1',
              role: 'user',
              content: 'First user',
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
      json: async () => ({}),
    }) as Response;
  });
}

function TestTurns() {
  const { turns, hasMore, loadOlder } = useConversationTurns('c1');

  useEffect(() => {
    if (hasMore) {
      void loadOlder();
    }
  }, [hasMore, loadOlder]);

  return (
    <div>
      {turns.map((t) => (
        <p key={t.createdAt}>{t.content}</p>
      ))}
    </div>
  );
}

test('loads newest turns then older ones via hook', async () => {
  mockApi();

  render(<TestTurns />);

  expect(await screen.findByText('Newest reply')).toBeInTheDocument();
  expect(screen.getByText('First user')).toBeInTheDocument();

  await act(async () => {
    // loadOlder triggers via useEffect when hasMore becomes true
    await Promise.resolve();
  });

  expect(await screen.findByText('Older reply')).toBeInTheDocument();
});
