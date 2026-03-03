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

function setupPromptUiFetch(params: {
  promptsByFolder: Record<
    string,
    | {
        status: 'success';
        prompts: Array<{ relativePath: string; fullPath: string }>;
      }
    | { status: 'error'; httpStatus?: number; payload: Record<string, unknown> }
  >;
}) {
  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const target = typeof url === 'string' ? url : url.toString();
    if (target.includes('/health')) return okJson({ mongoConnected: true });
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
    if (target.includes('/ingest/dirs')) {
      const parsed = new URL(target);
      const path = parsed.searchParams.get('path') ?? '/';
      return okJson({
        base: '/',
        path,
        dirs: ['picker-folder'],
      });
    }
    if (target.includes('/agents/coding_agent/prompts')) {
      const folder = new URL(target).searchParams.get('working_folder') ?? '';
      const response = params.promptsByFolder[folder];
      if (!response) return okJson({ prompts: [] });
      if (response.status === 'error') {
        return Promise.resolve({
          ok: false,
          status: response.httpStatus ?? 400,
          headers: { get: () => 'application/json' },
          json: async () => response.payload,
        } as Response);
      }
      return okJson({ prompts: response.prompts });
    }
    return okJson({});
  });
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

describe('Agents page - prompts selector state transitions', () => {
  async function selectPromptOption(
    user: ReturnType<typeof userEvent.setup>,
    optionLabel: string,
  ) {
    const promptsSelect = await screen.findByRole('combobox', {
      name: /prompts/i,
    });
    await user.click(promptsSelect);
    await user.click(await screen.findByRole('option', { name: optionLabel }));
  }

  async function commitWorkingFolderByEnter(
    user: ReturnType<typeof userEvent.setup>,
    value: string,
  ) {
    const input = await screen.findByTestId('agent-working-folder');
    await user.clear(input);
    await user.type(input, value);
    await user.keyboard('{Enter}');
  }

  it('shows prompts row for prompts/error outcomes and hides it for zero-result discovery', async () => {
    setupPromptUiFetch({
      promptsByFolder: {
        '/with-prompts': {
          status: 'success',
          prompts: [
            { relativePath: 'onboarding/start.md', fullPath: '/x/start.md' },
          ],
        },
        '/with-error': {
          status: 'error',
          payload: {
            error: 'invalid_request',
            code: 'WORKING_FOLDER_NOT_FOUND',
            message: 'working_folder not found',
          },
        },
        '/with-zero': { status: 'success', prompts: [] },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/with-prompts');
    expect(await screen.findByTestId('agent-prompts-row')).toBeInTheDocument();
    expect(
      await screen.findByTestId('agent-prompts-select'),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('agent-prompt-execute'),
    ).toBeInTheDocument();

    await commitWorkingFolderByBlur('/with-error');
    expect(await screen.findByTestId('agent-prompts-row')).toBeInTheDocument();
    expect(
      await screen.findByTestId('agent-prompts-error'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('agent-prompts-select'),
    ).not.toBeInTheDocument();

    await commitWorkingFolderByBlur('/with-zero');
    await waitFor(() =>
      expect(screen.queryByTestId('agent-prompts-row')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('agent-prompts-error')).not.toBeInTheDocument();
  });

  it('renders relative-path labels and explicit No prompt selected option', async () => {
    const user = userEvent.setup();
    setupPromptUiFetch({
      promptsByFolder: {
        '/labels-folder': {
          status: 'success',
          prompts: [
            { relativePath: 'alpha/start.md', fullPath: '/abs/alpha/start.md' },
            { relativePath: 'beta/guide.md', fullPath: '/abs/beta/guide.md' },
          ],
        },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/labels-folder');

    const promptsSelect = await screen.findByRole('combobox', {
      name: /prompts/i,
    });
    await user.click(promptsSelect);
    expect(
      await screen.findByRole('option', { name: 'No prompt selected' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('option', { name: 'alpha/start.md' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('option', { name: 'beta/guide.md' }),
    ).toBeInTheDocument();
  });

  it('never renders fullPath values as visible prompt option labels', async () => {
    const user = userEvent.setup();
    const leakedFullPath = '/absolute/runtime/.github/prompts/secret/path.md';
    setupPromptUiFetch({
      promptsByFolder: {
        '/privacy-folder': {
          status: 'success',
          prompts: [
            { relativePath: 'secret/path.md', fullPath: leakedFullPath },
          ],
        },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/privacy-folder');

    const promptsSelect = await screen.findByRole('combobox', {
      name: /prompts/i,
    });
    await user.click(promptsSelect);
    expect(
      await screen.findByRole('option', { name: 'secret/path.md' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(leakedFullPath)).not.toBeInTheDocument();
  });

  it('resets prompt selection immediately on committed folder changes from Enter and picker', async () => {
    const user = userEvent.setup();
    setupPromptUiFetch({
      promptsByFolder: {
        '/folder-a': {
          status: 'success',
          prompts: [{ relativePath: 'a.md', fullPath: '/folder-a/a.md' }],
        },
        '/folder-b': {
          status: 'success',
          prompts: [{ relativePath: 'b.md', fullPath: '/folder-b/b.md' }],
        },
        '/folder-b/picker-folder': {
          status: 'success',
          prompts: [
            {
              relativePath: 'picked.md',
              fullPath: '/folder-b/picker-folder/picked.md',
            },
          ],
        },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/folder-a');
    await selectPromptOption(user, 'a.md');
    expect(await screen.findByTestId('agent-prompt-execute')).toBeEnabled();

    await commitWorkingFolderByEnter(user, '/folder-b');
    await waitFor(() =>
      expect(screen.getByTestId('agent-prompt-execute')).toBeDisabled(),
    );
    expect(
      screen.getByRole('combobox', { name: /prompts/i }),
    ).toHaveTextContent('No prompt selected');

    await user.click(await screen.findByTestId('agent-working-folder-picker'));
    await user.click(
      await screen.findByRole('button', { name: 'picker-folder' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Use this folder' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Choose folder…' }),
      ).not.toBeInTheDocument(),
    );
    const executeButtonAfterPicker = screen.queryByTestId('agent-prompt-execute');
    if (executeButtonAfterPicker) {
      expect(executeButtonAfterPicker).toBeDisabled();
      expect(
        screen.getByRole('combobox', { name: /prompts/i }),
      ).toHaveTextContent('No prompt selected');
    } else {
      expect(screen.queryByTestId('agent-prompts-row')).not.toBeInTheDocument();
    }
  });

  it('hides prompts row and clears error when committed working folder is cleared', async () => {
    const user = userEvent.setup();
    setupPromptUiFetch({
      promptsByFolder: {
        '/error-folder': {
          status: 'error',
          payload: {
            error: 'invalid_request',
            code: 'WORKING_FOLDER_NOT_FOUND',
            message: 'working_folder not found',
          },
        },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/error-folder');
    expect(
      await screen.findByTestId('agent-prompts-error'),
    ).toBeInTheDocument();

    const input = await screen.findByTestId('agent-working-folder');
    await user.clear(input);
    fireEvent.blur(input);

    await waitFor(() =>
      expect(screen.queryByTestId('agent-prompts-row')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('agent-prompts-error')).not.toBeInTheDocument();
  });

  it('enables Execute Prompt only when a valid prompt option is selected', async () => {
    const user = userEvent.setup();
    setupPromptUiFetch({
      promptsByFolder: {
        '/enable-folder': {
          status: 'success',
          prompts: [
            { relativePath: 'enable.md', fullPath: '/enable-folder/enable.md' },
          ],
        },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/enable-folder');

    const executeButton = await screen.findByTestId('agent-prompt-execute');
    expect(executeButton).toBeDisabled();
    await selectPromptOption(user, 'enable.md');
    expect(executeButton).toBeEnabled();
  });

  it('disables Execute Prompt again when No prompt selected is chosen after a valid selection', async () => {
    const user = userEvent.setup();
    setupPromptUiFetch({
      promptsByFolder: {
        '/clear-option-folder': {
          status: 'success',
          prompts: [
            {
              relativePath: 'choose-me.md',
              fullPath: '/clear-option/choose-me.md',
            },
          ],
        },
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /agent/i });
    await commitWorkingFolderByBlur('/clear-option-folder');

    const executeButton = await screen.findByTestId('agent-prompt-execute');
    await selectPromptOption(user, 'choose-me.md');
    expect(executeButton).toBeEnabled();
    await selectPromptOption(user, 'No prompt selected');
    expect(executeButton).toBeDisabled();
  });
});
