import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
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
  act(() => {
    ws._receive(event);
  });
}

describe('Agents reasoning rendering (assistantThink / analysis_delta)', () => {
  it('keeps thought process collapsed by default and toggles open', async () => {
    const user = userEvent.setup();
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

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Agent conversation');
    await user.click(screen.getByText('Agent conversation'));

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'inflight_snapshot',
      conversationId: 'c1',
      seq: 1,
      inflight: {
        inflightId: 'i1',
        assistantText: 'Answer',
        assistantThink: 'Thinking...\nSecond line',
        toolEvents: [],
        startedAt: '2025-01-01T00:00:00.000Z',
      },
    });
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'turn_final',
      conversationId: 'c1',
      seq: 2,
      inflightId: 'i1',
      status: 'ok',
    });

    const toggle = await screen.findByTestId('think-toggle');
    expect(screen.queryByTestId('think-content')).toBeNull();

    await user.click(toggle);
    const thinkContent = await screen.findByTestId('think-content');
    await waitFor(() => expect(thinkContent).toBeVisible());
    expect(thinkContent.textContent ?? '').toContain('Thinking');
  });
});
