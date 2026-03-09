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

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
  (
    globalThis as unknown as {
      __codeinfoDebug?: { dev0000038Markers?: boolean };
    }
  ).__codeinfoDebug = undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
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

type FetchBody = Record<string, unknown>;
type ConversationSummary = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  lastMessageAt: string;
  archived?: boolean;
};

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderAgentsPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
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

function getLatestSubscribeConversationId() {
  const subscribe = parseSocketMessages()
    .filter((message) => message.type === 'subscribe_conversation')
    .at(-1);
  return typeof subscribe?.conversationId === 'string'
    ? subscribe.conversationId
    : '';
}

function setupAgentsFetch(params?: {
  conversations?: ConversationSummary[];
  turnsByConversation?: Record<string, unknown[]>;
  instructionRunFetch?: (
    body: FetchBody,
    init?: RequestInit,
  ) => Response | Promise<Response>;
  commandRunFetch?: (
    body: FetchBody,
    init?: RequestInit,
  ) => Response | Promise<Response>;
}) {
  const instructionBodies: FetchBody[] = [];
  const commandBodies: FetchBody[] = [];
  const conversations = params?.conversations ?? [];
  const turnsByConversation = params?.turnsByConversation ?? {};

  mockFetch.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof url === 'string' ? url : url.toString();

    if (target.includes('/health')) {
      return mockJsonResponse({ mongoConnected: true });
    }

    if (
      target.includes('/agents') &&
      !target.includes('/commands') &&
      !target.includes('/run')
    ) {
      return mockJsonResponse({ agents: [{ name: 'a1' }] });
    }

    if (target.includes('/agents/a1/commands') && !target.includes('/run')) {
      return mockJsonResponse({
        commands: [
          {
            name: 'improve_plan',
            description: 'Improve the plan',
            disabled: false,
            stepCount: 2,
          },
        ],
      });
    }

    if (target.includes('/conversations/') && target.includes('/turns')) {
      const conversationId =
        target.split('/conversations/')[1]?.split('/')[0] ?? '';
      return mockJsonResponse({
        items: turnsByConversation[conversationId] ?? [],
        inflight: null,
      });
    }

    if (target.includes('/conversations') && !target.includes('/turns')) {
      return mockJsonResponse({
        items: conversations,
        nextCursor: null,
      });
    }

    if (target.includes('/agents/a1/run')) {
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as FetchBody)
          : {};
      instructionBodies.push(body);
      if (params?.instructionRunFetch) {
        return Promise.resolve(params.instructionRunFetch(body, init));
      }
      return mockJsonResponse(
        {
          status: 'started',
          agentName: 'a1',
          conversationId:
            typeof body.conversationId === 'string'
              ? body.conversationId
              : 'c1',
          inflightId: 'i1',
          modelId: 'm1',
        },
        { status: 202 },
      );
    }

    if (target.includes('/agents/a1/commands/run')) {
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as FetchBody)
          : {};
      commandBodies.push(body);
      if (params?.commandRunFetch) {
        return Promise.resolve(params.commandRunFetch(body, init));
      }
      return mockJsonResponse(
        {
          status: 'started',
          agentName: 'a1',
          commandName: 'improve_plan',
          conversationId:
            typeof body.conversationId === 'string'
              ? body.conversationId
              : 'c1',
          modelId: 'm1',
        },
        { status: 202 },
      );
    }

    return mockJsonResponse({});
  });

  return { instructionBodies, commandBodies };
}

async function openCommandPicker(user: ReturnType<typeof userEvent.setup>) {
  const commandSelect = await screen.findByRole('combobox', {
    name: /command/i,
  });
  await waitFor(() => expect(commandSelect).toBeEnabled());
  await user.click(commandSelect);
  const option = await screen.findByTestId(
    'agent-command-option-improve_plan::local',
  );
  await user.click(option);
  await user.keyboard('{Escape}');
}

async function clickExecuteCommand(user: ReturnType<typeof userEvent.setup>) {
  const execute = await screen.findByTestId('agent-command-execute');
  await waitFor(() => expect(execute).toBeEnabled());
  await user.click(execute);
}

async function startInstructionRun(
  user: ReturnType<typeof userEvent.setup>,
  instruction: string,
) {
  const input = await screen.findByTestId('agent-input');
  fireEvent.change(input, { target: { value: instruction } });
  const send = await screen.findByTestId('agent-send');
  await waitFor(() => expect(send).toBeEnabled());
  await user.click(send);
}

