import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'agents', element: <AgentsPage /> },
    ],
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
  ws._receive(event);
}

describe('AgentsPage live transcript (WS)', () => {
  it('renders in-flight WS transcript updates for agent conversations', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
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
                title: 'Agent conversation',
                provider: 'codex',
                model: 'gpt-5.2',
                lastMessageAt: '2025-01-01T00:00:00.000Z',
                archived: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (target.includes('/conversations/') && target.includes('/turns')) {
          return mockJsonResponse({ items: [] });
        }

        if (target.includes('/agents/a1/run') && opts?.method === 'POST') {
          return mockJsonResponse({ status: 'ok' });
        }

        return mockJsonResponse({});
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agents-page');
    await screen.findByText('Agent conversation');

    await user.click(screen.getByText('Agent conversation'));

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'inflight_snapshot',
      conversationId: 'c1',
      seq: 1,
      inflight: {
        inflightId: 'i1',
        assistantText: '',
        assistantThink: '',
        toolEvents: [],
        startedAt: '2025-01-01T00:00:00.000Z',
      },
    });
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'assistant_delta',
      conversationId: 'c1',
      seq: 2,
      inflightId: 'i1',
      delta: 'Hello from agent WS',
    });
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'analysis_delta',
      conversationId: 'c1',
      seq: 3,
      inflightId: 'i1',
      delta: 'thinking...',
    });
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'tool_event',
      conversationId: 'c1',
      seq: 4,
      inflightId: 'i1',
      event: {
        type: 'tool-request',
        callId: 'call-1',
        name: 'VectorSearch',
        stage: 'request',
      },
    });

    await waitFor(() =>
      expect(screen.getByText(/Hello from agent WS/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId('agent-transcript')).toBeInTheDocument();
    expect(screen.getByTestId('tool-row')).toBeInTheDocument();
  });

  it('unsubscribes from the previous conversation on switch', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
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
              },
              {
                conversationId: 'c2',
                title: 'Second agent conversation',
                provider: 'codex',
                model: 'gpt-5.2',
                lastMessageAt: '2025-01-02T00:00:00.000Z',
                archived: false,
              },
            ],
            nextCursor: null,
          });
        }

        if (target.includes('/conversations/') && target.includes('/turns')) {
          return mockJsonResponse({ items: [] });
        }

        if (target.includes('/agents/a1/run') && opts?.method === 'POST') {
          return mockJsonResponse({ status: 'ok' });
        }

        return mockJsonResponse({});
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Second agent conversation');

    await user.click(screen.getByText('First agent conversation'));
    await user.click(screen.getByText('Second agent conversation'));

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

    expect(
      messages.some(
        (msg) =>
          msg?.type === 'unsubscribe_conversation' &&
          msg?.conversationId === 'c1',
      ),
    ).toBe(true);
  });
});
