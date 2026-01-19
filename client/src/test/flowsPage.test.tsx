import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('Flows page basics', () => {
  it('renders flows list and flow step metadata', async () => {
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
          items: [
            {
              turnId: 't1',
              conversationId: 'flow-1',
              role: 'assistant',
              content: 'Flow content',
              provider: 'codex',
              model: 'gpt-5',
              status: 'ok',
              command: {
                name: 'flow',
                stepIndex: 1,
                totalSteps: 3,
                label: 'Plan',
                agentType: 'planning_agent',
                identifier: 'main',
              },
              createdAt: now,
            },
          ],
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

    const flowSelect = await screen.findByTestId('flow-select');
    await waitFor(() =>
      expect((flowSelect as HTMLInputElement).value).toBe('daily'),
    );

    const metadata = await screen.findByTestId('bubble-flow-meta');
    expect(metadata).toHaveTextContent('Plan · planning_agent/main');
  });

  it('does not show stale conversations when flow has no history', async () => {
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows')) {
        return mockJsonResponse({
          flows: [
            {
              name: 'execute_plan',
              description: 'Execute a plan until it is complete',
              disabled: false,
            },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({
          items: [
            {
              turnId: 't-stale',
              conversationId: 'chat-1',
              role: 'assistant',
              content: 'Stale content',
              provider: 'codex',
              model: 'gpt-5',
              status: 'ok',
              createdAt: now,
            },
          ],
        });
      }

      if (target.includes('/conversations')) {
        const urlObj = new URL(target);
        const flowName = urlObj.searchParams.get('flowName');
        if (flowName === 'execute_plan') {
          return mockJsonResponse({ items: [] });
        }
        return mockJsonResponse({
          items: [
            {
              conversationId: 'chat-1',
              title: 'Chat: test',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flags: {},
            },
          ],
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const flowSelect = await screen.findByTestId('flow-select');
    await waitFor(() =>
      expect((flowSelect as HTMLInputElement).value).toBe('execute_plan'),
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Transcript will appear here once a flow run starts/i),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByText('Stale content')).not.toBeInTheDocument();
  });
});