describe('Agents page stop control', () => {
  it('shows visible stopping UX and disables duplicate stop actions while cancellation is pending for command runs', async () => {
    const user = userEvent.setup();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    setupAgentsFetch();
    renderAgentsPage();

    await openCommandPicker(user);
    await clickExecuteCommand(user);

    const conversationId = getLatestSubscribeConversationId();
    expect(conversationId).toBeTruthy();

    emitWsEvent({
      type: 'inflight_snapshot',
      conversationId,
      seq: 1,
      inflight: {
        inflightId: 'i1',
        assistantText: '',
        assistantThink: '',
        toolEvents: [],
        startedAt: '2025-01-01T00:00:00.000Z',
        command: {
          name: 'improve_plan',
          stepIndex: 1,
          totalSteps: 2,
        },
      },
    });

    const statusChip = await screen.findByTestId('status-chip');
    await waitFor(() => expect(statusChip).toHaveTextContent('Processing'));

    const stopButton = await screen.findByTestId('agent-stop');
    await waitFor(() => expect(stopButton).toBeEnabled());
    await user.click(stopButton);

    const cancelMessage = await findLatestCancelMessage();
    expect(cancelMessage).toEqual(
      expect.objectContaining({
        type: 'cancel_inflight',
        conversationId,
        inflightId: 'i1',
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('agent-stop')).toBeDisabled(),
    );
    expect(screen.getByTestId('agent-stop')).toHaveTextContent('Stopping...');
    expect(await screen.findByTestId('status-chip')).toHaveTextContent(
      'Stopping',
    );
    expect(
      parseSocketMessages().filter(
        (message) => message.type === 'cancel_inflight',
      ),
    ).toHaveLength(1);

    expect(infoSpy).toHaveBeenCalledWith(
      '[stop-debug][agents-ui] stop-clicked',
      {
        conversationId,
        inflightId: 'i1',
        runKind: 'command',
      },
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[stop-debug][agents-ui] stopping-visible',
      {
        conversationId,
        runKind: 'command',
      },
    );
  });

  it('returns command runs to ready state on cancel_ack noop without rendering a fake stopped bubble', async () => {
    const user = userEvent.setup();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    let resolveCommandStart: ((value: Response) => void) | null = null;

    setupAgentsFetch({
      commandRunFetch: () =>
        new Promise<Response>((resolve) => {
          resolveCommandStart = resolve;
        }),
    });

    renderAgentsPage();
    await openCommandPicker(user);
    await clickExecuteCommand(user);

    const stopButton = await screen.findByTestId('agent-stop');
    await waitFor(() => expect(stopButton).toBeEnabled());
    await user.click(stopButton);

    const cancelMessage = await findLatestCancelMessage();
    const conversationId =
      typeof cancelMessage.conversationId === 'string'
        ? cancelMessage.conversationId
        : '';
    const requestId =
      typeof cancelMessage.requestId === 'string'
        ? cancelMessage.requestId
        : '';
    expect(conversationId).toBeTruthy();
    expect(requestId).toBeTruthy();
    expect(cancelMessage).not.toHaveProperty('inflightId');

    await act(async () => {
      resolveCommandStart?.(
        new Response(
          JSON.stringify({
            status: 'started',
            agentName: 'a1',
            commandName: 'improve_plan',
            conversationId,
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

    await waitFor(() =>
      expect(screen.queryByTestId('agent-stop')).not.toBeInTheDocument(),
    );
    expect(await screen.findByTestId('agent-command-execute')).toBeEnabled();
    expect(screen.queryByText(/^Stopped$/i)).not.toBeInTheDocument();
    expect(
      infoSpy.mock.calls.some(
        (call) => call[0] === '[stop-debug][agents-ui] stopped-visible',
      ),
    ).toBe(false);
  });

  it('sends conversation-only cancel_inflight for command runs before a client-visible inflightId exists', async () => {
    const user = userEvent.setup();
    let resolveCommandStart: ((value: Response) => void) | null = null;

    setupAgentsFetch({
      commandRunFetch: () =>
        new Promise<Response>((resolve) => {
          resolveCommandStart = resolve;
        }),
    });

    renderAgentsPage();
    await openCommandPicker(user);
    await clickExecuteCommand(user);

    await waitFor(() => expect(screen.getByTestId('agent-stop')).toBeEnabled());
    await user.click(screen.getByTestId('agent-stop'));

    const cancelMessage = await findLatestCancelMessage();
    expect(cancelMessage).toEqual(
      expect.objectContaining({
        type: 'cancel_inflight',
        conversationId: expect.any(String),
      }),
    );
    expect(cancelMessage).not.toHaveProperty('inflightId');
    expect(resolveCommandStart).not.toBeNull();
  });

  it('sends conversation-only cancel_inflight for instruction runs before a client-visible inflightId exists', async () => {
    const user = userEvent.setup();
    let resolveInstructionStart: ((value: Response) => void) | null = null;
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    setupAgentsFetch({
      instructionRunFetch: () =>
        new Promise<Response>((resolve) => {
          resolveInstructionStart = resolve;
        }),
    });

    renderAgentsPage();
    await startInstructionRun(user, 'Draft a summary');

    await waitFor(() => expect(screen.getByTestId('agent-stop')).toBeEnabled());
    await user.click(screen.getByTestId('agent-stop'));

    const cancelMessage = await findLatestCancelMessage();
    expect(cancelMessage).toEqual(
      expect.objectContaining({
        type: 'cancel_inflight',
        conversationId: expect.any(String),
      }),
    );
    expect(cancelMessage).not.toHaveProperty('inflightId');
    expect(resolveInstructionStart).not.toBeNull();
    expect(infoSpy).toHaveBeenCalledWith(
      '[stop-debug][agents-ui] stop-clicked',
      {
        conversationId: cancelMessage.conversationId,
        runKind: 'instruction',
      },
    );
  });

  it('waits for stopped synchronization and allows same-conversation command reuse after confirmation', async () => {
    const user = userEvent.setup();
    const { commandBodies } = setupAgentsFetch({
      conversations: [
        {
          conversationId: 'c1',
          title: 'Current conversation',
          provider: 'codex',
          model: 'm1',
          lastMessageAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });

    renderAgentsPage();
    await openCommandPicker(user);
    await clickExecuteCommand(user);

    const conversationId = getLatestSubscribeConversationId();
    expect(conversationId).toBeTruthy();

    emitWsEvent({
      type: 'inflight_snapshot',
      conversationId,
      seq: 1,
      inflight: {
        inflightId: 'i1',
        assistantText: '',
        assistantThink: '',
        toolEvents: [],
        startedAt: '2025-01-01T00:00:00.000Z',
        command: {
          name: 'improve_plan',
          stepIndex: 1,
          totalSteps: 2,
        },
      },
    });

    await waitFor(() => expect(screen.getByTestId('agent-stop')).toBeEnabled());
    await user.click(await screen.findByTestId('agent-stop'));
    const cancelMessage = await findLatestCancelMessage();
    expect(cancelMessage).toMatchObject({
      type: 'cancel_inflight',
      conversationId,
      inflightId: 'i1',
    });

    emitWsEvent({
      type: 'turn_final',
      conversationId,
      seq: 2,
      inflightId: 'i1',
      status: 'stopped',
    });

    const statusChip = await screen.findByTestId('status-chip');
    await waitFor(() => expect(statusChip).toHaveTextContent('Stopped'));

    await waitFor(() =>
      expect(screen.queryByTestId('agent-stop')).not.toBeInTheDocument(),
    );

    await clickExecuteCommand(user);
    await waitFor(() => expect(commandBodies).toHaveLength(2));
    expect(commandBodies[0]).toMatchObject({ conversationId });
    expect(commandBodies[1]).toMatchObject({ conversationId });
  });

  it('recovers when the active conversation changes while stopping is still pending', async () => {
    const user = userEvent.setup();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    setupAgentsFetch({
      conversations: [
        {
          conversationId: 'c1',
          title: 'Current conversation',
          provider: 'codex',
          model: 'm1',
          lastMessageAt: '2025-01-01T00:00:00.000Z',
        },
        {
          conversationId: 'c2',
          title: 'Other conversation',
          provider: 'codex',
          model: 'm1',
          lastMessageAt: '2025-01-01T00:00:01.000Z',
        },
      ],
    });

    renderAgentsPage();
    await openCommandPicker(user);
    await clickExecuteCommand(user);

    const conversationId = getLatestSubscribeConversationId();
    expect(conversationId).toBeTruthy();

    emitWsEvent({
      type: 'inflight_snapshot',
      conversationId,
      seq: 1,
      inflight: {
        inflightId: 'i1',
        assistantText: '',
        assistantThink: '',
        toolEvents: [],
        startedAt: '2025-01-01T00:00:00.000Z',
        command: {
          name: 'improve_plan',
          stepIndex: 1,
          totalSteps: 2,
        },
      },
    });

    await waitFor(() => expect(screen.getByTestId('agent-stop')).toBeEnabled());
    await user.click(await screen.findByTestId('agent-stop'));
    await waitFor(() =>
      expect(screen.getByTestId('agent-stop')).toBeDisabled(),
    );
    await user.click(await screen.findByText('Other conversation'));

    await waitFor(() =>
      expect(screen.queryByTestId('status-chip')).not.toBeInTheDocument(),
    );

    emitWsEvent({
      type: 'turn_final',
      conversationId,
      seq: 2,
      inflightId: 'i1',
      status: 'stopped',
    });

    expect(screen.queryByTestId('status-chip')).not.toBeInTheDocument();
    expect(
      infoSpy.mock.calls.some((call) => {
        if (call[0] !== '[stop-debug][agents-ui] stopped-visible') return false;
        const payload = call[1] as Record<string, unknown> | undefined;
        return payload?.conversationId === 'c2';
      }),
    ).toBe(false);
  });
});
