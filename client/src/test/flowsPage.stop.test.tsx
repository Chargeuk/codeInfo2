import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  process.env.MODE = 'test';
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: FlowsPage } = await import('../pages/FlowsPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'flows', element: <FlowsPage /> },
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

describe('Flows page stop control', () => {
  it('sends cancel_inflight over WS when stopping a flow run', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows')) {
        return mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({
          items: [],
          inflight: {
            inflightId: 'i1',
            assistantText: '',
            assistantThink: '',
            toolEvents: [],
            startedAt: now,
            seq: 1,
          },
        });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'daily',
              flags: {},
            },
          ],
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const stopButton = await screen.findByTestId('flow-stop');
    await waitFor(() => expect(stopButton).toBeEnabled());

    await user.click(stopButton);

    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { instances?: Array<{ sent: string[] }> };
      }
    ).__wsMock;

    await waitFor(() => {
      const sockets = wsRegistry?.instances ?? [];
      expect(sockets.length).toBeGreaterThan(0);

      const cancelMessages = sockets
        .flatMap((socket) => socket.sent)
        .map((entry) => {
          try {
            return JSON.parse(entry) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .filter((msg) => msg?.type === 'cancel_inflight');

      expect(cancelMessages.length).toBeGreaterThan(0);
      expect(cancelMessages.at(-1)?.conversationId).toBe('flow-1');
      expect(cancelMessages.at(-1)?.inflightId).toBe('i1');
    });
  });
});
