import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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

const defaultDirs = {
  base: '/base',
  path: '/base',
  dirs: ['repo'],
};

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve({
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: async () => payload,
  } as Response);
}

function mockFlowsFetch(options?: {
  dirs?: typeof defaultDirs | ((path: string | undefined) => unknown) | unknown;
}) {
  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const target = typeof url === 'string' ? url : url.toString();

    if (target.includes('/health')) {
      return mockJsonResponse({ mongoConnected: true });
    }

    if (target.includes('/flows') && !target.includes('/run')) {
      return mockJsonResponse({
        flows: [{ name: 'daily', description: 'Daily flow', disabled: false }],
      });
    }

    if (target.includes('/conversations/') && target.includes('/turns')) {
      return mockJsonResponse({ items: [] });
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
            lastMessageAt: new Date().toISOString(),
            archived: false,
            flowName: 'daily',
            flags: {},
          },
        ],
      });
    }

    if (target.includes('/ingest/dirs')) {
      const path = new URL(target).searchParams.get('path') ?? undefined;
      const dirs =
        typeof options?.dirs === 'function'
          ? options.dirs(path)
          : (options?.dirs ?? defaultDirs);
      return mockJsonResponse(dirs);
    }

    return mockJsonResponse({});
  });
}

function emitWsEvent(event: Record<string, unknown>) {
  const wsRegistry = (
    globalThis as unknown as {
      __wsMock?: { last: () => { _receive: (data: unknown) => void } | null };
    }
  ).__wsMock;
  const ws = wsRegistry?.last();
  if (!ws) throw new Error('No WebSocket instance; did FlowsPage mount?');
  act(() => {
    ws._receive(event);
  });
}

describe('Flows page run/resume controls', () => {
  it('runs a flow with working folder and conversation id', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
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

      if (target.includes('/flows/daily/run')) {
        return mockJsonResponse({
          status: 'started',
          flowName: 'daily',
          conversationId: 'flow-1',
          inflightId: 'i1',
          modelId: 'gpt-5',
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const workingFolderInput = await screen.findByTestId('flow-working-folder');
    fireEvent.change(workingFolderInput, { target: { value: '/tmp/work' } });

    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);

    await waitFor(() => {
      const runCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('/flows/daily/run'),
      );
      expect(runCall).toBeTruthy();
      const [, init] = runCall as [unknown, RequestInit];
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.conversationId).toBe('flow-1');
      expect(body.working_folder).toBe('/tmp/work');
    });
  });

  it('writes the selected folder into the working folder input', async () => {
    const user = userEvent.setup();

    mockFlowsFetch({
      dirs: (path) => {
        if (path === '/base/repo') {
          return { base: '/base', path: '/base/repo', dirs: [] };
        }
        return defaultDirs;
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Flow: daily');

    await act(async () => {
      await user.click(screen.getByTestId('flow-working-folder-picker'));
    });

    const childDir = await screen.findByRole('button', { name: 'repo' });
    await act(async () => {
      await user.click(childDir);
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Use this folder' }));
    });

    const workingFolder = await screen.findByTestId('flow-working-folder');
    expect(workingFolder).toHaveValue('/base/repo');
  });

  it('keeps the working folder value on picker errors', async () => {
    const user = userEvent.setup();
    mockFlowsFetch({ dirs: { status: 'error', code: 'NOT_FOUND' } });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Flow: daily');

    const workingFolder = await screen.findByTestId('flow-working-folder');
    await user.type(workingFolder, '/existing/path');

    await act(async () => {
      await user.click(screen.getByTestId('flow-working-folder-picker'));
    });

    await screen.findByText(/unable to list directories/i);
    expect(screen.getByTestId('flow-working-folder')).toHaveValue(
      '/existing/path',
    );
  });

  it('includes resumeStepPath when resuming a flow', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
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
              flags: { flow: { stepPath: [2, 0] } },
            },
          ],
        });
      }

      if (target.includes('/flows/daily/run')) {
        return mockJsonResponse({
          status: 'started',
          flowName: 'daily',
          conversationId: 'flow-1',
          inflightId: 'i1',
          modelId: 'gpt-5',
        });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const resumeButton = await screen.findByTestId('flow-resume');
    await waitFor(() => expect(resumeButton).toBeEnabled());
    await user.click(resumeButton);

    await waitFor(() => {
      const runCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('/flows/daily/run'),
      );
      expect(runCall).toBeTruthy();
      const [, init] = runCall as [unknown, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.resumeStepPath).toEqual([2, 0]);
    });
  });

  it('keeps agent conversation upserts out of the Flows sidebar', async () => {
    const now = new Date().toISOString();

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
      }

      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
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

    await screen.findByText('Flow: daily');

    emitWsEvent({
      protocolVersion: 'v1',
      type: 'conversation_upsert',
      seq: 1,
      conversation: {
        conversationId: 'agent-1',
        title: 'Agent flow conversation',
        provider: 'codex',
        model: 'gpt-5',
        source: 'REST',
        lastMessageAt: new Date('2025-01-02T00:00:00.000Z').toISOString(),
        archived: false,
        agentName: 'coding_agent',
      },
    });

    await waitFor(() => {
      expect(
        screen.queryByText('Agent flow conversation'),
      ).not.toBeInTheDocument();
    });
  });
});
