import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { setupChatWsHarness } from './support/mockChatWs';
const mockFetch = jest.fn<typeof fetch>();
beforeAll(() => {
  global.fetch = mockFetch;
});
beforeEach(() => {
  setScopedTestEnvValue('MODE', 'test');
  mockFetch.mockReset();
  (
    globalThis as unknown as {
      __wsMock?: {
        reset: () => void;
      };
    }
  ).__wsMock?.reset();
  window.localStorage.clear();
  window.sessionStorage.clear();
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
function mockJsonResponse(
  payload: unknown,
  init?: {
    status?: number;
  },
) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}
function mockDailyFlowListOrDetailsResponse(
  target: string,
  flows: Array<{
    name: string;
    description: string;
    disabled: boolean;
    sourceId?: string;
    sourceLabel?: string;
  }> = [{ name: 'daily', description: 'Daily flow', disabled: false }],
) {
  if (!target.includes('/flows') || target.includes('/run')) {
    return null;
  }
  if (target.includes('/flows/daily')) {
    const dailyFlow = flows.find((flow) => flow.name === 'daily') ?? {
      name: 'daily',
      description: 'Daily flow',
      disabled: false,
    };
    return mockJsonResponse({
      flow: {
        name: dailyFlow.name,
        description: dailyFlow.description,
        disabled: dailyFlow.disabled,
        warnings: [],
        sourceId: dailyFlow.sourceId,
        sourceLabel: dailyFlow.sourceLabel,
      },
    });
  }
  return mockJsonResponse({ flows });
}
function mockFlowsFetch(options?: {
  dirs?: typeof defaultDirs | ((path: string | undefined) => unknown) | unknown;
}) {
  mockFetch.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof url === 'string'
        ? url
        : url instanceof URL
          ? url.toString()
          : 'url' in url && typeof url.url === 'string'
            ? url.url
            : url.toString();
    const method =
      init?.method ??
      (typeof url === 'object' &&
      url !== null &&
      'method' in url &&
      typeof url.method === 'string'
        ? url.method
        : undefined);
    if (target.includes('/health')) {
      return mockJsonResponse({ mongoConnected: true });
    }
    const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
    if (flowListOrDetails) {
      return flowListOrDetails;
    }
    if (target.includes('/conversations/') && target.includes('/turns')) {
      return mockJsonResponse({ items: [] });
    }
    if (
      target.includes('/conversations/') &&
      target.includes('/working-folder') &&
      method === 'POST'
    ) {
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      const workingFolder =
        typeof body.workingFolder === 'string' ? body.workingFolder : undefined;
      return mockJsonResponse({
        status: 'ok',
        conversation: {
          conversationId: 'flow-1',
          title: 'Flow: daily',
          provider: 'codex',
          model: 'gpt-5',
          source: 'REST',
          archived: false,
          flowName: 'daily',
          flags: workingFolder ? { workingFolder } : {},
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
      __wsMock?: {
        last: () => {
          _receive: (data: unknown) => void;
        } | null;
      };
    }
  ).__wsMock;
  const ws = wsRegistry?.last();
  if (!ws) throw new Error('No WebSocket instance; did FlowsPage mount?');
  act(() => {
    ws._receive(event);
  });
}
function emitInflightSnapshot(payload: {
  conversationId: string;
  inflightId: string | null;
}) {
  emitWsEvent({
    protocolVersion: 'v1',
    type: 'inflight_snapshot',
    conversationId: payload.conversationId,
    seq: 1,
    inflight: {
      inflightId: payload.inflightId ?? '',
      assistantText: '',
      assistantThink: '',
      toolEvents: [],
      startedAt: '2025-01-01T00:00:00.000Z',
    },
  });
}
async function selectFirstConversation() {
  const rows = await screen.findAllByTestId('conversation-row');
  await userEvent.click(rows[0]);
}
async function openFlowInfoSurface() {
  await userEvent.click(await screen.findByTestId('flow-info'));
  return screen.findByTestId('flow-info-popover');
}
async function selectDailyFlow() {
  const flowTrigger = await screen.findByTestId('flow-select-trigger');
  await waitFor(() => expect(flowTrigger).toBeEnabled());
  await userEvent.click(flowTrigger);
  const flowPopover = await screen.findByTestId('flow-select-popover');
  await userEvent.click(
    within(flowPopover).getByTestId('flow-option-daily::local'),
  );
  await waitFor(() => expect(flowTrigger).toHaveTextContent('daily'));
}
async function waitForFlowTitle(title: string) {
  await waitFor(() =>
    expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent(title),
  );
}
function setupFlowsRunHarness(options?: {
  conversations?: unknown;
  turns?: unknown;
  flows?: unknown;
  runResponse?: unknown;
  health?: unknown;
}) {
  const now = new Date('2025-01-01T00:00:00.000Z').toISOString();
  const conversations = (options?.conversations ?? {
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
    nextCursor: null,
  }) as Record<string, unknown>;
  const workingFolderBodies: Array<Record<string, unknown>> = [];
  const harness = setupChatWsHarness({
    mockFetch,
    health: (options?.health ?? { mongoConnected: true }) as Record<
      string,
      unknown
    >,
    conversations,
    turns: (options?.turns ?? { items: [], nextCursor: null }) as Record<
      string,
      unknown
    >,
    fallbackFetch: (url, init) => {
      const target =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : 'url' in url && typeof url.url === 'string'
              ? url.url
              : url.toString();
      const method =
        init?.method ??
        (typeof url === 'object' &&
        url !== null &&
        'method' in url &&
        typeof url.method === 'string'
          ? url.method
          : undefined);
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(
        target,
        (options?.flows ?? [
          { name: 'daily', description: 'Daily flow', disabled: false },
        ]) as Array<{
          name: string;
          description: string;
          disabled: boolean;
          sourceId?: string;
          sourceLabel?: string;
        }>,
      );
      if (flowListOrDetails) {
        return flowListOrDetails;
      }
      if (target.includes('/flows/daily/run')) {
        return mockJsonResponse(
          options?.runResponse ?? {
            status: 'started',
            flowName: 'daily',
            conversationId: 'flow-1',
            inflightId: 'i1',
            providerId: 'codex',
            modelId: 'gpt-5',
          },
        );
      }
      if (
        target.includes('/conversations/') &&
        target.includes('/working-folder') &&
        method === 'POST'
      ) {
        const body =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        workingFolderBodies.push(body);
        const workingFolder =
          typeof body.workingFolder === 'string'
            ? body.workingFolder
            : undefined;
        return mockJsonResponse({
          status: 'ok',
          conversation: {
            conversationId: 'flow-1',
            title: 'Flow: daily',
            provider: 'codex',
            model: 'gpt-5',
            source: 'REST',
            archived: false,
            flowName: 'daily',
            flags: workingFolder ? { workingFolder } : {},
          },
        });
      }
      return mockJsonResponse({});
    },
  });
  return {
    ...harness,
    workingFolderBodies,
  };
}
describe('Flows page run/resume controls', () => {
  it('renders the custom title input', async () => {
    mockFlowsFetch();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    const customTitleInput = await screen.findByTestId('flow-custom-title');
    expect(customTitleInput).toBeInTheDocument();
  });
  it('renders existing flow transcript turns in chronological top-to-bottom order', async () => {
    setupFlowsRunHarness({
      turns: {
        items: [
          {
            turnId: 'turn-1',
            conversationId: 'flow-1',
            role: 'user',
            content: 'Reply with a short greeting.',
            provider: 'codex',
            model: 'gpt-5',
            status: 'ok',
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          {
            turnId: 'turn-2',
            conversationId: 'flow-1',
            role: 'assistant',
            content: 'Hello. No tools were used.',
            provider: 'codex',
            model: 'gpt-5',
            status: 'ok',
            createdAt: '2025-01-01T00:00:01.000Z',
          },
        ],
        nextCursor: null,
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await selectFirstConversation();
    const transcript = await screen.findByTestId('flows-transcript');
    await waitFor(() =>
      expect(screen.getAllByTestId('chat-bubble')).toHaveLength(2),
    );
    const older = within(transcript).getByText('Reply with a short greeting.');
    const newer = within(transcript).getByText('Hello. No tools were used.');
    expect(
      older.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it('disables the custom title input during resume and inflight states', async () => {
    const now = new Date().toISOString();
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.toString()
              : 'url' in url && typeof url.url === 'string'
                ? url.url
                : url.toString();
        const method =
          init?.method ??
          (typeof url === 'object' &&
          url !== null &&
          'method' in url &&
          typeof url.method === 'string'
            ? url.method
            : undefined);
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
        if (flowListOrDetails) {
          return flowListOrDetails;
        }
        if (target.includes('/conversations/') && target.includes('/turns')) {
          return mockJsonResponse({ items: [] });
        }
        if (
          target.includes('/conversations/') &&
          target.includes('/working-folder') &&
          method === 'POST'
        ) {
          const body =
            typeof init?.body === 'string'
              ? (JSON.parse(init.body) as Record<string, unknown>)
              : {};
          const workingFolder =
            typeof body.workingFolder === 'string'
              ? body.workingFolder
              : undefined;
          return mockJsonResponse({
            status: 'ok',
            conversation: {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              archived: false,
              flowName: 'daily',
              flags: workingFolder ? { workingFolder } : {},
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
                flags: { flow: { stepPath: [1] } },
              },
            ],
          });
        }
        return mockJsonResponse({});
      },
    );
    const resumeRouter = createMemoryRouter(routes, {
      initialEntries: ['/flows'],
    });
    const { unmount } = render(<RouterProvider router={resumeRouter} />);
    await selectFirstConversation();
    const resumeTitleInput = await screen.findByTestId('flow-custom-title');
    await waitFor(() => expect(resumeTitleInput).toBeDisabled());
    unmount();
    let resolveRun: ((value: Response) => void) | undefined;
    const runPromise = new Promise<Response>((resolve) => {
      resolveRun = resolve;
    });
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
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
      if (target.includes('/flows/daily/run')) {
        return runPromise;
      }
      return mockJsonResponse({});
    });
    const runRouter = createMemoryRouter(routes, {
      initialEntries: ['/flows'],
    });
    render(<RouterProvider router={runRouter} />);
    await selectFirstConversation();
    const runTitleInput = await screen.findByTestId('flow-custom-title');
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await act(async () => {
      fireEvent.click(runButton);
    });
    await waitFor(() => expect(runTitleInput).toBeDisabled());
    if (!resolveRun) {
      throw new Error('Expected flow run promise resolver to be assigned');
    }
    const completeRun = resolveRun;
    await act(async () => {
      completeRun(
        new Response(
          JSON.stringify({
            status: 'started',
            flowName: 'daily',
            conversationId: 'flow-1',
            inflightId: 'i1',
            providerId: 'codex',
            modelId: 'gpt-5',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });
  });
  it('resumes a flow with working folder and selected conversation id', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
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
              flags: { flow: { stepPath: [1] } },
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
          providerId: 'codex',
          modelId: 'gpt-5',
        });
      }
      return mockJsonResponse({});
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await selectFirstConversation();
    const workingFolderInput = await screen.findByTestId('flow-working-folder');
    fireEvent.change(workingFolderInput, { target: { value: '/tmp/work' } });
    const resumeButton = await screen.findByTestId('flow-resume');
    await waitFor(() => expect(resumeButton).toBeEnabled());
    await user.click(resumeButton);
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
  it('still starts a fresh run when flow details fail to load but the summary stays enabled', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        if (target.includes('/flows/daily/run')) {
          return mockJsonResponse(
            {
              status: 'started',
              flowName: 'daily',
              conversationId: 'flow-fresh-1',
              inflightId: 'i1',
              providerId: 'codex',
              modelId: 'gpt-5',
            },
            { status: 202 },
          );
        }
        if (target.includes('/flows/daily')) {
          return mockJsonResponse(
            { error: 'flow_details_failed' },
            { status: 500 },
          );
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
        if (target.includes('/flows')) {
          return mockJsonResponse({
            flows: [
              { name: 'daily', description: 'Daily flow', disabled: false },
            ],
          });
        }
        if (
          target.includes('/conversations/') &&
          target.includes('/working-folder') &&
          init?.method === 'POST'
        ) {
          return mockJsonResponse({
            status: 'ok',
            conversation: {
              conversationId: 'flow-fresh-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              archived: false,
              flowName: 'daily',
              flags: {},
            },
          });
        }
        return mockJsonResponse({});
      },
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await selectFirstConversation();
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await waitFor(() => {
      const runCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('/flows/daily/run'),
      );
      expect(runCall).toBeTruthy();
    });
    expect(screen.queryByTestId('flows-run-error')).not.toBeInTheDocument();
  });
  it('still resumes when flow details fail to load but the summary stays enabled', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        if (target.includes('/flows/daily/run')) {
          return mockJsonResponse(
            {
              status: 'started',
              flowName: 'daily',
              conversationId: 'flow-1',
              inflightId: 'i1',
              providerId: 'codex',
              modelId: 'gpt-5',
            },
            { status: 202 },
          );
        }
        if (target.includes('/flows/daily')) {
          return mockJsonResponse(
            { error: 'flow_details_failed' },
            { status: 500 },
          );
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
                flags: { flow: { stepPath: [1] } },
              },
            ],
          });
        }
        if (target.includes('/flows')) {
          return mockJsonResponse({
            flows: [
              { name: 'daily', description: 'Daily flow', disabled: false },
            ],
          });
        }
        if (
          target.includes('/conversations/') &&
          target.includes('/working-folder') &&
          init?.method === 'POST'
        ) {
          return mockJsonResponse({
            status: 'ok',
            conversation: {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              archived: false,
              flowName: 'daily',
              flags: { flow: { stepPath: [1] } },
            },
          });
        }
        return mockJsonResponse({});
      },
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await selectFirstConversation();
    const resumeButton = await screen.findByTestId('flow-resume');
    await waitFor(() => expect(resumeButton).toBeEnabled());
    await user.click(resumeButton);
    await waitFor(() => {
      const runCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('/flows/daily/run'),
      );
      expect(runCall).toBeTruthy();
    });
    expect(screen.queryByTestId('flows-run-error')).not.toBeInTheDocument();
  });
  it('clears stale launch state during a fresh pending run and repopulates providerId and warnings from the first response', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    let runRequestCount = 0;
    let resolveSecondRun: ((response: Response) => void) | null = null;
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
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
        runRequestCount += 1;
        if (runRequestCount === 1) {
          return mockJsonResponse(
            {
              error: 'provider_unavailable',
              code: 'PROVIDER_UNAVAILABLE',
              reason: 'First provider unavailable.',
            },
            { status: 503 },
          );
        }
        return new Promise<Response>((resolve) => {
          resolveSecondRun = resolve;
        });
      }
      return mockJsonResponse({});
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await selectFirstConversation();
    expect(await screen.findByTestId('flow-info')).toBeEnabled();
    const infoPopover = await openFlowInfoSurface();
    expect(
      within(await infoPopover).getByTestId('composer-info-section-runtime'),
    ).toHaveTextContent('Providercodex');
    expect(
      within(await infoPopover).getByTestId('composer-info-section-runtime'),
    ).toHaveTextContent('Modelgpt-5');
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    const firstError = await screen.findByTestId('flows-run-error');
    expect(firstError).toHaveTextContent('First provider unavailable.');
    expect(firstError).toHaveAttribute(
      'data-error-code',
      'PROVIDER_UNAVAILABLE',
    );
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await waitFor(() =>
      expect(screen.queryByTestId('flows-run-error')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId('flows-launch-warnings'),
    ).not.toBeInTheDocument();
    if (!resolveSecondRun) {
      throw new Error('Expected the second flow run promise resolver');
    }
    await act(async () => {
      resolveSecondRun?.(
        new Response(
          JSON.stringify({
            status: 'started',
            flowName: 'daily',
            conversationId: 'flow-2',
            inflightId: 'i2',
            providerId: 'lmstudio',
            modelId: 'model-1',
            warnings: ['fell back to provider "lmstudio"'],
          }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });
    await waitFor(() =>
      expect(
        within(screen.getByTestId('flow-info-popover')).getByTestId(
          'composer-info-section-runtime',
        ),
      ).toHaveTextContent('Providerlmstudio'),
    );
    expect(
      within(screen.getByTestId('flow-info-popover')).getByTestId(
        'composer-info-section-runtime',
      ),
    ).toHaveTextContent('Modelmodel-1');
    expect(screen.getByTestId('flows-launch-warnings')).toHaveTextContent(
      'fell back to provider "lmstudio"',
    );
  });
  it('starts a fresh run with a new conversation id and preserved custom title even when an older flow conversation is selected', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
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
        const body =
          mockFetch.mock.calls.at(-1)?.[1]?.body &&
          typeof mockFetch.mock.calls.at(-1)?.[1]?.body === 'string'
            ? (JSON.parse(
                mockFetch.mock.calls.at(-1)?.[1]?.body as string,
              ) as Record<string, unknown>)
            : {};
        return mockJsonResponse({
          status: 'started',
          flowName: 'daily',
          conversationId:
            typeof body.conversationId === 'string'
              ? body.conversationId
              : 'fresh-flow-1',
          inflightId: 'i1',
          providerId: 'codex',
          modelId: 'gpt-5',
        });
      }
      return mockJsonResponse({});
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await selectDailyFlow();
    await selectFirstConversation();
    await user.type(
      await screen.findByTestId('flow-custom-title'),
      'Daily recap',
    );
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await waitFor(() => {
      const runCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('/flows/daily/run'),
      );
      expect(runCall).toBeTruthy();
      const [, init] = runCall as [unknown, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.conversationId).not.toBe('flow-1');
      expect(body.customTitle).toBe('Daily recap');
    });
  });
  it('keeps the accepted flow conversation selected when the follow-up refresh fails', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    const acceptedConversationId = 'flow-accepted-1';
    let conversationsFetchCount = 0;
    mockFetch.mockImplementation(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const target =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.toString()
              : 'url' in url && typeof url.url === 'string'
                ? url.url
                : url.toString();
        const method =
          init?.method ??
          (typeof url === 'object' &&
          url !== null &&
          'method' in url &&
          typeof url.method === 'string'
            ? url.method
            : undefined);
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
        if (flowListOrDetails) {
          return flowListOrDetails;
        }
        if (target.includes('/conversations/flow-1/turns')) {
          return mockJsonResponse({
            items: [
              {
                conversationId: 'flow-1',
                role: 'assistant',
                content: 'Original flow answer',
                model: 'gpt-5',
                provider: 'codex',
                status: 'ok',
                createdAt: now,
              },
            ],
          });
        }
        if (target.includes(`/conversations/${acceptedConversationId}/turns`)) {
          return mockJsonResponse({
            items: [
              {
                conversationId: acceptedConversationId,
                role: 'assistant',
                content: 'Accepted flow answer',
                model: 'gpt-5',
                provider: 'codex',
                status: 'ok',
                createdAt: now,
              },
            ],
          });
        }
        if (
          target.includes('/conversations/') &&
          target.includes('/working-folder') &&
          method === 'POST'
        ) {
          return mockJsonResponse({
            status: 'ok',
            conversation: {
              conversationId: 'flow-1',
              title: 'Flow: echo',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              archived: false,
              flowName: 'echo',
              flags: {},
            },
          });
        }
        if (target.includes('/conversations') && !target.includes('/turns')) {
          conversationsFetchCount += 1;
          if (conversationsFetchCount >= 2) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  error: 'conversation refresh failed',
                }),
                {
                  status: 500,
                  headers: { 'content-type': 'application/json' },
                },
              ),
            );
          }
          return mockJsonResponse({
            items: [
              {
                conversationId: 'flow-1',
                title: 'Flow: echo',
                provider: 'codex',
                model: 'gpt-5',
                source: 'REST',
                lastMessageAt: now,
                archived: false,
                flowName: 'echo',
                flags: {},
              },
            ],
          });
        }
        if (target.includes('/flows/daily/run')) {
          return mockJsonResponse(
            {
              status: 'started',
              flowName: 'daily',
              conversationId: acceptedConversationId,
              inflightId: 'flow-inflight-accepted',
              providerId: 'codex',
              modelId: 'gpt-5',
            },
            { status: 202 },
          );
        }
        return mockJsonResponse({});
      },
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await selectDailyFlow();
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await waitFor(() =>
      expect(screen.queryByTestId('flows-run-error')).not.toBeInTheDocument(),
    );
    const transcript = await screen.findByTestId('flows-transcript');
    await waitFor(
      () => expect(transcript).toHaveTextContent('Accepted flow answer'),
      { timeout: 5000 },
    );
    await waitFor(() =>
      expect(screen.getByTestId('conversation-error')).toBeInTheDocument(),
    );
  });
  it('omits stale customTitle when Run starts fresh from a resumable selected conversation', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
      }
      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }
      if (target.includes('/conversations')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-resume-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: now,
              archived: false,
              flowName: 'daily',
              flags: {
                flow: {
                  stepPath: [0, 1],
                },
              },
            },
          ],
        });
      }
      if (target.includes('/flows/daily/run')) {
        const body =
          mockFetch.mock.calls.at(-1)?.[1]?.body &&
          typeof mockFetch.mock.calls.at(-1)?.[1]?.body === 'string'
            ? (JSON.parse(
                mockFetch.mock.calls.at(-1)?.[1]?.body as string,
              ) as Record<string, unknown>)
            : {};
        return mockJsonResponse({
          status: 'started',
          flowName: 'daily',
          conversationId:
            typeof body.conversationId === 'string'
              ? body.conversationId
              : 'fresh-flow-1',
          inflightId: 'i1',
          providerId: 'codex',
          modelId: 'gpt-5',
        });
      }
      return mockJsonResponse({});
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await selectDailyFlow();
    const titleInput = await screen.findByTestId('flow-custom-title');
    await user.click(screen.getByTestId('flow-new'));
    await waitFor(() => expect(titleInput).toBeEnabled());
    await user.type(titleInput, 'Should not leak');
    await selectFirstConversation();
    await waitFor(() => expect(titleInput).toBeDisabled());
    await user.click(screen.getByTestId('flow-new'));
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await waitFor(() => {
      const runCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('/flows/daily/run'),
      );
      expect(runCall).toBeTruthy();
      const [, init] = runCall as [unknown, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.conversationId).not.toBe('flow-resume-1');
      expect(body.customTitle).toBeUndefined();
    });
  });
  it('includes customTitle when starting a new flow run', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
      }
      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }
      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }
      if (target.includes('/flows/daily/run')) {
        return mockJsonResponse({
          status: 'started',
          flowName: 'daily',
          conversationId: 'flow-1',
          inflightId: 'i1',
          providerId: 'codex',
          modelId: 'gpt-5',
        });
      }
      return mockJsonResponse({});
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    const titleInput = await screen.findByTestId('flow-custom-title');
    await waitFor(() => expect(screen.getByTestId('flow-new')).toBeEnabled());
    await user.click(screen.getByTestId('flow-new'));
    await waitFor(() => expect(titleInput).toBeEnabled());
    await user.type(titleInput, 'Daily recap');
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await waitFor(() => {
      const runCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('/flows/daily/run'),
      );
      expect(runCall).toBeTruthy();
      const [, init] = runCall as [unknown, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.customTitle).toBe('Daily recap');
    });
  });
  it('blocks same-frame duplicate fresh runs, mints one client conversation id, and re-enables retry after resolve', async () => {
    const user = userEvent.setup();
    let resolveRun: ((value: Response) => void) | undefined;
    const runPromise = new Promise<Response>((resolve) => {
      resolveRun = resolve;
    });
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
      }
      if (target.includes('/conversations/') && target.includes('/turns')) {
        return mockJsonResponse({ items: [] });
      }
      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }
      if (target.includes('/flows/daily/run')) {
        return runPromise;
      }
      return mockJsonResponse({});
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await act(async () => {
      fireEvent.click(runButton);
      fireEvent.click(runButton);
    });
    await waitFor(() => {
      const runCalls = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('/flows/daily/run'),
      );
      expect(runCalls).toHaveLength(1);
    });
    const firstRunCall = mockFetch.mock.calls.find(([url]) =>
      String(url).includes('/flows/daily/run'),
    );
    expect(firstRunCall).toBeTruthy();
    const [, firstInit] = firstRunCall as [unknown, RequestInit];
    const firstBody = JSON.parse(firstInit.body as string) as Record<
      string,
      unknown
    >;
    expect(typeof firstBody.conversationId).toBe('string');
    expect(firstBody.conversationId).not.toBe('');
    const completeRun = resolveRun;
    if (!completeRun) {
      throw new Error('Expected fresh flow run promise resolver to be set');
    }
    await act(async () => {
      completeRun(
        new Response(
          JSON.stringify({
            status: 'started',
            flowName: 'daily',
            conversationId: 'fresh-flow-1',
            inflightId: 'i1',
            providerId: 'codex',
            modelId: 'gpt-5',
          }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await waitFor(() => {
      const runCalls = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('/flows/daily/run'),
      );
      expect(runCalls).toHaveLength(2);
    });
    const secondRunCall = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('/flows/daily/run'),
    )[1];
    expect(secondRunCall).toBeTruthy();
    const [, secondInit] = secondRunCall as [unknown, RequestInit];
    const secondBody = JSON.parse(secondInit.body as string) as Record<
      string,
      unknown
    >;
    expect(secondBody.conversationId).toBeDefined();
    expect(secondBody.conversationId).not.toBe(firstBody.conversationId);
  });
  it('keeps one retry ownership token across an ambiguous fresh-run failure and reuses it on the retry', async () => {
    const user = userEvent.setup();
    const flowRows: Array<Record<string, unknown>> = [];
    const requestBodies: Record<string, unknown>[] = [];
    let acceptedConversationId: string | null = null;
    mockFetch.mockImplementation(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const target =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.toString()
              : 'url' in url && typeof url.url === 'string'
                ? url.url
                : url.toString();
        const method =
          init?.method ??
          (typeof url === 'object' &&
          url !== null &&
          'method' in url &&
          typeof url.method === 'string'
            ? url.method
            : undefined);
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        if (target.includes('/flows/echo?') || target.endsWith('/flows/echo')) {
          return mockJsonResponse({
            flow: {
              name: 'echo',
              description: 'Echo flow',
              disabled: false,
              warnings: [],
            },
          });
        }
        const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target, [
          { name: 'echo', description: 'Echo flow', disabled: false },
        ]);
        if (flowListOrDetails) {
          return flowListOrDetails;
        }
        if (target.includes('/conversations/') && target.includes('/turns')) {
          return mockJsonResponse({ items: [] });
        }
        if (
          target.includes('/conversations/') &&
          target.includes('/working-folder') &&
          method === 'POST'
        ) {
          return mockJsonResponse({
            status: 'ok',
            conversation: {
              conversationId: 'flow-1',
              title: 'Flow: echo',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              archived: false,
              flowName: 'echo',
              flags: {},
            },
          });
        }
        if (target.includes('/conversations')) {
          return mockJsonResponse({ items: flowRows });
        }
        if (target.includes('/flows/echo/run')) {
          const body =
            typeof init?.body === 'string'
              ? (JSON.parse(init.body) as Record<string, unknown>)
              : {};
          requestBodies.push(body);
          const runIndex = requestBodies.length;
          const freshConversationId =
            typeof body.conversationId === 'string'
              ? body.conversationId
              : `flow-run-${runIndex}`;
          if (runIndex === 1) {
            acceptedConversationId = freshConversationId;
            throw new TypeError('Network request lost after acceptance');
          }
          if (Array.isArray(body.resumeStepPath)) {
            return mockJsonResponse(
              {
                status: 'started',
                flowName: 'echo',
                conversationId: freshConversationId,
                inflightId: `i${runIndex}`,
                providerId: 'codex',
                modelId: 'gpt-5',
              },
              { status: 202 },
            );
          }
          const conversationId =
            runIndex === 2 && acceptedConversationId
              ? acceptedConversationId
              : freshConversationId;
          if (runIndex === 2) {
            flowRows.unshift({
              conversationId,
              title: 'Flow: echo',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: new Date().toISOString(),
              archived: false,
              flowName: 'echo',
              flags: {
                flow: {
                  executionId: 'run0002-execution-id',
                  stepPath: [0],
                },
              },
            });
          } else {
            flowRows.unshift({
              conversationId,
              title: 'Flow: echo',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              lastMessageAt: new Date().toISOString(),
              archived: false,
              flowName: 'echo',
              flags: {
                flow: {
                  executionId: `run000${runIndex}-execution-id`,
                  stepPath: [0],
                },
              },
            });
          }
          return mockJsonResponse(
            {
              status: 'started',
              flowName: 'echo',
              conversationId,
              inflightId: `flow-inflight-${runIndex}`,
              providerId: 'codex',
              modelId: 'gpt-5',
            },
            { status: 202 },
          );
        }
        return mockJsonResponse({});
      },
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await waitFor(() => expect(requestBodies).toHaveLength(1));
    expect(typeof requestBodies[0].retryOwnershipId).toBe('string');
    expect(requestBodies[0].retryOwnershipId).not.toBe('');
    expect(requestBodies[0]).not.toHaveProperty('resumeStepPath');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    await waitFor(() => expect(flowRows).toHaveLength(1));
    await waitFor(() => expect(requestBodies).toHaveLength(2));
    expect(requestBodies[0].retryOwnershipId).toBe(
      requestBodies[1].retryOwnershipId,
    );
    expect(requestBodies[1]).not.toHaveProperty('resumeStepPath');
    expect(flowRows).toHaveLength(1);
    await selectFirstConversation();
    await waitFor(() =>
      expect(screen.getByTestId('flow-resume')).toBeEnabled(),
    );
    await user.click(screen.getByTestId('flow-resume'));
    await waitFor(() => expect(requestBodies).toHaveLength(3));
    expect(requestBodies[2]).not.toHaveProperty('retryOwnershipId');
    await user.click(screen.getByTestId('flow-new'));
    await waitFor(() => expect(screen.getByTestId('flow-run')).toBeEnabled());
    await user.click(screen.getByTestId('flow-run'));
    await waitFor(() => expect(requestBodies).toHaveLength(4));
    expect(typeof requestBodies[3].retryOwnershipId).toBe('string');
    expect(requestBodies[3].retryOwnershipId).not.toBe('');
    expect(requestBodies[3].retryOwnershipId).not.toBe(
      requestBodies[1].retryOwnershipId,
    );
    await waitFor(() => expect(flowRows).toHaveLength(2));
  });
  it('does not clone stale transcript turns into a failed fresh run conversation', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
      }
      if (target.includes('/conversations/flow-1/turns')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              role: 'assistant',
              content: 'Earlier flow output',
              model: 'gpt-5',
              provider: 'codex',
              toolCalls: null,
              status: 'ok',
              createdAt: now,
            },
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
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: 'FLOW_FAILED',
              message: 'Flow request failed',
            }),
            {
              status: 500,
              headers: { 'content-type': 'application/json' },
            },
          ),
        );
      }
      return mockJsonResponse({});
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await selectFirstConversation();
    expect(await screen.findByText('Earlier flow output')).toBeInTheDocument();
    const runButton = await screen.findByTestId('flow-run');
    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);
    expect(await screen.findByText('Flow request failed')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Earlier flow output')).not.toBeInTheDocument(),
    );
  });
  it('keeps the earlier assistant bubble visible while the next flow step streams and stale earlier-step replays arrive', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const harness = setupFlowsRunHarness();
    try {
      const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
      render(<RouterProvider router={router} />);
      await waitForFlowTitle('Flow: daily');
      await waitFor(() =>
        expect(screen.getByTestId('flow-select')).toHaveValue('daily::local'),
      );
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        content: 'Run step one',
      });
      harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        delta: 'First step answer',
      });
      expect(await screen.findByText('First step answer')).toBeInTheDocument();
      expect(screen.queryByTestId('citations-toggle')).not.toBeInTheDocument();
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        content: 'Run step two',
      });
      expect(
        logSpy.mock.calls.find(([entry]) => {
          if (!entry || typeof entry !== 'object') return false;
          const record = entry as {
            message?: string;
            context?: Record<string, unknown>;
          };
          return record.message === 'flows.page.live_transcript_retained';
        }),
      ).toBeUndefined();
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        content: 'Run step one replay',
      });
      harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        delta: ' hidden',
      });
      harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        delta: 'Second step live',
      });
      expect(await screen.findByText('Second step live')).toBeInTheDocument();
      expect(screen.getByText('First step answer')).toBeInTheDocument();
      expect(screen.queryByText('Run step one replay')).not.toBeInTheDocument();
      expect(screen.queryByText('First step answer hidden')).toBeNull();
      expect(screen.getAllByTestId('assistant-markdown')).toHaveLength(2);
      const retainedLog = logSpy.mock.calls.find(([entry]) => {
        if (!entry || typeof entry !== 'object') return false;
        const record = entry as {
          message?: string;
          context?: Record<string, unknown>;
        };
        return record.message === 'flows.page.live_transcript_retained';
      });
      expect(retainedLog?.[0]).toMatchObject({
        message: 'flows.page.live_transcript_retained',
        context: expect.objectContaining({
          conversationId: 'flow-1',
          previousInflightId: 'flow-step-1',
          currentInflightId: 'flow-step-2',
          reason: 'next_step_started',
          proof: 'post_event_transcript_visible',
        }),
      });
      expect(logSpy.mock.calls).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({
              message: 'DEV-0000049:T05:flows_shared_transcript_rendered',
              context: expect.objectContaining({
                surface: 'flows',
                citationsVisible: false,
              }),
            }),
          ],
        ]),
      );
    } finally {
      logSpy.mockRestore();
    }
  });
  it('keeps the earlier flow bubble visible while the later step continues streaming its own text', async () => {
    const harness = setupFlowsRunHarness();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await waitFor(() =>
      expect(screen.getByTestId('flow-select')).toHaveValue('daily::local'),
    );
    harness.emitUserTurn({
      conversationId: 'flow-1',
      inflightId: 'flow-step-1',
      content: 'Run step one',
    });
    harness.emitAssistantDelta({
      conversationId: 'flow-1',
      inflightId: 'flow-step-1',
      delta: 'First step answer',
    });
    expect(await screen.findByText('First step answer')).toBeInTheDocument();
    harness.emitUserTurn({
      conversationId: 'flow-1',
      inflightId: 'flow-step-2',
      content: 'Run step two',
    });
    harness.emitAssistantDelta({
      conversationId: 'flow-1',
      inflightId: 'flow-step-2',
      delta: 'Second step',
    });
    harness.emitAssistantDelta({
      conversationId: 'flow-1',
      inflightId: 'flow-step-2',
      delta: ' still streaming',
    });
    expect(
      await screen.findByText('Second step still streaming'),
    ).toBeInTheDocument();
    expect(screen.getByText('First step answer')).toBeInTheDocument();
  });
  it('clears stale virtualized rows when switching from a populated flow conversation to an empty one', async () => {
    const user = userEvent.setup();
    const turnsByConversation: Record<
      string,
      {
        items: Record<string, unknown>[];
      }
    > = {
      'flow-1': {
        items: [
          {
            turnId: 'flow-user-1',
            conversationId: 'flow-1',
            role: 'user',
            content: 'Run step one',
            provider: 'codex',
            model: 'gpt-5',
            status: 'ok',
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          {
            turnId: 'flow-assistant-1',
            conversationId: 'flow-1',
            role: 'assistant',
            content: 'First step answer',
            provider: 'codex',
            model: 'gpt-5',
            status: 'ok',
            createdAt: '2025-01-01T00:00:01.000Z',
          },
        ],
      },
      'flow-2': { items: [] },
    };
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.toString()
              : 'url' in url && typeof url.url === 'string'
                ? url.url
                : url.toString();
        const method =
          init?.method ??
          (typeof url === 'object' &&
          url !== null &&
          'method' in url &&
          typeof url.method === 'string'
            ? url.method
            : undefined);
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
        if (flowListOrDetails) {
          return flowListOrDetails;
        }
        const turnsMatch = target.match(/\/conversations\/([^/]+)\/turns/);
        if (turnsMatch) {
          const conversationId = turnsMatch[1] ?? '';
          return mockJsonResponse({
            items: turnsByConversation[conversationId]?.items ?? [],
            nextCursor: null,
          });
        }
        if (
          target.includes('/conversations/') &&
          target.includes('/working-folder') &&
          method === 'POST'
        ) {
          return mockJsonResponse({
            status: 'ok',
            conversation: {
              conversationId: 'flow-1',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              source: 'REST',
              archived: false,
              flowName: 'daily',
              flags: {},
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
                lastMessageAt: '2025-01-01T00:00:01.000Z',
                archived: false,
                flowName: 'daily',
                flags: {},
              },
              {
                conversationId: 'flow-2',
                title: 'Flow: nightly',
                provider: 'codex',
                model: 'gpt-5',
                source: 'REST',
                lastMessageAt: '2025-01-01T00:10:00.000Z',
                archived: false,
                flowName: 'daily',
                flags: {},
              },
            ],
            nextCursor: null,
          });
        }
        return mockJsonResponse({});
      },
    );
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    const flowRows = await screen.findAllByTestId('conversation-row');
    const firstRow = flowRows.find((row) =>
      within(row).queryByText('Flow: daily'),
    );
    expect(firstRow).toBeTruthy();
    await user.click(firstRow!);
    expect(await screen.findByText('Run step one')).toBeInTheDocument();
    expect(await screen.findByText('First step answer')).toBeInTheDocument();
    const secondConversation = await screen.findByText('Flow: nightly');
    const secondRow = secondConversation.closest(
      '[data-testid="conversation-row"]',
    );
    expect(secondRow).toBeTruthy();
    await user.click(secondRow!);
    await waitFor(() => {
      expect(screen.queryByText('Run step one')).toBeNull();
      expect(screen.queryByText('First step answer')).toBeNull();
      expect(screen.queryAllByTestId('chat-bubble')).toHaveLength(0);
    });
  });
  it('keeps visible transcript text if a flow refresh temporarily omits the active conversation while streaming', async () => {
    const user = userEvent.setup();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const now = new Date('2025-01-01T00:00:00.000Z').toISOString();
    let conversationsRequestCount = 0;
    let runRequested = false;
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
        if (flowListOrDetails) {
          return flowListOrDetails;
        }
        if (target.includes('/conversations/flow-1/turns')) {
          return mockJsonResponse({
            items: [
              {
                turnId: 't1',
                conversationId: 'flow-1',
                role: 'assistant',
                content: 'Earlier output',
                provider: 'codex',
                model: 'gpt-5',
                status: 'ok',
                createdAt: now,
              },
            ],
          });
        }
        if (target.includes('/conversations') && init?.method !== 'POST') {
          conversationsRequestCount += 1;
          if (!runRequested || conversationsRequestCount < 3) {
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
                  flags: { flow: { stepPath: [1] } },
                },
              ],
            });
          }
          return mockJsonResponse({ items: [] });
        }
        if (target.includes('/flows/daily/run')) {
          runRequested = true;
          return mockJsonResponse({
            status: 'started',
            flowName: 'daily',
            conversationId: 'flow-1',
            inflightId: 'flow-step-2',
            providerId: 'codex',
            modelId: 'gpt-5',
          });
        }
        return mockJsonResponse({});
      },
    );
    try {
      const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
      render(<RouterProvider router={router} />);
      expect(await screen.findByText('Earlier output')).toBeInTheDocument();
      const resumeButton = await screen.findByTestId('flow-resume');
      await waitFor(() => expect(resumeButton).toBeEnabled());
      await user.click(resumeButton);
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        seq: 1,
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        content: 'Continue flow',
        createdAt: now,
      });
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        seq: 2,
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        delta: 'Latest live output',
      });
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        seq: 3,
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        delta: ' still running',
      });
      expect(await screen.findByText('Earlier output')).toBeInTheDocument();
      expect(
        await screen.findByText('Latest live output still running'),
      ).toBeInTheDocument();
      expect(screen.getAllByTestId('assistant-markdown')).toHaveLength(2);
      const hiddenLogs = logSpy.mock.calls.filter(([entry]) => {
        if (!entry || typeof entry !== 'object') return false;
        return (
          (
            entry as {
              message?: string;
            }
          ).message === 'flows.page.active_conversation_temporarily_hidden'
        );
      });
      expect(hiddenLogs).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });
  it('drops stale invisible retention candidates so later visible step transitions can still be logged', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const harness = setupFlowsRunHarness();
    try {
      const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
      render(<RouterProvider router={router} />);
      await waitForFlowTitle('Flow: daily');
      await waitFor(() =>
        expect(screen.getByTestId('flow-select')).toHaveValue('daily::local'),
      );
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        content: 'Run step one',
      });
      harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        delta: 'First step answer',
      });
      expect(await screen.findByText('First step answer')).toBeInTheDocument();
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        content: 'Run silent step two',
      });
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-3',
        content: 'Run step three',
      });
      harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-3',
        delta: 'Third step answer',
      });
      expect(
        (await screen.findAllByText('Third step answer')).length,
      ).toBeGreaterThan(0);
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-4',
        content: 'Run step four',
      });
      harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-4',
        delta: 'Fourth step answer',
      });
      expect(
        (await screen.findAllByText('Fourth step answer')).length,
      ).toBeGreaterThan(0);
      await waitFor(() => {
        const retainedLogs = logSpy.mock.calls
          .map(([entry]) => entry)
          .filter((entry) => {
            if (!entry || typeof entry !== 'object') return false;
            return (
              (
                entry as {
                  message?: string;
                }
              ).message === 'flows.page.live_transcript_retained'
            );
          }) as Array<{
          context?: Record<string, unknown>;
          message?: string;
        }>;
        expect(retainedLogs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: 'flows.page.live_transcript_retained',
              context: expect.objectContaining({
                previousInflightId: 'flow-step-3',
                currentInflightId: 'flow-step-4',
              }),
            }),
          ]),
        );
      });
    } finally {
      logSpy.mockRestore();
    }
  });
  it('logs the latest real flow step transition even if an older step replay arrives in between', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const harness = setupFlowsRunHarness();
    try {
      const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
      render(<RouterProvider router={router} />);
      await waitForFlowTitle('Flow: daily');
      await waitFor(() =>
        expect(screen.getByTestId('flow-select')).toHaveValue('daily::local'),
      );
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        content: 'Run step one',
      });
      harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        delta: 'First step answer',
      });
      expect(await screen.findByText('First step answer')).toBeInTheDocument();
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        content: 'Run step two',
      });
      harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        delta: 'Second step answer',
      });
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        content: 'Run step one replay',
      });
      harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-3',
        content: 'Run step three',
      });
      harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-3',
        delta: 'Third step answer',
      });
      await waitFor(() => {
        const retainedLogs = logSpy.mock.calls
          .map(([entry]) => entry)
          .filter((entry) => {
            if (!entry || typeof entry !== 'object') return false;
            return (
              (
                entry as {
                  message?: string;
                }
              ).message === 'flows.page.live_transcript_retained'
            );
          }) as Array<{
          context?: Record<string, unknown>;
          message?: string;
        }>;
        expect(retainedLogs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: 'flows.page.live_transcript_retained',
              context: expect.objectContaining({
                previousInflightId: 'flow-step-1',
                currentInflightId: 'flow-step-2',
              }),
            }),
            expect.objectContaining({
              message: 'flows.page.live_transcript_retained',
              context: expect.objectContaining({
                previousInflightId: 'flow-step-2',
                currentInflightId: 'flow-step-3',
              }),
            }),
          ]),
        );
      });
    } finally {
      logSpy.mockRestore();
    }
  });
  it('clears transcript and active conversation on New Flow', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
      }
      if (target.includes('/conversations/flow-1/turns')) {
        return mockJsonResponse({
          items: [
            {
              conversationId: 'flow-1',
              role: 'assistant',
              content: 'Hello from flow',
              model: 'gpt-5',
              provider: 'codex',
              toolCalls: null,
              status: 'ok',
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
              flags: { flow: { stepPath: [0] } },
            },
          ],
        });
      }
      return mockJsonResponse({});
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('Hello from flow')).toBeInTheDocument();
    const newFlowButton = await screen.findByTestId('flow-new');
    await user.click(newFlowButton);
    expect(
      await screen.findByText(
        'Transcript will appear here once a flow run starts.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('flow-custom-title')).toBeEnabled(),
    );
  });
  it('keeps the selected flow and run button enabled after New Flow', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
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
    await waitForFlowTitle('Flow: daily');
    const newFlowButton = await screen.findByTestId('flow-new');
    await user.click(newFlowButton);
    expect(screen.getByTestId('flow-title-trigger')).toHaveTextContent('daily');
    await waitFor(() => expect(screen.getByTestId('flow-run')).toBeEnabled());
  });
  it('resets custom title and working folder on New Flow', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
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
    const customTitleInput = await screen.findByTestId('flow-custom-title');
    const workingFolderInput = await screen.findByTestId('flow-working-folder');
    await user.type(customTitleInput, 'Daily prep');
    await user.type(workingFolderInput, '/tmp/work');
    const newFlowButton = await screen.findByTestId('flow-new');
    await user.click(newFlowButton);
    expect(screen.getByTestId('flow-custom-title')).toHaveValue('');
    expect(screen.getByTestId('flow-working-folder')).toHaveValue('');
  });
  it('writes the selected folder into the working folder input', async () => {
    const user = userEvent.setup();
    mockFlowsFetch({
      dirs: (path: string | undefined) => {
        if (path === '/base/repo') {
          return { base: '/base', path: '/base/repo', dirs: [] };
        }
        return defaultDirs;
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
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
    await waitForFlowTitle('Flow: daily');
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
  it('restores the saved working folder from conversation state', async () => {
    const harness = setupFlowsRunHarness({
      conversations: {
        items: [
          {
            conversationId: 'flow-1',
            title: 'Flow: daily',
            provider: 'codex',
            model: 'gpt-5',
            source: 'REST',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
            flowName: 'daily',
            flags: { workingFolder: '/repos/flow' },
          },
        ],
        nextCursor: null,
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await selectFirstConversation();
    expect(await screen.findByTestId('flow-working-folder')).toHaveValue(
      '/repos/flow',
    );
    expect(harness.getConversationId()).toBeNull();
  });
  it('shows the normal empty state when no saved working folder exists', async () => {
    setupFlowsRunHarness();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await selectFirstConversation();
    expect(await screen.findByTestId('flow-working-folder')).toHaveValue('');
  });
  it('saves idle edits through the shared conversation helper', async () => {
    const user = userEvent.setup();
    setupFlowsRunHarness();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await selectFirstConversation();
    const workingFolder = await screen.findByTestId('flow-working-folder');
    await user.clear(workingFolder);
    await user.type(workingFolder, '/repos/flow-updated');
    fireEvent.blur(workingFolder);
    await waitFor(() => {
      const updateCall = mockFetch.mock.calls.find(([url, init]) => {
        const href = typeof url === 'string' ? url : url.toString();
        return (
          href.includes('/conversations/flow-1/working-folder') &&
          init?.method === 'POST'
        );
      });
      expect(updateCall).toBeDefined();
      const body =
        typeof updateCall?.[1]?.body === 'string'
          ? JSON.parse(updateCall[1].body)
          : null;
      expect(body).toEqual({ workingFolder: '/repos/flow-updated' });
    });
  });
  it('locks the picker while a flow run is active', async () => {
    const harness = setupFlowsRunHarness();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await selectFirstConversation();
    act(() => {
      harness.emitInflightSnapshot({
        conversationId: 'flow-1',
        inflightId: 'flow-inflight-1',
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-working-folder')).toBeDisabled(),
    );
  });
  it('closes an already-open flow directory picker when the working folder locks', async () => {
    const user = userEvent.setup();
    setupFlowsRunHarness();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await selectFirstConversation();
    await user.click(screen.getByTestId('flow-working-folder-picker'));
    expect(
      await screen.findByRole('dialog', { name: /choose folder…/i }),
    ).toBeInTheDocument();
    emitInflightSnapshot({
      conversationId: 'flow-1',
      inflightId: 'flow-inflight-1',
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /choose folder…/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('flow-working-folder')).toHaveValue('');
  });
  it('disables working-folder persistence affordances when persistence is unavailable', async () => {
    const harness = setupFlowsRunHarness({
      health: { mongoConnected: false },
      conversations: {
        items: [
          {
            conversationId: 'flow-1',
            title: 'Flow: daily',
            provider: 'codex',
            model: 'gpt-5',
            source: 'REST',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
            flowName: 'daily',
            flags: { workingFolder: '/repos/flow' },
          },
        ],
        nextCursor: null,
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await waitFor(() =>
      expect(screen.getByTestId('flow-working-folder')).toHaveValue(
        '/repos/flow',
      ),
    );
    expect(screen.getByTestId('flow-run')).toBeDisabled();
    expect(screen.getByTestId('flow-working-folder-trigger')).toBeDisabled();
    expect(screen.getByTestId('flow-working-folder')).toBeDisabled();
    expect(screen.getByTestId('flow-working-folder-picker')).toBeDisabled();
    fireEvent.blur(screen.getByTestId('flow-working-folder'));
    await waitFor(() => {
      expect(harness.workingFolderBodies).toHaveLength(0);
    });
  });
  it('returns to the empty state after the server clears an invalid saved path', async () => {
    const harness = setupFlowsRunHarness({
      conversations: {
        items: [
          {
            conversationId: 'flow-1',
            title: 'Flow: daily',
            provider: 'codex',
            model: 'gpt-5',
            source: 'REST',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
            flowName: 'daily',
            flags: { workingFolder: '/repos/flow' },
          },
        ],
        nextCursor: null,
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await selectFirstConversation();
    expect(await screen.findByTestId('flow-working-folder')).toHaveValue(
      '/repos/flow',
    );
    act(() => {
      harness.emitSidebarUpsert({
        conversationId: 'flow-1',
        title: 'Flow: daily',
        provider: 'codex',
        model: 'gpt-5',
        source: 'REST',
        lastMessageAt: '2025-01-01T00:00:01.000Z',
        archived: false,
        flowName: 'daily',
        flags: {},
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-working-folder')).toHaveValue(''),
    );
  });
  it('clears through the shared conversation helper and returns to the empty state', async () => {
    const user = userEvent.setup();
    setupFlowsRunHarness({
      conversations: {
        items: [
          {
            conversationId: 'flow-1',
            title: 'Flow: daily',
            provider: 'codex',
            model: 'gpt-5',
            source: 'REST',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
            flowName: 'daily',
            flags: { workingFolder: '/repos/flow' },
          },
        ],
        nextCursor: null,
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await selectFirstConversation();
    const workingFolder = await screen.findByTestId('flow-working-folder');
    await user.clear(workingFolder);
    fireEvent.blur(workingFolder);
    await waitFor(() => {
      const updateCall = mockFetch.mock.calls.find(([url, init]) => {
        const href = typeof url === 'string' ? url : url.toString();
        return (
          href.includes('/conversations/flow-1/working-folder') &&
          init?.method === 'POST'
        );
      });
      expect(updateCall).toBeDefined();
      const body =
        typeof updateCall?.[1]?.body === 'string'
          ? JSON.parse(updateCall[1].body)
          : null;
      expect(body).toEqual({ workingFolder: null });
    });
    await waitFor(() =>
      expect(screen.getByTestId('flow-working-folder')).toHaveValue(''),
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
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
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
          providerId: 'codex',
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
      const flowListOrDetails = mockDailyFlowListOrDetailsResponse(target);
      if (flowListOrDetails) {
        return flowListOrDetails;
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
    await waitForFlowTitle('Flow: daily');
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
  it('preserves warning status through hydrated turns and live final rendering on the flows transcript surface', async () => {
    setupFlowsRunHarness({
      turns: {
        items: [
          {
            turnId: 'turn-warning-hydrated',
            conversationId: 'flow-1',
            role: 'assistant',
            content: 'Persisted warning output',
            model: 'gpt-5',
            provider: 'codex',
            status: 'warning',
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await selectFirstConversation();
    expect(
      await screen.findByText('Persisted warning output'),
    ).toBeInTheDocument();
    let statusChips = await screen.findAllByTestId('status-chip');
    expect(statusChips[0]).toHaveTextContent('Warning');
    const infoButtons = await screen.findAllByTestId('bubble-info');
    await userEvent.click(infoButtons[0]);
    await waitFor(() =>
      expect(screen.getByTestId('bubble-info-status')).toHaveTextContent(
        'Status: Warning',
      ),
    );
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'user_turn',
      seq: 1,
      conversationId: 'flow-1',
      inflightId: 'warning-live-1',
      content: 'Resume flow',
      createdAt: '2025-01-01T00:01:00.000Z',
    });
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'assistant_delta',
      seq: 2,
      conversationId: 'flow-1',
      inflightId: 'warning-live-1',
      delta: 'Live warning output',
    });
    emitWsEvent({
      protocolVersion: 'v1',
      type: 'turn_final',
      seq: 3,
      conversationId: 'flow-1',
      inflightId: 'warning-live-1',
      status: 'warning',
      threadId: 'warning-live-1',
    });
    expect(await screen.findByText('Live warning output')).toBeInTheDocument();
    await waitFor(() => {
      statusChips = screen.getAllByTestId('status-chip');
      expect(statusChips).toHaveLength(2);
      statusChips.forEach((chip) => {
        expect(chip).toHaveTextContent('Warning');
        expect(chip).not.toHaveTextContent('Complete');
      });
    });
  });
});
