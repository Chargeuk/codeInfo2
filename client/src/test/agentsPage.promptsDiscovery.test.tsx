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

function okJson(payload: unknown, init?: { status?: number }) {
  return Promise.resolve({
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: async () => payload,
  } as Response);
}

function deferredResponse() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setupPromptRaceFetch(params: {
  promptsHandlers: Record<
    string,
    { promise: Promise<Response> | Response; calls: number }
  >;
  runStatus?: number;
}) {
  const runBodies: Record<string, unknown>[] = [];
  mockFetch.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof url === 'string' ? url : url.toString();

    if (target.includes('/health')) return okJson({ mongoConnected: true });
    if (target.includes('/agents/coding_agent/prompts')) {
      const folder = new URL(target).searchParams.get('working_folder') ?? '';
      const handler = params.promptsHandlers[folder];
      if (!handler) {
        return okJson({ prompts: [] });
      }
      handler.calls += 1;
      return handler.promise;
    }
    if (target.includes('/agents/coding_agent/run')) {
      if (init?.body) {
        runBodies.push(JSON.parse(init.body.toString()));
      }
      return Promise.resolve({
        ok: (params.runStatus ?? 202) >= 200 && (params.runStatus ?? 202) < 300,
        status: params.runStatus ?? 202,
        headers: { get: () => 'application/json' },
        json: async () => ({
          status: 'started',
          agentName: 'coding_agent',
          conversationId: 'c1',
          inflightId: 'i1',
          modelId: 'gpt-5.3-codex',
        }),
      } as Response);
    }
    if (
      target.includes('/agents') &&
      !target.includes('/commands') &&
      !target.includes('/run') &&
      !target.includes('/prompts')
    ) {
      return okJson({ agents: [{ name: 'coding_agent' }] });
    }
    if (target.includes('/agents/coding_agent/commands')) {
      return okJson({ commands: [] });
    }
    if (target.includes('/conversations')) return okJson({ items: [] });
    return okJson({});
  });
  return { runBodies };
}

