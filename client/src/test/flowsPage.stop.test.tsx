import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

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

afterEach(() => {
  jest.restoreAllMocks();
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

type FetchBody = Record<string, unknown>;
type StoredTurnPayload = {
  turnId: string;
  conversationId: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  model: string;
  provider: string;
  status: 'ok' | 'stopped' | 'failed';
  createdAt: string;
  command?: {
    name: string;
    stepIndex: number;
    totalSteps: number;
    label?: string;
  };
};

type ConversationSummary = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  source: 'REST' | 'MCP';
  lastMessageAt: string;
  archived: boolean;
  flowName: string;
  flags: Record<string, unknown>;
};

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderFlowsPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/flows'] });
  render(<RouterProvider router={router} />);
  return router;
}

function getWsRegistry() {
  const registry = (
    globalThis as unknown as {
      __wsMock?: {
        instances?: Array<{
          sent: string[];
          _receive: (data: unknown) => void;
        }>;
        last: () => {
          sent: string[];
          _receive: (data: unknown) => void;
        } | null;
      };
    }
  ).__wsMock;
  if (!registry) {
    throw new Error('Missing websocket registry');
  }
  return registry;
}

function parseSocketMessages() {
  const registry = getWsRegistry();
  const instances = registry.instances ?? [];
  return instances
    .flatMap((socket) => socket.sent)
    .map((entry) => {
      try {
        return JSON.parse(entry) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function getLatestSocket() {
  const registry = getWsRegistry();
  const socket = registry.instances?.at(-1) ?? registry.last();
  if (!socket) {
    throw new Error('No websocket instance found');
  }
  return socket;
}

function emitWsEvent(event: Record<string, unknown>) {
  const socket = getLatestSocket();
  act(() => {
    socket._receive({ protocolVersion: 'v1', ...event });
  });
}

async function findLatestCancelMessage() {
  await waitFor(() => {
    expect(
      parseSocketMessages().some(
        (message) => message.type === 'cancel_inflight',
      ),
    ).toBe(true);
  });

  const latest = parseSocketMessages()
    .filter((message) => message.type === 'cancel_inflight')
    .at(-1);
  if (!latest) {
    throw new Error('Expected a cancel_inflight websocket message');
  }
  return latest;
}

async function findLatestSubscribedConversationId() {
  await waitFor(() => {
    expect(
      parseSocketMessages().some(
        (message) => message.type === 'subscribe_conversation',
      ),
    ).toBe(true);
  });

  const latest = parseSocketMessages()
    .filter((message) => message.type === 'subscribe_conversation')
    .at(-1);
  return typeof latest?.conversationId === 'string'
    ? latest.conversationId
    : '';
}

function setupFlowsFetch(params?: {
  flows?: Array<{
    name: string;
    description: string;
    disabled: boolean;
    sourceId?: string;
    sourceLabel?: string;
  }>;
  conversations?: ConversationSummary[];
  turnsByConversation?: Record<string, StoredTurnPayload[]>;
  inflightByConversation?: Record<string, Record<string, unknown> | null>;
  runFlowFetch?: (
    body: FetchBody,
    init?: RequestInit,
  ) => Response | Promise<Response>;
}) {
  const runBodies: FetchBody[] = [];
  const flows = params?.flows ?? [
    { name: 'smoke', description: 'Smoke flow', disabled: false },
  ];
  const conversations = params?.conversations ?? [];
  const turnsByConversation = params?.turnsByConversation ?? {};
  const inflightByConversation = params?.inflightByConversation ?? {};

  mockFetch.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof url === 'string' ? url : url.toString();

    if (target.includes('/health')) {
      return mockJsonResponse({ mongoConnected: true });
    }

    if (target.includes('/flows') && !target.includes('/run')) {
      return mockJsonResponse({ flows });
    }

    if (target.includes('/conversations/') && target.includes('/turns')) {
      const conversationId =
        target.split('/conversations/')[1]?.split('/')[0] ?? '';
      return mockJsonResponse({
        items: turnsByConversation[conversationId] ?? [],
        inflight: inflightByConversation[conversationId] ?? null,
      });
    }

    if (target.includes('/conversations') && !target.includes('/turns')) {
      return mockJsonResponse({ items: conversations, nextCursor: null });
    }

    if (target.includes('/flows/smoke/run')) {
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as FetchBody)
          : {};
      runBodies.push(body);
      if (params?.runFlowFetch) {
        return Promise.resolve(params.runFlowFetch(body, init));
      }
      const conversationId =
        typeof body.conversationId === 'string'
          ? body.conversationId
          : 'flow-1';
      return mockJsonResponse(
        {
          status: 'started',
          flowName: 'smoke',
          conversationId,
          inflightId: 'flow-inflight-1',
          modelId: 'm1',
        },
        { status: 202 },
      );
    }

    return mockJsonResponse({});
  });

  return { runBodies };
}

async function waitForRunEnabled() {
  const runButton = await screen.findByTestId('flow-run');
  await waitFor(() => expect(runButton).toBeEnabled());
  return runButton;
}

async function startFlowRun(user: ReturnType<typeof userEvent.setup>) {
  const runButton = await waitForRunEnabled();
  await act(async () => {
    await user.click(runButton);
  });
}

describe('Flows page stop control', () => {
  it('shows visible stopping UX and disables duplicate stop actions while cancellation is pending', async () => {
    const user = userEvent.setup();
    let resolveRun: ((value: Response) => void) | null = null;
    const { runBodies } = setupFlowsFetch({
      runFlowFetch: () =>
        new Promise<Response>((resolve) => {
          resolveRun = resolve;
        }),
    });

    renderFlowsPage();
    await startFlowRun(user);

    await waitFor(() => expect(runBodies.length).toBe(1));
    const conversationId =
      typeof runBodies[0]?.conversationId === 'string'
        ? runBodies[0].conversationId
        : '';
    expect(conversationId).toBeTruthy();
    expect(await findLatestSubscribedConversationId()).toBe(conversationId);

    const stopButton = await screen.findByTestId('flow-stop');
    await waitFor(() => expect(stopButton).toBeEnabled());
    await act(async () => {
      await user.click(stopButton);
    });

    const cancelMessage = await findLatestCancelMessage();
    expect(cancelMessage).toEqual(
      expect.objectContaining({
        type: 'cancel_inflight',
        conversationId,
      }),
    );
    expect(cancelMessage).not.toHaveProperty('inflightId');

    await waitFor(() => expect(screen.getByTestId('flow-stop')).toBeDisabled());
    expect(screen.getByTestId('flow-stop')).toHaveTextContent('Stopping');

    await act(async () => {
      resolveRun?.(
        new Response(
          JSON.stringify({
            status: 'started',
            flowName: 'smoke',
            conversationId,
            inflightId: 'flow-inflight-1',
            modelId: 'm1',
          }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });

    emitWsEvent({
      type: 'inflight_snapshot',
      conversationId,
      seq: 1,
      inflight: {
        inflightId: 'flow-inflight-1',
        assistantText: 'Running flow step...',
        assistantThink: '',
        toolEvents: [],
        startedAt: '2026-03-09T00:00:00.000Z',
      },
    });

    expect(await screen.findByTestId('status-chip')).toHaveTextContent(
      'Stopping',
    );

    const cancelCount = parseSocketMessages().filter(
      (message) => message.type === 'cancel_inflight',
    ).length;
    expect(cancelCount).toBe(1);
  });

  it('returns to ready state on cancel_ack noop without rendering a fake terminal bubble', async () => {
    const user = userEvent.setup();
    let resolveRun: ((value: Response) => void) | null = null;
    const { runBodies } = setupFlowsFetch({
      runFlowFetch: () =>
        new Promise<Response>((resolve) => {
          resolveRun = resolve;
        }),
    });

    renderFlowsPage();
    await startFlowRun(user);

    await waitFor(() => expect(runBodies.length).toBe(1));
    const conversationId =
      typeof runBodies[0]?.conversationId === 'string'
        ? runBodies[0].conversationId
        : '';
    expect(conversationId).toBeTruthy();
    expect(await findLatestSubscribedConversationId()).toBe(conversationId);

    const stopButton = await screen.findByTestId('flow-stop');
    await waitFor(() => expect(stopButton).toBeEnabled());
    await act(async () => {
      await user.click(stopButton);
    });

    const cancelMessage = await findLatestCancelMessage();
    const requestId =
      typeof cancelMessage.requestId === 'string'
        ? cancelMessage.requestId
        : '';
    expect(requestId).toBeTruthy();
    expect(cancelMessage).not.toHaveProperty('inflightId');

    await act(async () => {
      resolveRun?.(
        new Response(
          JSON.stringify({
            status: 'started',
            flowName: 'smoke',
            conversationId,
            inflightId: 'flow-inflight-1',
            modelId: 'm1',
          }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });

    emitWsEvent({
      type: 'cancel_ack',
      conversationId,
      requestId,
      result: 'noop',
    });

    await waitFor(() => expect(screen.getByTestId('flow-run')).toBeEnabled());
    await waitFor(() => expect(screen.getByTestId('flow-stop')).toBeDisabled());
    expect(screen.queryByText(/^Stopped$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Stopping\.\.\.$/i }),
    ).not.toBeInTheDocument();
  });

  it('sends cancel_inflight with conversationId and no inflightId during the startup race', async () => {
    const user = userEvent.setup();
    let resolveRun: ((value: Response) => void) | null = null;
    const { runBodies } = setupFlowsFetch({
      runFlowFetch: () =>
        new Promise<Response>((resolve) => {
          resolveRun = resolve;
        }),
    });

    renderFlowsPage();
    await startFlowRun(user);

    await waitFor(() => expect(runBodies.length).toBe(1));
    const conversationId =
      typeof runBodies[0]?.conversationId === 'string'
        ? runBodies[0].conversationId
        : '';
    expect(conversationId).toBeTruthy();
    expect(await findLatestSubscribedConversationId()).toBe(conversationId);

    await waitFor(() => expect(screen.getByTestId('flow-stop')).toBeEnabled());
    await act(async () => {
      await user.click(await screen.findByTestId('flow-stop'));
    });

    const cancelMessage = await findLatestCancelMessage();
    expect(cancelMessage).toEqual(
      expect.objectContaining({
        type: 'cancel_inflight',
        conversationId,
      }),
    );
    expect(cancelMessage).not.toHaveProperty('inflightId');

    await act(async () => {
      resolveRun?.(
        new Response(
          JSON.stringify({
            status: 'started',
            flowName: 'smoke',
            conversationId,
            inflightId: 'flow-inflight-1',
            modelId: 'm1',
          }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });
  });

  it('waits for stopped finalization and allows same-conversation reuse after confirmed stop', async () => {
    const user = userEvent.setup();
    let resolveRun: ((value: Response) => void) | null = null;
    const { runBodies } = setupFlowsFetch({
      runFlowFetch: () =>
        new Promise<Response>((resolve) => {
          resolveRun = resolve;
        }),
    });

    renderFlowsPage();
    await startFlowRun(user);

    await waitFor(() => expect(runBodies.length).toBe(1));
    const conversationId =
      typeof runBodies[0]?.conversationId === 'string'
        ? runBodies[0].conversationId
        : '';
    expect(conversationId).toBeTruthy();
    expect(await findLatestSubscribedConversationId()).toBe(conversationId);

    await waitFor(() => expect(screen.getByTestId('flow-stop')).toBeEnabled());
    await act(async () => {
      await user.click(await screen.findByTestId('flow-stop'));
    });
    await findLatestCancelMessage();

    await act(async () => {
      resolveRun?.(
        new Response(
          JSON.stringify({
            status: 'started',
            flowName: 'smoke',
            conversationId,
            inflightId: 'flow-inflight-1',
            modelId: 'm1',
          }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });

    emitWsEvent({
      type: 'inflight_snapshot',
      conversationId,
      seq: 1,
      inflight: {
        inflightId: 'flow-inflight-1',
        assistantText: 'Working...',
        assistantThink: '',
        toolEvents: [],
        startedAt: '2026-03-09T00:00:00.000Z',
      },
    });

    emitWsEvent({
      type: 'turn_final',
      conversationId,
      inflightId: 'flow-inflight-1',
      seq: 2,
      status: 'stopped',
    });

    await waitFor(() =>
      expect(screen.getByTestId('status-chip')).toHaveTextContent('Stopped'),
    );

    await startFlowRun(user);

    await waitFor(() => expect(runBodies.length).toBe(2));
    expect(runBodies[1]?.conversationId).toBe(conversationId);
  });

  it('renders persisted stopped turns as visibly stopped after reload', async () => {
    const now = '2026-03-09T00:00:00.000Z';
    setupFlowsFetch({
      conversations: [
        {
          conversationId: 'flow-1',
          title: 'Flow: smoke',
          provider: 'codex',
          model: 'm1',
          source: 'REST',
          lastMessageAt: now,
          archived: false,
          flowName: 'smoke',
          flags: {},
        },
      ],
      turnsByConversation: {
        'flow-1': [
          {
            turnId: 'turn-stopped-1',
            conversationId: 'flow-1',
            role: 'assistant',
            content: 'Stopped after the stop request.',
            model: 'm1',
            provider: 'codex',
            status: 'stopped',
            createdAt: now,
            command: {
              name: 'flow',
              stepIndex: 1,
              totalSteps: 1,
              label: 'smoke',
            },
          },
        ],
      },
    });

    renderFlowsPage();

    await waitFor(() =>
      expect(screen.getByTestId('status-chip')).toHaveTextContent('Stopped'),
    );
  });

  it('recovers if the page unmounts while stopping is still pending', async () => {
    const user = userEvent.setup();
    let resolveRun: ((value: Response) => void) | null = null;
    const { runBodies } = setupFlowsFetch({
      runFlowFetch: () =>
        new Promise<Response>((resolve) => {
          resolveRun = resolve;
        }),
    });
    const router = renderFlowsPage();

    await startFlowRun(user);
    await waitFor(() => expect(runBodies.length).toBe(1));
    const conversationId =
      typeof runBodies[0]?.conversationId === 'string'
        ? runBodies[0].conversationId
        : '';
    expect(conversationId).toBeTruthy();
    expect(await findLatestSubscribedConversationId()).toBe(conversationId);

    await waitFor(() => expect(screen.getByTestId('flow-stop')).toBeEnabled());
    await act(async () => {
      await user.click(await screen.findByTestId('flow-stop'));
    });
    const cancelMessage = await findLatestCancelMessage();
    const requestId =
      typeof cancelMessage.requestId === 'string'
        ? cancelMessage.requestId
        : '';
    expect(requestId).toBeTruthy();

    await act(async () => {
      await router.navigate('/');
    });

    emitWsEvent({
      type: 'cancel_ack',
      conversationId,
      requestId,
      result: 'noop',
    });

    await act(async () => {
      resolveRun?.(
        new Response(
          JSON.stringify({
            status: 'started',
            flowName: 'smoke',
            conversationId,
            inflightId: 'flow-inflight-1',
            modelId: 'm1',
          }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });

    await act(async () => {
      await router.navigate('/flows');
    });

    await waitFor(() => expect(screen.getByTestId('flow-run')).toBeEnabled());
    expect(screen.getByTestId('flow-stop')).toBeDisabled();
    expect(screen.queryByText(/^Stopping$/i)).not.toBeInTheDocument();
  });
});
