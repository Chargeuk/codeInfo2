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
import { setupChatWsHarness } from './support/mockChatWs';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  process.env.MODE = 'test';
  global.fetch = mockFetch;
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
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
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

    if (target.includes('/flows') && !target.includes('/run')) {
      return mockJsonResponse({
        flows: [{ name: 'daily', description: 'Daily flow', disabled: false }],
      });
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
        typeof init.body === 'string'
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
      __wsMock?: { last: () => { _receive: (data: unknown) => void } | null };
    }
  ).__wsMock;
  const ws = wsRegistry?.last();
  if (!ws) throw new Error('No WebSocket instance; did FlowsPage mount?');
  act(() => {
    ws._receive(event);
  });
}

async function selectFirstConversation() {
  const rows = await screen.findAllByTestId('conversation-row');
  await userEvent.click(rows[0]);
}

function setupFlowsRunHarness(options?: {
  conversations?: unknown;
  turns?: unknown;
  flows?: unknown;
  runResponse?: unknown;
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

  return setupChatWsHarness({
    mockFetch,
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

      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: options?.flows ?? [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
      }

      if (target.includes('/flows/daily/run')) {
        return mockJsonResponse(
          options?.runResponse ?? {
            status: 'started',
            flowName: 'daily',
            conversationId: 'flow-1',
            inflightId: 'i1',
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
          typeof init.body === 'string'
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

      return mockJsonResponse({});
    },
  });
}

describe('Flows page run/resume controls', () => {
  it('renders the custom title input', async () => {
    mockFlowsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    const customTitleInput = await screen.findByTestId('flow-custom-title');
    expect(customTitleInput).toBeInTheDocument();
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

    await selectFirstConversation();
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

  it('includes customTitle when starting a new flow run', async () => {
    const user = userEvent.setup();
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
        return mockJsonResponse({ items: [] });
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

    const titleInput = await screen.findByTestId('flow-custom-title');
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

  it('keeps the earlier assistant bubble visible while the next flow step streams and stale earlier-step replays arrive', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const harness = setupFlowsRunHarness();

    try {
      const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
      render(<RouterProvider router={router} />);

      await screen.findByText('Flow: daily');
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
    } finally {
      logSpy.mockRestore();
    }
  });

  it('keeps the earlier flow bubble visible while the later step continues streaming its own text', async () => {
    const harness = setupFlowsRunHarness();
    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Flow: daily');
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

        if (target.includes('/flows') && !target.includes('/run')) {
          return mockJsonResponse({
            flows: [
              { name: 'daily', description: 'Daily flow', disabled: false },
            ],
          });
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
                  flags: {},
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

      const runButton = await screen.findByTestId('flow-run');
      await waitFor(() => expect(runButton).toBeEnabled());
      await user.click(runButton);

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
      const hiddenLogs = logSpy.mock.calls.filter(([entry]) => {
        if (!entry || typeof entry !== 'object') return false;
        return (
          (entry as { message?: string }).message ===
          'flows.page.active_conversation_temporarily_hidden'
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

      await screen.findByText('Flow: daily');
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
      expect(await screen.findByText('Third step answer')).toBeInTheDocument();

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
      expect(await screen.findByText('Fourth step answer')).toBeInTheDocument();

      await waitFor(() => {
        const retainedLogs = logSpy.mock.calls
          .map(([entry]) => entry)
          .filter((entry) => {
            if (!entry || typeof entry !== 'object') return false;
            return (
              (entry as { message?: string }).message ===
              'flows.page.live_transcript_retained'
            );
          }) as Array<{ context?: Record<string, unknown>; message?: string }>;

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

      await screen.findByText('Flow: daily');
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
              (entry as { message?: string }).message ===
              'flows.page.live_transcript_retained'
            );
          }) as Array<{ context?: Record<string, unknown>; message?: string }>;

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

      if (target.includes('/flows') && !target.includes('/run')) {
        return mockJsonResponse({
          flows: [
            { name: 'daily', description: 'Daily flow', disabled: false },
          ],
        });
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

    const newFlowButton = await screen.findByTestId('flow-new');
    await user.click(newFlowButton);

    expect(screen.getByText('Flow: daily')).toBeInTheDocument();
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

    await screen.findByText('Flow: daily');
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

    await screen.findByText('Flow: daily');
    await selectFirstConversation();

    expect(await screen.findByTestId('flow-working-folder')).toHaveValue('');
  });

  it('saves idle edits through the shared conversation helper', async () => {
    const user = userEvent.setup();
    setupFlowsRunHarness();

    const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Flow: daily');
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

    await screen.findByText('Flow: daily');
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

    await screen.findByText('Flow: daily');
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

    await screen.findByText('Flow: daily');
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
