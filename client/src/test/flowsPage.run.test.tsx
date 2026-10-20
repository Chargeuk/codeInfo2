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
import { decodeJsonBody } from './support/decodeJsonBody';
import { setupChatWsHarness } from './support/mockChatWs';
import { MockWebSocket } from './support/mockWebSocket';
import { installTranscriptMeasurementHarness } from './support/transcriptMeasurementHarness';
import { resolveClientTestTimeoutMs } from './support/testTimeouts';
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
        init?.body != null
          ? (decodeJsonBody(init) as Record<string, unknown>)
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
  const rows = await screen.findAllByTestId('conversation-row', undefined, {
    timeout: resolveClientTestTimeoutMs(5000),
  });
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
          init?.body != null
            ? (decodeJsonBody(init) as Record<string, unknown>)
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

  it('renders persisted subflow-wave counts in the parent transcript', async () => {
    setupFlowsRunHarness({
      turns: {
        items: [
          {
            turnId: 'wave-turn-1',
            conversationId: 'flow-1',
            role: 'assistant',
            content:
              'Completed subflow wave: expected 7, running 0, completed 6, failed 0, stopped 0, not applicable 1',
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
    expect(
      await screen.findByText(
        'Completed subflow wave: expected 7, running 0, completed 6, failed 0, stopped 0, not applicable 1',
      ),
    ).toBeInTheDocument();
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
            init?.body != null
              ? (decodeJsonBody(init) as Record<string, unknown>)
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
      const body = decodeJsonBody(init) as Record<string, unknown>;
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
          mockFetch.mock.calls.at(-1)?.[1]?.body != null
            ? (decodeJsonBody(mockFetch.mock.calls.at(-1)?.[1]) as Record<
                string,
                unknown
              >)
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
      const body = decodeJsonBody(init) as Record<string, unknown>;
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
      { timeout: resolveClientTestTimeoutMs(5000) },
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
          mockFetch.mock.calls.at(-1)?.[1]?.body != null
            ? (decodeJsonBody(mockFetch.mock.calls.at(-1)?.[1]) as Record<
                string,
                unknown
              >)
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
      const body = decodeJsonBody(init) as Record<string, unknown>;
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
      const body = decodeJsonBody(init) as Record<string, unknown>;
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
    const firstBody = decodeJsonBody(firstInit) as Record<string, unknown>;
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
    const secondBody = decodeJsonBody(secondInit) as Record<string, unknown>;
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
            init?.body != null
              ? (decodeJsonBody(init) as Record<string, unknown>)
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
      await harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        content: 'Run step one',
      });
      await harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        delta: 'First step answer',
      });
      expect(await screen.findByText('First step answer')).toBeInTheDocument();
      expect(screen.queryByTestId('citations-toggle')).not.toBeInTheDocument();
      await harness.emitUserTurn({
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
      await harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        content: 'Run step one replay',
      });
      await harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        delta: ' hidden',
      });
      await harness.emitAssistantDelta({
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
    await harness.emitUserTurn({
      conversationId: 'flow-1',
      inflightId: 'flow-step-1',
      content: 'Run step one',
    });
    await harness.emitAssistantDelta({
      conversationId: 'flow-1',
      inflightId: 'flow-step-1',
      delta: 'First step answer',
    });
    expect(await screen.findByText('First step answer')).toBeInTheDocument();
    await harness.emitUserTurn({
      conversationId: 'flow-1',
      inflightId: 'flow-step-2',
      content: 'Run step two',
    });
    await harness.emitAssistantDelta({
      conversationId: 'flow-1',
      inflightId: 'flow-step-2',
      delta: 'Second step',
    });
    await harness.emitAssistantDelta({
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
      await harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        content: 'Run step one',
      });
      await harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        delta: 'First step answer',
      });
      expect(await screen.findByText('First step answer')).toBeInTheDocument();
      await harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        content: 'Run silent step two',
      });
      await harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-3',
        content: 'Run step three',
      });
      await harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-3',
        delta: 'Third step answer',
      });
      expect(
        (await screen.findAllByText('Third step answer')).length,
      ).toBeGreaterThan(0);
      await harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-4',
        content: 'Run step four',
      });
      await harness.emitAssistantDelta({
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
      await harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        content: 'Run step one',
      });
      await harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        delta: 'First step answer',
      });
      expect(await screen.findByText('First step answer')).toBeInTheDocument();
      await harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        content: 'Run step two',
      });
      await harness.emitAssistantDelta({
        conversationId: 'flow-1',
        inflightId: 'flow-step-2',
        delta: 'Second step answer',
      });
      await harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-1',
        content: 'Run step one replay',
      });
      await harness.emitUserTurn({
        conversationId: 'flow-1',
        inflightId: 'flow-step-3',
        content: 'Run step three',
      });
      await harness.emitAssistantDelta({
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
        updateCall?.[1]?.body != null ? decodeJsonBody(updateCall[1]) : null;
      expect(body).toEqual({ workingFolder: '/repos/flow-updated' });
    });
  });
  it('locks the picker while a flow run is active', async () => {
    const harness = setupFlowsRunHarness();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);
    await waitForFlowTitle('Flow: daily');
    await selectFirstConversation();
    await act(async () => {
      await harness.emitInflightSnapshot({
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
    await act(async () => {
      await harness.emitSidebarUpsert({
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
        updateCall?.[1]?.body != null ? decodeJsonBody(updateCall[1]) : null;
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
      const body = decodeJsonBody(init) as Record<string, unknown>;
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

describe('descendant flow transcripts', () => {
  const root = { conversationId: 'flow-1', flowName: 'daily' };
  const child = {
    conversationId: 'child-1',
    title: 'Child flow',
    provider: 'codex',
    model: 'gpt-5',
    flowName: 'child',
    flags: { flowChild: { ancestors: [root] } },
  };
  const grandchild = {
    conversationId: 'grandchild-1',
    title: 'Grandchild flow',
    provider: 'codex',
    model: 'gpt-5',
    flowName: 'grandchild',
    flags: {
      flowChild: {
        ancestors: [root, { conversationId: 'child-1', flowName: 'child' }],
      },
    },
  };
  const makeTurns = (id: string, prefix: string) =>
    ['user', 'assistant'].map((role, index) => ({
      turnId: `${id}-${role}`,
      conversationId: id,
      role,
      content: `${prefix} ${role}`,
      model: 'gpt-5',
      provider: 'codex',
      status: 'ok',
      createdAt: `2026-01-01T00:00:0${index}.000Z`,
    }));
  function installDescendantFixture() {
    setupFlowsRunHarness({ turns: { items: makeTurns('flow-1', 'Parent') } });
    const baseFetch = mockFetch.getMockImplementation()!;
    const histories: Record<string, unknown[]> = {
      'child-1': makeTurns('child-1', 'Child'),
      'grandchild-1': makeTurns('grandchild-1', 'Grandchild'),
      'late-1': [],
    };
    mockFetch.mockImplementation((url, init) => {
      const target = new URL(typeof url === 'string' ? url : url.toString());
      if (target.searchParams.has('ancestorConversationId'))
        return mockJsonResponse(
          target.searchParams.has('cursor')
            ? {
                items: [
                  grandchild,
                  {
                    ...child,
                    conversationId: 'agent-copy',
                    agentName: 'coding_agent',
                  },
                ],
              }
            : { items: [child], nextCursor: '2026-01-01T00:00:00.000Z' },
        );
      const id = target.pathname.match(
        /^\/conversations\/([^/]+)\/turns$/,
      )?.[1];
      if (id && Object.hasOwn(histories, id))
        return mockJsonResponse({ items: histories[id] });
      return baseFetch(url, init);
    });
    return histories;
  }
  async function selectParentForViewport() {
    if (window.innerWidth <= 600)
      await userEvent.click(
        await screen.findByRole('button', { name: 'Open conversations' }),
      );
    await selectFirstConversation();
    const closeDrawer = screen.queryByRole('button', {
      name: 'Close conversations',
    });
    if (closeDrawer) {
      await userEvent.click(closeDrawer);
      await waitFor(() =>
        expect(
          screen.queryByTestId('workspace-mobile-conversations-overlay'),
        ).not.toBeInTheDocument(),
      );
    }
  }
  async function renderSelectedParent() {
    const view = render(
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: ['/flows'] })}
      />,
    );
    await selectParentForViewport();
    await screen.findByText('Grandchild assistant');
    return view;
  }
  it('warns when completed descendant history fails and clears only after its successful reload', async () => {
    const histories = installDescendantFixture();
    const baseFetch = mockFetch.getMockImplementation()!;
    let failChild = true;
    mockFetch.mockImplementation((url, init) => {
      if (failChild && String(url).includes('/conversations/child-1/turns'))
        return mockJsonResponse({}, { status: 500 });
      return baseFetch(url, init);
    });
    await renderSelectedParent();
    const warning = /History unavailable for child \(child-1\)/;
    const alert = (await screen.findByText(warning)).closest('[role="alert"]');
    expect(alert).toHaveTextContent('Failed to load conversation turns (500)');
    expect(screen.getByText('Parent assistant')).toBeInTheDocument();
    expect(screen.getByText('Grandchild assistant')).toBeInTheDocument();
    expect(screen.queryByText('Child assistant')).not.toBeInTheDocument();

    for (const recover of [false, true]) {
      failChild = !recover;
      const healthyPrefix = recover ? 'Healthy recovery' : 'Healthy reload';
      histories['grandchild-1'] = makeTurns('grandchild-1', healthyPrefix);
      const previousSocket = globalThis.__wsMock!.last()!;
      // Reconnect refreshes discovery and every history. Re-subscription is the
      // observable completion boundary for those asynchronous refresh calls.
      const reloaded = waitFor(
        () => {
          const socket = globalThis.__wsMock!.last()!;
          expect(socket).not.toBe(previousSocket);
          expect(
            socket.sent.some((raw) => {
              const event = JSON.parse(raw);
              return (
                event.type === 'subscribe_conversation' &&
                event.conversationId === 'child-1'
              );
            }),
          ).toBe(true);
        },
        { timeout: resolveClientTestTimeoutMs(5000) },
      );
      act(() => previousSocket.close());
      await reloaded;
      await screen.findByText(`${healthyPrefix} assistant`);
      expect(screen.getByText('Parent assistant')).toBeInTheDocument();
      if (recover) {
        await screen.findByText('Child assistant');
        await waitFor(() =>
          expect(screen.queryByText(warning)).not.toBeInTheDocument(),
        );
      } else {
        // Neither a healthy sibling nor successful discovery clears this error.
        expect(screen.getByText(warning)).toBeInTheDocument();
      }
    }
  });
  it.each(['child removal', 'parent switch'])(
    'clears a descendant history warning after %s',
    async (change) => {
      installDescendantFixture();
      const baseFetch = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation((url, init) => {
        if (String(url).includes('/conversations/child-1/turns'))
          return mockJsonResponse({}, { status: 500 });
        if (String(url).includes('/conversations/flow-2/turns'))
          return mockJsonResponse({ items: makeTurns('flow-2', 'Other parent') });
        return baseFetch(url, init);
      });
      await renderSelectedParent();
      const warning = /History unavailable for child \(child-1\)/;
      await screen.findByText(warning);
      if (change === 'child removal') {
        emitWsEvent({
          protocolVersion: 'v1',
          type: 'conversation_delete',
          seq: 30,
          conversationId: 'child-1',
        });
        expect(screen.getByText('Parent assistant')).toBeInTheDocument();
        expect(screen.getByText('Grandchild assistant')).toBeInTheDocument();
      } else {
        emitWsEvent({
          protocolVersion: 'v1',
          type: 'conversation_upsert',
          seq: 30,
          conversation: {
            conversationId: 'flow-2',
            title: 'Other parent',
            provider: 'codex',
            model: 'gpt-5',
            flowName: 'daily',
            flags: {},
          },
        });
        const otherParent = await screen.findByText('Other parent');
        await userEvent.click(
          otherParent.closest('[data-testid="conversation-row"]')!,
        );
        await screen.findByText('Other parent assistant');
        expect(
          screen.queryByText('Grandchild assistant'),
        ).not.toBeInTheDocument();
      }
      await waitFor(() =>
        expect(screen.queryByText(warning)).not.toBeInTheDocument(),
      );
    },
  );
  it.each([1280, 390])(
    'shows descendant labels and full ancestry for both roles at width %i and remembers filtering after reopening',
    async (width) => {
      const originalWidth = window.innerWidth;
      act(() => {
        window.innerWidth = width;
        window.dispatchEvent(new Event('resize'));
      });
      try {
        installDescendantFixture();
        let view = await renderSelectedParent();
        expect(screen.getAllByTestId('chat-bubble')).toHaveLength(6);
        expect(screen.getAllByText('Level 1 · child')).toHaveLength(2);
        expect(screen.getAllByText('Level 2 · grandchild')).toHaveLength(2);
        for (const content of ['Grandchild user', 'Grandchild assistant']) {
          const bubble = screen
            .getByText(content)
            .closest('[data-testid="chat-bubble"]') as HTMLElement;
          await userEvent.click(within(bubble).getByTestId('bubble-info'));
          const ancestry = await screen.findByTestId('bubble-flow-ancestry');
          expect(ancestry).toHaveTextContent(
            'daily (flow-1) → child (child-1) → grandchild (grandchild-1)',
          );
          expect(ancestry).toHaveStyle({
            overflowWrap: 'anywhere',
            whiteSpace: 'normal',
          });
          fireEvent.keyDown(screen.getByRole('presentation'), {
            key: 'Escape',
          });
          await waitFor(() =>
            expect(
              screen.queryByTestId('bubble-flow-ancestry'),
            ).not.toBeInTheDocument(),
          );
        }
        expect(
          within(
            screen
              .getByText('Parent user')
              .closest('[data-testid="chat-bubble"]') as HTMLElement,
          ).queryByTestId('bubble-flow-origin'),
        ).not.toBeInTheDocument();
        await userEvent.click(
          screen.getByRole('button', { name: 'Additional options' }),
        );
        const options = await screen.findByTestId(
          width < 600 ? 'flow-options-dialog' : 'flow-options-popover',
        );
        const toggle = within(options).getByRole('checkbox', {
          name: 'Show descendant messages',
        });
        expect(toggle).toBeChecked();
        await userEvent.click(toggle);
        await waitFor(() =>
          expect(screen.getAllByTestId('chat-bubble')).toHaveLength(2),
        );
        expect(
          window.localStorage.getItem('flows.showDescendantMessages'),
        ).toBe('false');
        view.unmount();
        view = render(
          <RouterProvider
            router={createMemoryRouter(routes, { initialEntries: ['/flows'] })}
          />,
        );
        await selectParentForViewport();
        await screen.findByText('Parent assistant');
        expect(
          screen.queryByText('Grandchild assistant'),
        ).not.toBeInTheDocument();
        await userEvent.click(
          screen.getByRole('button', { name: 'Additional options' }),
        );
        const reopened = await screen.findByTestId(
          width < 600 ? 'flow-options-dialog' : 'flow-options-popover',
        );
        await userEvent.click(
          within(reopened).getByRole('checkbox', {
            name: 'Show descendant messages',
          }),
        );
        await screen.findByText('Grandchild assistant');
        expect(screen.getAllByTestId('chat-bubble')).toHaveLength(6);
        view.unmount();
      } finally {
        act(() => {
          window.innerWidth = originalWidth;
          window.dispatchEvent(new Event('resize'));
        });
      }
    },
  );
  it('keeps one descendant response when subscription delivers immediately before a filtered continuation', async () => {
    installDescendantFixture();
    await renderSelectedParent();
    const transcript = screen.getByTestId('flows-transcript');
    const inflightId = 'boundary-child-i';
    let markDelivered!: () => void;
    const delivered = new Promise<void>((resolve) => {
      markDelivered = resolve;
    });
    const originalSend = MockWebSocket.prototype.send;
    let initialDelivered = false;
    const sendSpy = jest
      .spyOn(MockWebSocket.prototype, 'send')
      .mockImplementation(function (this: MockWebSocket, data: unknown) {
        originalSend.call(this, data);
        const request = JSON.parse(String(data)) as {
          type?: string;
          conversationId?: string;
        };
        if (
          initialDelivered ||
          request.type !== 'subscribe_conversation' ||
          request.conversationId !== 'late-1'
        )
          return;
        initialDelivered = true;
        // Model a subscription catch-up arriving in the same effect as subscribe,
        // before any later render/effect can finish changing the stream identity.
        const envelope = { protocolVersion: 'v1', conversationId: 'late-1' };
        this._receive({
          ...envelope,
          type: 'inflight_snapshot',
          seq: 1,
          inflight: {
            inflightId,
            assistantText: 'Boundary',
            assistantThink: '',
            toolEvents: [],
            startedAt: '2026-01-01T00:00:02.000Z',
          },
        });
        this._receive({
          ...envelope,
          type: 'user_turn',
          seq: 2,
          inflightId,
          content: 'Boundary prompt',
          createdAt: '2026-01-01T00:00:02.000Z',
        });
        this._receive({
          ...envelope,
          type: 'assistant_delta',
          seq: 3,
          inflightId,
          delta: ' response',
        });
        markDelivered();
      });
    try {
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'conversation_upsert',
        seq: 20,
        conversation: {
          ...grandchild,
          conversationId: 'late-1',
          flowName: 'late',
        },
      });
      await waitFor(() => expect(initialDelivered).toBe(true));
      await delivered;
      await screen.findByText('Boundary response');
      expect(screen.getAllByText('Boundary prompt')).toHaveLength(1);
      expect(screen.getByTestId('flow-run')).toBeEnabled();
      const commands = () =>
        globalThis.__wsMock!.last()!.sent.map(
          (raw) =>
            JSON.parse(raw) as {
              type: string;
              conversationId?: string;
            },
        );
      const beforeToggle = commands().length;
      await userEvent.click(
        screen.getByRole('button', { name: 'Additional options' }),
      );
      const options = await screen.findByTestId('flow-options-popover');
      const toggle = within(options).getByRole('checkbox', {
        name: 'Show descendant messages',
      });
      await userEvent.click(toggle);
      await waitFor(() =>
        expect(within(transcript).getAllByTestId('chat-bubble')).toHaveLength(
          2,
        ),
      );
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        seq: 4,
        conversationId: 'late-1',
        inflightId,
        delta: ' continued while filtered',
      });
      await userEvent.click(toggle);
      const lateAssistantRows = () =>
        transcript.querySelectorAll<HTMLElement>(
          '[data-transcript-row-id^="late-1:"] [data-testid="chat-bubble"][data-role="assistant"]',
        );
      await waitFor(() => {
        const rows = lateAssistantRows();
        expect(rows).toHaveLength(1);
        expect(
          within(rows[0]).getByTestId('assistant-markdown'),
        ).toHaveTextContent('Boundary response continued while filtered');
      });
      expect(within(transcript).getAllByTestId('chat-bubble')).toHaveLength(8);
      expect(screen.getAllByText('Boundary prompt')).toHaveLength(1);
      expect(screen.getByTestId('flow-run')).toBeEnabled();
      expect(screen.queryByTestId('flow-stop')).not.toBeInTheDocument();
      expect(globalThis.__wsMock!.instances).toHaveLength(1);
      expect(
        commands().filter(
          (command) =>
            command.type === 'subscribe_conversation' &&
            command.conversationId === 'late-1',
        ),
      ).toHaveLength(1);
      expect(
        commands()
          .slice(beforeToggle)
          .filter(
            (command) =>
              command.type === 'cancel_inflight' ||
              command.type === 'unsubscribe_conversation',
          ),
      ).toHaveLength(0);
    } finally {
      sendSpy.mockRestore();
    }
  });
  it('merges an initial descendant snapshot with delayed history and subsequent deltas without duplicates', async () => {
    const histories = installDescendantFixture();
    const baseFetch = mockFetch.getMockImplementation()!;
    let releaseHistory!: (response: Response) => void;
    const pendingHistory = new Promise<Response>((resolve) => {
      releaseHistory = resolve;
    });
    let initialRequest = true;
    mockFetch.mockImplementation((url, init) => {
      if (
        initialRequest &&
        String(url).includes('/conversations/child-1/turns')
      ) {
        initialRequest = false;
        return pendingHistory;
      }
      return baseFetch(url, init);
    });
    const snapshot = {
      inflightId: 'initial-child-i',
      assistantText: 'Initial child answer',
      assistantThink: '',
      toolEvents: [],
      startedAt: '2026-01-01T00:00:01.000Z',
      seq: 1,
    };
    try {
      await renderSelectedParent();
      await waitFor(() =>
        expect(
          globalThis.__wsMock?.last()?.sent.some((raw) => {
            const event = JSON.parse(raw);
            return (
              event.type === 'subscribe_conversation' &&
              event.conversationId === 'child-1'
            );
          }),
        ).toBe(true),
      );
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        seq: 1,
        conversationId: 'child-1',
        inflight: snapshot,
      });
      await screen.findByText('Initial child answer');
      await act(async () => {
        releaseHistory(
          new Response(
            JSON.stringify({
              items: [makeTurns('child-1', 'Child')[0]],
              inflight: snapshot,
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
      });
      await screen.findByText('Child user');
      expect(screen.getAllByText('Initial child answer')).toHaveLength(1);
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        seq: 2,
        conversationId: 'child-1',
        inflightId: 'initial-child-i',
        delta: ' continued',
      });
      await screen.findByText('Initial child answer continued');
      histories['child-1'] = [
        makeTurns('child-1', 'Child')[0],
        {
          ...makeTurns('child-1', 'Child')[1],
          content: 'Initial child answer continued',
        },
      ];
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        seq: 3,
        conversationId: 'child-1',
        inflightId: 'initial-child-i',
        status: 'ok',
      });
      await waitFor(() =>
        expect(screen.getAllByTestId('chat-bubble')).toHaveLength(6),
      );
      expect(
        screen.getAllByText('Initial child answer continued'),
      ).toHaveLength(1);
      expect(screen.getAllByText('Child user')).toHaveLength(1);
      expect(screen.getByTestId('flow-run')).toBeInTheDocument();
    } finally {
      releaseHistory(new Response(JSON.stringify({ items: [] })));
    }
  });
  it('keeps four distinct late descendant pairs single after every saved-history refresh', async () => {
    const histories = installDescendantFixture();
    const baseFetch = mockFetch.getMockImplementation()!;
    // Prepare all response/readiness gates before discovery or any final event.
    const historyGates = Array.from({ length: 5 }, () => {
      let release!: () => void;
      let markRequested!: () => void;
      let markConsumed!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requested = new Promise<void>((resolve) => {
        markRequested = resolve;
      });
      const consumed = new Promise<void>((resolve) => {
        markConsumed = resolve;
      });
      return {
        released,
        requested,
        consumed,
        release,
        markRequested,
        markConsumed,
      };
    });
    let historyRequestCount = 0;
    mockFetch.mockImplementation((url, init) => {
      if (!String(url).includes('/conversations/late-1/turns'))
        return baseFetch(url, init);
      const gate = historyGates[historyRequestCount++];
      if (!gate)
        return Promise.reject(
          new Error('Unexpected extra late-1 history request'),
        );
      gate.markRequested();
      return gate.released.then(async () => {
        const response = await baseFetch(url, init);
        const readJson = response.json.bind(response);
        response.json = async () => {
          const payload = await readJson();
          gate.markConsumed();
          return payload;
        };
        return response;
      });
    });
    async function flushHistory(index: number) {
      const gate = historyGates[index];
      await gate.requested;
      // Await body consumption and drain the real history/stream/publish effects.
      await act(async () => {
        gate.release();
        await gate.consumed;
      });
      expect(historyRequestCount).toBe(index + 1);
    }
    const view = await renderSelectedParent();
    try {
      const transcript = screen.getByTestId('flows-transcript');
      const stageCounts: Array<{ stage: string; count: number }> = [];
      const expectedTexts: string[] = [];
      function assertPairs(stage: string, pairs: number) {
        const bubbles = Array.from(
          transcript.querySelectorAll<HTMLElement>(
            '[data-transcript-row-id^="late-1:"] [data-testid="chat-bubble"]',
          ),
        );
        stageCounts.push({ stage, count: bubbles.length });
        const observed = {
          stage,
          stageCounts: [...stageCounts],
          bubbleCount: bubbles.length,
          rows: bubbles.map((bubble) => ({
            id: bubble
              .closest('[data-transcript-row-id]')
              ?.getAttribute('data-transcript-row-id'),
            role: bubble.getAttribute('data-role'),
            text: bubble.textContent,
          })),
          occurrences: Object.fromEntries(
            expectedTexts.map((text) => [
              text,
              bubbles.reduce(
                (count, bubble) =>
                  count +
                  within(bubble).queryAllByText(text, { exact: true }).length,
                0,
              ),
            ]),
          ),
        };
        expect(observed).toEqual(
          expect.objectContaining({
            bubbleCount: pairs * 2,
            occurrences: Object.fromEntries(
              expectedTexts.map((text) => [text, 1]),
            ),
          }),
        );
      }
      const subscriptionReady = waitFor(() =>
        expect(
          globalThis.__wsMock?.last()?.sent.some((raw) => {
            const event = JSON.parse(raw);
            return (
              event.type === 'subscribe_conversation' &&
              event.conversationId === 'late-1'
            );
          }),
        ).toBe(true),
      );
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'conversation_upsert',
        seq: 20,
        conversation: { ...child, conversationId: 'late-1', flowName: 'late' },
      });
      await subscriptionReady;
      await flushHistory(0);
      assertPairs('initial empty history hydrated', 0);
      for (let pair = 1; pair <= 4; pair += 1) {
        const prompt = `Late diagnostic prompt ${pair}`;
        const answer = `Late diagnostic answer ${pair}`;
        const inflightId = `late-proof-inflight-${pair}`;
        const createdAt = new Date().toISOString();
        const envelope = {
          protocolVersion: 'v1',
          conversationId: 'late-1',
          inflightId,
        };
        expectedTexts.push(prompt, answer);
        emitWsEvent({
          ...envelope,
          type: 'user_turn',
          seq: pair * 3 - 2,
          content: prompt,
          createdAt,
        });
        emitWsEvent({
          ...envelope,
          type: 'assistant_delta',
          seq: pair * 3 - 1,
          delta: answer,
        });
        await screen.findByText(answer);
        assertPairs(`pair ${pair} live`, pair);
        // Preserve every completed pair with distinct stored IDs and matching
        // content/timestamps, within the existing hydration dedupe window.
        histories['late-1'].push(
          ...['user', 'assistant'].map((role) => ({
            turnId: `late-1-saved-${pair}-${role}`,
            conversationId: 'late-1',
            role,
            content: role === 'user' ? prompt : answer,
            model: 'gpt-5',
            provider: 'codex',
            status: 'ok',
            createdAt: role === 'user' ? createdAt : new Date().toISOString(),
          })),
        );
        emitWsEvent({
          ...envelope,
          type: 'turn_final',
          seq: pair * 3,
          status: 'ok',
        });
        await flushHistory(pair);
        assertPairs(`pair ${pair} saved history hydrated`, pair);
      }
    } finally {
      await act(async () => {
        historyGates.forEach((gate) => gate.release());
      });
      view.unmount();
    }
  });
  it('discovers late descendants on the same socket, preserves scroll, and isolates parent stop state', async () => {
    const measurement = installTranscriptMeasurementHarness();
    try {
      const histories = installDescendantFixture();
      await renderSelectedParent();
      const transcript = screen.getByTestId('flows-transcript');
      measurement.setContainerMetrics(transcript, {
        width: 640,
        height: 320,
        clientHeight: 320,
        scrollHeight: 1400,
        scrollTop: 1080,
      });
      act(() => {
        measurement.setScrollMetrics(transcript, {
          scrollHeight: 1400,
          scrollTop: 360,
        });
        fireEvent.wheel(transcript, { deltaY: -320 });
        fireEvent.scroll(transcript);
      });
      await screen.findByTestId('transcript-jump-to-latest');
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'conversation_upsert',
        seq: 20,
        conversation: {
          ...grandchild,
          conversationId: 'late-1',
          flowName: 'late',
        },
      });
      await waitFor(() =>
        expect(
          globalThis.__wsMock?.last()?.sent.some((raw) => {
            const event = JSON.parse(raw);
            return (
              event.type === 'subscribe_conversation' &&
              event.conversationId === 'late-1'
            );
          }),
        ).toBe(true),
      );
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        seq: 1,
        conversationId: 'late-1',
        inflightId: 'late-i',
        content: 'Late prompt',
        createdAt: '2026-01-01T00:00:02.000Z',
      });
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        seq: 2,
        conversationId: 'late-1',
        inflightId: 'late-i',
        delta: 'Late answer',
      });
      await screen.findByText('Late answer');
      expect(screen.getByTestId('flows-transcript')).toBe(transcript);
      expect(transcript.scrollTop).toBe(360);
      expect(screen.getByTestId('flow-run')).toBeInTheDocument();
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'user_turn',
        seq: 1,
        conversationId: 'flow-1',
        inflightId: 'parent-i',
        content: 'Parent live prompt',
        createdAt: '2026-01-01T00:00:03.000Z',
      });
      await screen.findByTestId('flow-stop');
      histories['late-1'] = makeTurns('late-1', 'Late saved');
      emitWsEvent({
        protocolVersion: 'v1',
        type: 'turn_final',
        seq: 3,
        conversationId: 'late-1',
        inflightId: 'late-i',
        status: 'ok',
      });
      await screen.findByText('Late saved assistant');
      expect(screen.getByTestId('flow-stop')).toBeInTheDocument();
      await userEvent.click(screen.getByTestId('flow-stop'));
      await waitFor(() =>
        expect(
          globalThis.__wsMock?.last()?.sent.some((raw) => {
            const event = JSON.parse(raw);
            return (
              event.type === 'cancel_inflight' &&
              event.conversationId === 'flow-1' &&
              event.inflightId === 'parent-i'
            );
          }),
        ).toBe(true),
      );
      expect(globalThis.__wsMock?.instances).toHaveLength(1);
    } finally {
      measurement.restore();
    }
  });
});
