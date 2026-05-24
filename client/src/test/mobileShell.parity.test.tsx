import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: AgentsPage } = await import('../pages/AgentsPage');
const { default: ChatPage } = await import('../pages/ChatPage');
const { default: FlowsPage } = await import('../pages/FlowsPage');
const { default: IngestPage } = await import('../pages/IngestPage');
const { default: LogsPage } = await import('../pages/LogsPage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <div data-testid="home-route" /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'flows', element: <FlowsPage /> },
      { path: 'ingest', element: <IngestPage /> },
      { path: 'logs', element: <LogsPage /> },
    ],
  },
];

const mobileWidth = 375;
const desktopWidth = 1280;
const originalEventSource = global.EventSource;

function setViewportWidth(width: number) {
  act(() => {
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));
  });
}

function mockJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installMobileShellFetch() {
  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const target = String(url);

    if (target.includes('/health')) {
      return Promise.resolve(mockJsonResponse({ mongoConnected: true }));
    }

    if (target.includes('/chat/providers')) {
      return Promise.resolve(
        mockJsonResponse({
          providers: [
            {
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
            },
          ],
        }),
      );
    }

    if (target.includes('/chat/models')) {
      return Promise.resolve(
        mockJsonResponse({
          provider: 'lmstudio',
          available: true,
          toolsAvailable: true,
          models: [{ key: 'lm', displayName: 'LM', type: 'gguf' }],
        }),
      );
    }

    if (target.includes('/agents') && !target.includes('/commands')) {
      return Promise.resolve(
        mockJsonResponse({ agents: [{ name: 'coding_agent' }] }),
      );
    }

    if (target.includes('/agents/coding_agent/commands')) {
      return Promise.resolve(mockJsonResponse({ commands: [] }));
    }

    if (target.includes('/flows/daily?') || target.endsWith('/flows/daily')) {
      return Promise.resolve(
        mockJsonResponse({
          flow: {
            name: 'daily',
            description: 'Daily flow',
            disabled: false,
            warnings: [],
          },
        }),
      );
    }

    if (target.includes('/flows') && !target.includes('/run')) {
      return Promise.resolve(
        mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        }),
      );
    }

    if (target.includes('/conversations/') && target.includes('/turns')) {
      return Promise.resolve(mockJsonResponse({ items: [], nextCursor: null }));
    }

    if (target.includes('/conversations')) {
      return Promise.resolve(mockJsonResponse({ items: [], nextCursor: null }));
    }

    if (target.includes('/ingest/models')) {
      return Promise.resolve(
        mockJsonResponse({ models: [], lockedModelId: undefined }),
      );
    }

    if (target.includes('/ingest/roots')) {
      return Promise.resolve(
        mockJsonResponse({ roots: [], lockedModelId: undefined }),
      );
    }

    if (target.includes('/logs')) {
      return Promise.resolve(
        mockJsonResponse({ items: [], lastSequence: 0, hasMore: false }),
      );
    }

    return Promise.resolve(mockJsonResponse({}));
  });
}

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('mobile shell parity', () => {
  beforeEach(() => {
    setViewportWidth(mobileWidth);
    installMobileShellFetch();
    global.EventSource = jest.fn(() => ({
      close: jest.fn(),
      onerror: null,
      onmessage: null,
    })) as unknown as typeof EventSource;
  });

  afterEach(() => {
    setViewportWidth(desktopWidth);
    global.EventSource = originalEventSource;
  });

  it.each(['/logs', '/ingest'])(
    'renders the shared utility mobile top bar on %s',
    async (path) => {
      renderRoute(path);

      expect(
        await screen.findByTestId('utility-page-shell'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Open conversations' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Conversations$/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Menu$/i }),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    ['/chat', 'Chat'],
    ['/agents', 'Agents'],
    ['/flows', 'Flows'],
  ] as const)(
    'renders the shared workspace mobile top bar on %s',
    async (path, title) => {
      renderRoute(path);

      if (path !== '/flows') {
        expect(await screen.findByText(title)).toBeInTheDocument();
      }
      expect(
        screen.getByRole('button', { name: 'Open conversations' }),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeVisible();
      expect(
        screen.queryByRole('button', { name: /^Conversations$/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Menu$/i }),
      ).not.toBeInTheDocument();
    },
  );

  it('still opens the mobile overlays from the shared Chat top bar', async () => {
    const user = userEvent.setup();
    renderRoute('/chat');

    await user.click(
      screen.getByRole('button', { name: 'Open conversations' }),
    );

    expect(
      screen.getByTestId('workspace-mobile-conversations-overlay'),
    ).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Close conversations' }),
    );
    await waitFor(() => {
      expect(
        screen.queryByTestId('workspace-mobile-conversations-overlay'),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(
      screen.getByTestId('workspace-mobile-app-menu-overlay'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    await waitFor(() => {
      expect(
        screen.queryByTestId('workspace-mobile-app-menu-overlay'),
      ).not.toBeInTheDocument();
    });
  });
});
