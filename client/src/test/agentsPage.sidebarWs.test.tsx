import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: AgentsPage } = await import('../pages/AgentsPage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [{ path: 'agents', element: <AgentsPage /> }],
  },
];

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve({
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: async () => payload,
  } as Response);
}

function emitWsEvent(event: Record<string, unknown>) {
  const wsRegistry = (
    globalThis as unknown as {
      __wsMock?: { last: () => { _receive: (data: unknown) => void } | null };
    }
  ).__wsMock;
  const ws = wsRegistry?.last();
  if (!ws) throw new Error('No WebSocket instance; did AgentsPage mount?');
  act(() => {
    ws._receive(event);
  });
}

async function waitForWsSent(type: string) {
  await waitFor(() => {
    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { instances?: Array<{ sent: string[] }> };
      }
    ).__wsMock;
    const sent = (wsRegistry?.instances ?? []).flatMap((socket) => socket.sent);
    const messages = sent
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    expect(messages.some((msg) => msg?.type === type)).toBe(true);
  });
}

describe('AgentsPage sidebar WS updates', () => {
  it('applies conversation_upsert only for the active agent and keeps ordering stable by lastMessageAt', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return mockJsonResponse({ agents: [{ name: 'a1' }] });
      }

      if (target.includes('/agents/a1/commands')) {
        return mockJsonResponse({ commands: [] });
      }

      if (
        target.includes('/conversations') &&
        target.includes('agentName=a1')
      ) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'c1',
              title: 'First agent conversation',
              provider: 'codex',
              model: 'gpt-5.2',
              lastMessageAt: '2025-01-01T00:00:00.000Z',
              archived: false,
              agentName: 'a1',
            },
          ],
          nextCursor: null,
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [], nextCursor: null });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agents-page');
    await screen.findByText('First agent conversation');

    await waitForWsSent('subscribe_sidebar');

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'conversation_upsert',
      seq: 1,
      conversation: {
        conversationId: 'c2',
        title: 'Second agent conversation',
        provider: 'codex',
        model: 'gpt-5.2',
        source: 'REST',
        lastMessageAt: '2025-01-02T00:00:00.000Z',
        archived: false,
        agentName: 'a1',
      },
    });

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'conversation_upsert',
      seq: 2,
      conversation: {
        conversationId: 'c3',
        title: 'Ignored agent conversation',
        provider: 'codex',
        model: 'gpt-5.2',
        source: 'REST',
        lastMessageAt: '2025-01-03T00:00:00.000Z',
        archived: false,
        agentName: 'other',
      },
    });

    await screen.findByText('Second agent conversation');
    expect(screen.queryByText('Ignored agent conversation')).toBeNull();

    await waitFor(() => {
      const titles = screen
        .getAllByTestId('conversation-title')
        .map((node) => node.textContent);
      expect(titles).toEqual([
        'Second agent conversation',
        'First agent conversation',
      ]);
    });

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'conversation_upsert',
      seq: 3,
      conversation: {
        conversationId: 'c1',
        title: 'First agent conversation',
        provider: 'codex',
        model: 'gpt-5.2',
        source: 'REST',
        lastMessageAt: '2025-01-04T00:00:00.000Z',
        archived: false,
        agentName: 'a1',
      },
    });

    await waitFor(() => {
      const titles = screen
        .getAllByTestId('conversation-title')
        .map((node) => node.textContent);
      expect(titles).toEqual([
        'First agent conversation',
        'Second agent conversation',
      ]);
    });
  });

  it('removes conversations from the sidebar on conversation_delete', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return mockJsonResponse({ agents: [{ name: 'a1' }] });
      }

      if (target.includes('/agents/a1/commands')) {
        return mockJsonResponse({ commands: [] });
      }

      if (
        target.includes('/conversations') &&
        target.includes('agentName=a1')
      ) {
        return mockJsonResponse({ items: [], nextCursor: null });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [], nextCursor: null });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agents-page');
    await waitForWsSent('subscribe_sidebar');

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'conversation_upsert',
      seq: 1,
      conversation: {
        conversationId: 'c1',
        title: 'Agent conversation to delete',
        provider: 'codex',
        model: 'gpt-5.2',
        source: 'REST',
        lastMessageAt: '2025-01-02T00:00:00.000Z',
        archived: false,
        agentName: 'a1',
      },
    });

    await screen.findByText('Agent conversation to delete');

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'conversation_delete',
      seq: 2,
      conversationId: 'c1',
    });

    await waitFor(() => {
      expect(screen.queryByText('Agent conversation to delete')).toBeNull();
    });
  });
});
