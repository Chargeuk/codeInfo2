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
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (
    globalThis as unknown as { __wsMock?: { reset: () => void } }
  ).__wsMock?.reset();
});

const { default: App } = await import('../App');
const { default: ChatPage } = await import('../pages/ChatPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'chat', element: <ChatPage /> },
    ],
  },
];

const parseSocketMessages = () => {
  const wsRegistry = (
    globalThis as unknown as {
      __wsMock?: { instances?: Array<{ sent: string[] }> };
    }
  ).__wsMock;

  return (wsRegistry?.instances ?? [])
    .flatMap((socket) => socket.sent)
    .map((entry) => {
      try {
        return JSON.parse(entry) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
};

const findLatestCancel = async () => {
  await waitFor(() => {
    expect(
      parseSocketMessages().some(
        (message) => message.type === 'cancel_inflight',
      ),
    ).toBe(true);
  });

  const cancelMessages = parseSocketMessages().filter(
    (message) => message.type === 'cancel_inflight',
  );
  const latest = cancelMessages.at(-1);
  if (!latest) {
    throw new Error('Expected at least one cancel_inflight message');
  }
  return latest;
};

const renderChatPage = () => {
  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);
  return router;
};

const startChatTurn = async (
  user: ReturnType<typeof userEvent.setup>,
  prompt: string,
) => {
  const input = await screen.findByTestId('chat-input');
  fireEvent.change(input, { target: { value: prompt } });
  const sendButton = await screen.findByTestId('chat-send');
  await waitFor(() => expect(sendButton).toBeEnabled());
  await act(async () => {
    await user.click(sendButton);
  });
  return { input, sendButton };
};

describe('Chat page stop control', () => {
  it('shows visible stopping UX and disables duplicate stop actions while cancellation is pending', async () => {
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    renderChatPage();
    await startChatTurn(user, 'Hello');
    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });

    const stopButton = await screen.findByTestId('chat-stop');
    await act(async () => {
      await user.click(stopButton);
    });

    const cancelMessage = await findLatestCancel();
    expect(cancelMessage).toEqual(
      expect.objectContaining({
        type: 'cancel_inflight',
        conversationId,
        inflightId,
      }),
    );

    await waitFor(() => expect(screen.getByTestId('chat-stop')).toBeDisabled());
    expect(screen.getByTestId('chat-stop')).toHaveTextContent('Stopping');
    expect(await screen.findByTestId('status-chip')).toHaveTextContent(
      'Stopping',
    );

    const cancelCount = parseSocketMessages().filter(
      (message) => message.type === 'cancel_inflight',
    ).length;
    expect(cancelCount).toBe(1);
  });

  it('returns to ready state on cancel_ack noop without rendering a fake terminal stopped bubble', async () => {
    let resolveChatStart: ((value: Response) => void) | null = null;
    const harness = setupChatWsHarness({
      mockFetch,
      chatFetch: () =>
        new Promise<Response>((resolve) => {
          resolveChatStart = resolve;
        }),
    });
    const user = userEvent.setup();

    renderChatPage();
    const { sendButton } = await startChatTurn(user, 'Hello');
    await waitFor(() => expect(resolveChatStart).not.toBeNull());

    const chatBody = harness.chatBodies.at(-1);
    const conversationId =
      typeof chatBody?.conversationId === 'string'
        ? chatBody.conversationId
        : null;
    expect(conversationId).toBeTruthy();

    await act(async () => {
      await user.click(await screen.findByTestId('chat-stop'));
    });

    const cancelMessage = await findLatestCancel();
    const requestId =
      typeof cancelMessage.requestId === 'string'
        ? cancelMessage.requestId
        : '';
    expect(requestId).toBeTruthy();
    expect(cancelMessage).not.toHaveProperty('inflightId');

    await act(async () => {
      resolveChatStart?.(
        new Response(
          JSON.stringify({
            status: 'started',
            conversationId,
            inflightId: 'i1',
            provider: 'lmstudio',
            model: 'm1',
          }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });

    harness.emitCancelAck({
      conversationId: conversationId!,
      requestId,
      result: 'noop',
    });

    await waitFor(() =>
      expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(sendButton).toBeEnabled());
    expect(screen.queryByText(/generation stopped/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Stopped$/i)).not.toBeInTheDocument();
  });

  it('sends cancel_inflight with conversationId and no inflightId during the startup race', async () => {
    let resolveChatStart: ((value: Response) => void) | null = null;
    const harness = setupChatWsHarness({
      mockFetch,
      chatFetch: () =>
        new Promise<Response>((resolve) => {
          resolveChatStart = resolve;
        }),
    });
    const user = userEvent.setup();

    renderChatPage();
    await startChatTurn(user, 'Hello');
    await waitFor(() => expect(resolveChatStart).not.toBeNull());

    const chatBody = harness.chatBodies.at(-1);
    const conversationId =
      typeof chatBody?.conversationId === 'string'
        ? chatBody.conversationId
        : null;
    expect(conversationId).toBeTruthy();

    await act(async () => {
      await user.click(await screen.findByTestId('chat-stop'));
    });

    const cancelMessage = await findLatestCancel();
    expect(cancelMessage).toEqual(
      expect.objectContaining({
        type: 'cancel_inflight',
        conversationId,
      }),
    );
    expect(cancelMessage).not.toHaveProperty('inflightId');

    await act(async () => {
      resolveChatStart?.(
        new Response(
          JSON.stringify({
            status: 'started',
            conversationId,
            inflightId: 'i1',
            provider: 'lmstudio',
            model: 'm1',
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
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    renderChatPage();
    const { input } = await startChatTurn(user, 'Hello');
    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });
    harness.emitAssistantDelta({
      conversationId: conversationId!,
      inflightId,
      delta: 'Partial reply',
    });

    await act(async () => {
      await user.click(await screen.findByTestId('chat-stop'));
    });

    harness.emitFinal({
      conversationId: conversationId!,
      inflightId,
      status: 'stopped',
    });

    const statusChip = await screen.findByTestId('status-chip');
    await waitFor(() => expect(statusChip).toHaveTextContent('Stopped'));
    await waitFor(() =>
      expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument(),
    );

    fireEvent.change(input, { target: { value: 'Second turn' } });
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(sendButton).toBeEnabled());

    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(2));
    expect(harness.chatBodies[1]?.conversationId).toBe(conversationId);
  });

  it('renders persisted stopped turns as visibly stopped after reload', async () => {
    const harness = setupChatWsHarness({
      mockFetch,
      conversations: {
        items: [
          {
            conversationId: 'c1',
            title: 'Stopped conversation',
            provider: 'lmstudio',
            model: 'm1',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
          },
        ],
        nextCursor: null,
      },
      turns: {
        items: [
          {
            turnId: 'turn-user',
            conversationId: 'c1',
            role: 'user',
            content: 'Hello',
            model: 'm1',
            provider: 'lmstudio',
            status: 'ok',
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          {
            turnId: 'turn-stopped',
            conversationId: 'c1',
            role: 'assistant',
            content: 'Stopped reply',
            model: 'm1',
            provider: 'lmstudio',
            status: 'stopped',
            createdAt: '2025-01-01T00:00:01.000Z',
          },
        ],
        nextCursor: null,
      },
    });

    renderChatPage();
    await screen.findByText('Stopped conversation');

    await act(async () => {
      await userEvent.setup().click(screen.getByText('Stopped conversation'));
    });

    expect(await screen.findByText('Stopped reply')).toBeInTheDocument();
    const statusChip = await screen.findByTestId('status-chip');
    await waitFor(() => expect(statusChip).toHaveTextContent('Stopped'));
    expect(harness.chatBodies).toHaveLength(0);
  });

  it('recovers cleanly if the active conversation changes while stopping is still pending', async () => {
    const harness = setupChatWsHarness({
      mockFetch,
      conversations: {
        items: [
          {
            conversationId: 'c1',
            title: 'Conversation one',
            provider: 'lmstudio',
            model: 'm1',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
          },
          {
            conversationId: 'c2',
            title: 'Conversation two',
            provider: 'lmstudio',
            model: 'm1',
            lastMessageAt: '2025-01-01T00:01:00.000Z',
            archived: false,
          },
        ],
        nextCursor: null,
      },
      turns: {
        items: [],
        nextCursor: null,
      },
    });
    const user = userEvent.setup();

    renderChatPage();

    const rows = await screen.findAllByTestId('conversation-row');
    const firstConversation = rows.find((row) =>
      row.textContent?.includes('Conversation one'),
    );
    if (!firstConversation) {
      throw new Error('Missing Conversation one row');
    }
    await act(async () => {
      await user.click(firstConversation);
    });

    await startChatTurn(user, 'Hello');
    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    expect(conversationId).toBe('c1');

    await act(async () => {
      await user.click(await screen.findByTestId('chat-stop'));
    });

    const cancelMessage = await findLatestCancel();
    const requestId =
      typeof cancelMessage.requestId === 'string'
        ? cancelMessage.requestId
        : '';
    expect(requestId).toBeTruthy();

    const nextRows = await screen.findAllByTestId('conversation-row');
    const secondConversation = nextRows.find((row) =>
      row.textContent?.includes('Conversation two'),
    );
    if (!secondConversation) {
      throw new Error('Missing Conversation two row');
    }
    await act(async () => {
      await user.click(secondConversation);
    });

    await waitFor(() =>
      expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('status-chip')).not.toBeInTheDocument();

    harness.emitCancelAck({
      conversationId: 'c1',
      requestId,
      result: 'noop',
    });

    await waitFor(() =>
      expect(screen.queryByText(/^Stopped$/i)).not.toBeInTheDocument(),
    );
    expect(await screen.findByTestId('chat-input')).toBeEnabled();
  });

  it('keeps explicit stop targeting on the active run after a stale older turn_final arrives', async () => {
    let runIndex = 0;
    const harness = setupChatWsHarness({
      mockFetch,
      chatFetch: (body) => {
        runIndex += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'started',
              conversationId: body.conversationId,
              inflightId: `i${runIndex}`,
              provider: 'lmstudio',
              model: 'm1',
            }),
            {
              status: 202,
              headers: { 'content-type': 'application/json' },
            },
          ),
        );
      },
    });
    const user = userEvent.setup();

    renderChatPage();

    const { sendButton } = await startChatTurn(user, 'First run');
    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId: 'i1',
      assistantText: '',
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId: 'i1',
      status: 'ok',
    });

    await waitFor(() => expect(sendButton).toBeEnabled());

    await startChatTurn(user, 'Second run');
    await waitFor(() => expect(harness.chatBodies.length).toBe(2));

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId: 'i2',
      assistantText: '',
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId: 'i1',
      status: 'failed',
      error: {
        code: 'INFLIGHT_NOT_FOUND',
        message: 'Stale stop request ignored for the replacement run',
      },
    });

    await act(async () => {
      await user.click(await screen.findByTestId('chat-stop'));
    });

    const cancelMessage = await findLatestCancel();
    expect(cancelMessage).toEqual(
      expect.objectContaining({
        type: 'cancel_inflight',
        conversationId,
        inflightId: 'i2',
      }),
    );
  });
});