async function commitWorkingFolderByBlur(value: string) {
  const input = (await screen.findByTestId(
    'agent-working-folder',
  )) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe('Agents page - prompts discovery lifecycle', () => {
  it('applies latest-request-wins behavior when two commits race', async () => {
    const a = deferredResponse();
    const b = deferredResponse();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    setupPromptRaceFetch({
      promptsHandlers: {
        '/folder-a': { promise: a.promise, calls: 0 },
        '/folder-b': { promise: b.promise, calls: 0 },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/folder-a');
    await commitWorkingFolderByBlur('/folder-b');

    await act(async () => {
      b.resolve(
        (await okJson({
          prompts: [{ relativePath: 'b.md', fullPath: '/b.md' }],
        })) as Response,
      );
    });
    await act(async () => {
      a.resolve(
        (await okJson({
          prompts: [{ relativePath: 'a.md', fullPath: '/a.md' }],
        })) as Response,
      );
    });

    await waitFor(() =>
      expect(
        infoSpy.mock.calls.some((call) =>
          String(call[0]).includes(
            '[agents.prompts.discovery.request.stale_ignored]',
          ),
        ),
      ).toBe(true),
    );
    infoSpy.mockRestore();
  });

  it('ignores stale success response that resolves after newer commit', async () => {
    const stale = deferredResponse();
    const latest = deferredResponse();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    setupPromptRaceFetch({
      promptsHandlers: {
        '/old-success': { promise: stale.promise, calls: 0 },
        '/new-success': { promise: latest.promise, calls: 0 },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/old-success');
    await commitWorkingFolderByBlur('/new-success');

    await act(async () => {
      latest.resolve(
        (await okJson({
          prompts: [{ relativePath: 'latest.md', fullPath: '/latest.md' }],
        })) as Response,
      );
    });
    await act(async () => {
      stale.resolve(
        (await okJson({
          prompts: [{ relativePath: 'stale.md', fullPath: '/stale.md' }],
        })) as Response,
      );
    });

    await waitFor(() =>
      expect(
        infoSpy.mock.calls.some((call) =>
          String(call[0]).includes(
            '[agents.prompts.discovery.request.stale_ignored]',
          ),
        ),
      ).toBe(true),
    );
    infoSpy.mockRestore();
  });

  it('does not let stale error override latest success', async () => {
    const staleError = deferredResponse();
    const latestSuccess = deferredResponse();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    setupPromptRaceFetch({
      promptsHandlers: {
        '/stale-error': { promise: staleError.promise, calls: 0 },
        '/latest-success': { promise: latestSuccess.promise, calls: 0 },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/stale-error');
    await commitWorkingFolderByBlur('/latest-success');

    await act(async () => {
      latestSuccess.resolve(
        (await okJson({
          prompts: [{ relativePath: 'ok.md', fullPath: '/ok.md' }],
        })) as Response,
      );
    });
    await act(async () => {
      staleError.resolve({
        ok: false,
        status: 500,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'agent_prompts_failed' }),
      } as Response);
    });

    await waitFor(() =>
      expect(
        infoSpy.mock.calls.some((call) =>
          String(call[0]).includes(
            '[agents.prompts.discovery.request.stale_ignored]',
          ),
        ),
      ).toBe(true),
    );
    infoSpy.mockRestore();
  });

  it('does not let stale success override latest error', async () => {
    const staleSuccess = deferredResponse();
    const latestError = deferredResponse();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    setupPromptRaceFetch({
      promptsHandlers: {
        '/stale-success': { promise: staleSuccess.promise, calls: 0 },
        '/latest-error': { promise: latestError.promise, calls: 0 },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/stale-success');
    await commitWorkingFolderByBlur('/latest-error');

    await act(async () => {
      latestError.resolve({
        ok: false,
        status: 500,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'agent_prompts_failed' }),
      } as Response);
    });
    await act(async () => {
      staleSuccess.resolve(
        (await okJson({
          prompts: [{ relativePath: 'stale.md', fullPath: '/stale.md' }],
        })) as Response,
      );
    });

    await waitFor(() =>
      expect(
        infoSpy.mock.calls.some((call) =>
          String(call[0]).includes(
            '[agents.prompts.discovery.request.stale_ignored]',
          ),
        ),
      ).toBe(true),
    );
    infoSpy.mockRestore();
  });

  it('pressing Enter in working_folder commits discovery and does not submit instruction send', async () => {
    const user = userEvent.setup();
    const runBodies: Record<string, unknown>[] = [];
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) return okJson({ mongoConnected: true });
        if (target.includes('/agents/coding_agent/prompts')) {
          return okJson({ prompts: [] });
        }
        if (target.includes('/agents/coding_agent/run')) {
          if (init?.body) runBodies.push(JSON.parse(init.body.toString()));
          return okJson(
            {
              status: 'started',
              agentName: 'coding_agent',
              conversationId: 'c1',
              inflightId: 'i1',
              modelId: 'gpt-5.3-codex',
            },
            { status: 202 },
          );
        }
        if (
          target.includes('/agents') &&
          !target.includes('/commands') &&
          !target.includes('/run') &&
          !target.includes('/prompts')
        ) {
          return okJson({ agents: [{ name: 'coding_agent' }] });
        }
        if (target.includes('/agents/coding_agent/commands')) {
          return okJson({ commands: [] });
        }
        if (target.includes('/conversations')) return okJson({ items: [] });
        return okJson({});
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([url]) =>
          (typeof url === 'string' ? url : url.toString()).includes(
            '/agents/coding_agent/commands',
          ),
        ),
      ).toBe(true),
    );

    const workingFolder = await screen.findByTestId('agent-working-folder');
    await user.type(workingFolder, '/commit/only');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([url]) =>
          (typeof url === 'string' ? url : url.toString()).includes(
            '/agents/coding_agent/prompts',
          ),
        ),
      ).toBe(true),
    );
    expect(runBodies).toHaveLength(0);
  });
});
