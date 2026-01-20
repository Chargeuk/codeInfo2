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

const defaultDirs = {
  base: '/base',
  path: '/base',
  dirs: ['repo'],
};

async function waitForAgentSelection() {
  const select = await screen.findByRole('combobox', { name: /agent/i });
  await waitFor(() => expect(select).toHaveTextContent('coding_agent'));
}

async function waitForPickerEnabled() {
  await waitFor(() =>
    expect(screen.getByTestId('agent-working-folder-picker')).toBeEnabled(),
  );
}

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve({
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: async () => payload,
  } as Response);
}

function mockAgentsFetch(options?: {
  dirs?: typeof defaultDirs | ((path: string | undefined) => unknown) | unknown;
  runResponse?: (init?: RequestInit) => Response;
}) {
  mockFetch.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof url === 'string' ? url : url.toString();

    if (target.includes('/health')) {
      return mockJsonResponse({ mongoConnected: true });
    }

    if (target.endsWith('/agents')) {
      return mockJsonResponse({ agents: [{ name: 'coding_agent' }] });
    }

    if (target.includes('/agents/coding_agent/commands')) {
      return mockJsonResponse({ commands: [] });
    }

    if (target.includes('/conversations')) {
      return mockJsonResponse({ items: [] });
    }

    if (target.includes('/ingest/dirs')) {
      const path = new URL(target).searchParams.get('path') ?? undefined;
      const dirs =
        typeof options?.dirs === 'function'
          ? options.dirs(path)
          : (options?.dirs ?? defaultDirs);
      return mockJsonResponse(dirs);
    }

    if (target.includes('/agents/coding_agent/run')) {
      if (options?.runResponse) {
        return options.runResponse(init);
      }
      return mockJsonResponse(
        {
          status: 'started',
          agentName: 'coding_agent',
          conversationId: 'c1',
          inflightId: 'i1',
          modelId: 'gpt-5.2-codex',
        },
        { status: 202 },
      );
    }

    return mockJsonResponse({});
  });
}

describe('Agents page - working folder picker', () => {
  it('opens the directory picker dialog', async () => {
    const user = userEvent.setup();
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitForAgentSelection();
    await waitForPickerEnabled();

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    await act(async () => {
      await user.click(screen.getByTestId('agent-working-folder-picker'));
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('writes the selected folder into the working folder input', async () => {
    const user = userEvent.setup();

    mockAgentsFetch({
      dirs: (path) => {
        if (path === '/base/repo') {
          return { base: '/base', path: '/base/repo', dirs: [] };
        }
        return defaultDirs;
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitForAgentSelection();
    await waitForPickerEnabled();

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    await act(async () => {
      await user.click(screen.getByTestId('agent-working-folder-picker'));
    });

    const childDir = await screen.findByRole('button', { name: 'repo' });
    await act(async () => {
      await user.click(childDir);
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Use this folder' }));
    });

    const workingFolder = await screen.findByTestId('agent-working-folder');
    expect(workingFolder).toHaveValue('/base/repo');
  });

  it('keeps the working folder value when the picker is closed', async () => {
    const user = userEvent.setup();
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitForAgentSelection();
    await waitForPickerEnabled();

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const workingFolder = await screen.findByTestId('agent-working-folder');
    await user.type(workingFolder, '/existing/path');

    await act(async () => {
      await user.click(screen.getByTestId('agent-working-folder-picker'));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Close' }));
    });

    expect(screen.getByTestId('agent-working-folder')).toHaveValue(
      '/existing/path',
    );
  });

  it('keeps the working folder value on picker errors', async () => {
    const user = userEvent.setup();
    mockAgentsFetch({ dirs: { status: 'error', code: 'NOT_FOUND' } });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitForAgentSelection();
    await waitForPickerEnabled();

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const workingFolder = await screen.findByTestId('agent-working-folder');
    await user.type(workingFolder, '/existing/path');

    await act(async () => {
      await user.click(screen.getByTestId('agent-working-folder-picker'));
    });

    await screen.findByText(/unable to list directories/i);
    expect(screen.getByTestId('agent-working-folder')).toHaveValue(
      '/existing/path',
    );
  });

  it('keeps the working folder value on run validation errors', async () => {
    const user = userEvent.setup();

    mockAgentsFetch({
      runResponse: () =>
        ({
          ok: false,
          status: 400,
          headers: { get: () => 'application/json' },
          json: async () => ({
            error: 'invalid_request',
            code: 'WORKING_FOLDER_INVALID',
            message: 'Invalid working folder.',
          }),
        }) as Response,
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitForAgentSelection();
    await waitForPickerEnabled();

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const workingFolder = await screen.findByTestId('agent-working-folder');
    await user.type(workingFolder, '/bad/path');

    const input = await screen.findByTestId('agent-input');
    await user.type(input, 'Question');

    await act(async () => {
      await user.click(screen.getByTestId('agent-send'));
    });

    await screen.findByTestId('agents-run-error');
    expect(screen.getByTestId('agent-working-folder')).toHaveValue('/bad/path');
  });
});
