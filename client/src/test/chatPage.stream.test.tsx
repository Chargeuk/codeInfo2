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

afterEach(() => {
  jest.useRealTimers();
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

describe('Chat WS streaming UI', () => {
  it('renders Processing then Complete as transcript events arrive', async () => {
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = await screen.findByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });

    const statusChip = await screen.findByTestId('status-chip');
    expect(statusChip).toHaveTextContent('Processing');

    harness.emitAssistantDelta({
      conversationId: conversationId!,
      inflightId,
      delta: 'Done',
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId,
      status: 'ok',
    });

    await waitFor(() => expect(statusChip).toHaveTextContent('Complete'));
    expect(await screen.findByText('Done')).toBeInTheDocument();
  });

  it('treats transient reconnect notices as warnings (no failed bubble)', async () => {
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = await screen.findByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });

    harness.emitStreamWarning({
      conversationId: conversationId!,
      inflightId,
      message: 'Reconnecting... 1/5',
    });

    harness.emitAssistantDelta({
      conversationId: conversationId!,
      inflightId,
      delta: 'Still going',
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId,
      status: 'ok',
    });

    const statusChip = await screen.findByTestId('status-chip');
    await waitFor(() => expect(statusChip).toHaveTextContent('Complete'));
    expect(await screen.findByText('Still going')).toBeInTheDocument();
    expect(await screen.findByText('Reconnecting... 1/5')).toBeInTheDocument();
    expect(statusChip).not.toHaveTextContent('Failed');
  });

  it('does not send cancel_inflight when navigating away from the page', async () => {
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = await screen.findByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    await act(async () => {
      await router.navigate('/');
    });

    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { instances?: Array<{ sent: string[] }> };
      }
    ).__wsMock;
    const sent = (wsRegistry?.instances ?? []).flatMap((socket) => socket.sent);

    const cancel = sent
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .some((msg) => msg?.type === 'cancel_inflight');

    expect(cancel).toBe(false);
  });

  it('accepts new inflight runs when sequence numbers reset', async () => {
    const previousFlag = (
      globalThis as unknown as { __CODEINFO_TEST__?: boolean }
    ).__CODEINFO_TEST__;
    const windowRef = (
      globalThis as unknown as { window?: { __CODEINFO_TEST__?: boolean } }
    ).window;

    (
      globalThis as unknown as { __CODEINFO_TEST__?: boolean }
    ).__CODEINFO_TEST__ = false;
    if (windowRef) {
      windowRef.__CODEINFO_TEST__ = false;
      (windowRef as unknown as { __chatTest?: unknown }).__chatTest = undefined;
    }

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const harness = setupChatWsHarness({ mockFetch });
      const user = userEvent.setup();

      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      const input = await screen.findByTestId('chat-input');
      fireEvent.change(input, { target: { value: 'Hello' } });
      const sendButton = await screen.findByTestId('chat-send');

      await waitFor(() => expect(sendButton).toBeEnabled());
      await act(async () => {
        await user.click(sendButton);
      });

      await waitFor(() => expect(harness.chatBodies.length).toBe(1));

      const conversationId = harness.getConversationId();
      const inflightId = harness.getInflightId() ?? 'i1';

      harness.setSeq(40);
      harness.emitInflightSnapshot({
        conversationId: conversationId!,
        inflightId,
        assistantText: '',
      });
      harness.emitAssistantDelta({
        conversationId: conversationId!,
        inflightId,
        delta: 'First',
      });
      harness.emitFinal({
        conversationId: conversationId!,
        inflightId,
        status: 'ok',
      });

      expect(await screen.findByText('First')).toBeInTheDocument();

      fireEvent.change(input, { target: { value: 'Again' } });
      await act(async () => {
        await user.click(sendButton);
      });

      await waitFor(() => expect(harness.chatBodies.length).toBe(2));

      const inflightId2 = harness.getInflightId() ?? 'i2';
      harness.setSeq(0);
      harness.emitInflightSnapshot({
        conversationId: conversationId!,
        inflightId: inflightId2,
        assistantText: '',
      });
      harness.emitAssistantDelta({
        conversationId: conversationId!,
        inflightId: inflightId2,
        delta: 'Second',
      });
      harness.emitFinal({
        conversationId: conversationId!,
        inflightId: inflightId2,
        status: 'ok',
      });

      expect(await screen.findByText('Second')).toBeInTheDocument();

      const staleLog = logSpy.mock.calls.find(([entry]) => {
        if (!entry || typeof entry !== 'object') return false;
        const record = entry as { message?: string; context?: unknown };
        if (record.message !== 'chat.ws.client_stale_event_ignored')
          return false;
        const context = record.context as { inflightId?: string } | undefined;
        return context?.inflightId === inflightId2;
      });
      expect(staleLog).toBeUndefined();
    } finally {
      logSpy.mockRestore();
      (
        globalThis as unknown as { __CODEINFO_TEST__?: boolean }
      ).__CODEINFO_TEST__ = previousFlag;
      if (windowRef) {
        windowRef.__CODEINFO_TEST__ = previousFlag;
      }
    }
  });

  it('keeps streaming transcript when empty history hydration arrives', async () => {
    const harness = setupChatWsHarness({
      mockFetch,
      turns: { items: [], nextCursor: null },
    });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = await screen.findByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });
    harness.emitAssistantDelta({
      conversationId: conversationId!,
      inflightId,
      delta: 'Streaming reply',
    });

    expect(await screen.findByText('Streaming reply')).toBeInTheDocument();

    harness.emitSidebarUpsert({
      conversationId: conversationId!,
      title: 'Hello',
      provider: 'lmstudio',
      model: 'm1',
      source: 'REST',
      lastMessageAt: '2025-01-01T00:00:00.000Z',
      archived: false,
    });

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some((call) => String(call[0]).includes('/turns')),
      ).toBe(true),
    );

    expect(screen.getByText('Streaming reply')).toBeInTheDocument();
  });

  it('dedupes hydrated turns against in-flight bubbles', async () => {
    const now = Date.now();
    const userText = 'User message 123';
    const assistantText = 'Assistant reply 123';
    const turnsPayload = {
      items: [
        {
          conversationId: 'c1',
          role: 'assistant',
          content: assistantText,
          model: 'm1',
          provider: 'lmstudio',
          status: 'ok',
          createdAt: new Date(now + 2 * 60 * 1000).toISOString(),
        },
        {
          conversationId: 'c1',
          role: 'user',
          content: userText,
          model: 'm1',
          provider: 'lmstudio',
          status: 'ok',
          createdAt: new Date(now).toISOString(),
        },
      ],
      nextCursor: null,
    };

    const harness = setupChatWsHarness({
      mockFetch,
      turns: turnsPayload,
    });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: userText } });
    const sendButton = await screen.findByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });
    harness.emitAssistantDelta({
      conversationId: conversationId!,
      inflightId,
      delta: assistantText,
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId,
      status: 'ok',
    });

    expect(await screen.findByText(assistantText)).toBeInTheDocument();

    harness.emitSidebarUpsert({
      conversationId: conversationId!,
      title: 'Hydration test',
      provider: 'lmstudio',
      model: 'm1',
      source: 'REST',
      lastMessageAt: new Date(now + 3 * 60 * 1000).toISOString(),
      archived: false,
    });

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some((call) => String(call[0]).includes('/turns')),
      ).toBe(true),
    );

    expect(screen.getAllByText(userText)).toHaveLength(1);
    expect(screen.getAllByText(assistantText)).toHaveLength(1);
  });

  it('keeps prior assistant turns on focus-triggered snapshot refresh (multi-window follow-up)', async () => {
    const turnsPayload = {
      items: [
        {
          conversationId: 'c1',
          role: 'assistant',
          content: 'Assistant A',
          model: 'm1',
          provider: 'lmstudio',
          status: 'ok',
          createdAt: '2025-01-01T00:00:10.000Z',
        },
        {
          conversationId: 'c1',
          role: 'user',
          content: 'User A',
          model: 'm1',
          provider: 'lmstudio',
          status: 'ok',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    };

    setupChatWsHarness({
      mockFetch,
      conversations: {
        items: [
          {
            conversationId: 'c1',
            title: 'Conversation 1',
            provider: 'lmstudio',
            model: 'm1',
            source: 'REST',
            lastMessageAt: '2025-01-01T00:00:10.000Z',
            archived: false,
            flags: {},
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:10.000Z',
          },
        ],
        nextCursor: null,
      },
      turns: turnsPayload,
    });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const titleNode = await screen.findByText('Conversation 1');
    const row = titleNode.closest('[data-testid="conversation-row"]');
    expect(row).toBeTruthy();
    await act(async () => {
      await user.click(row!);
    });

    expect(await screen.findByText('User A')).toBeInTheDocument();
    expect(await screen.findByText('Assistant A')).toBeInTheDocument();

    const turnsCallsBefore = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes('/turns'),
    ).length;

    turnsPayload.items = [
      {
        conversationId: 'c1',
        role: 'assistant',
        content: 'Assistant B',
        model: 'm1',
        provider: 'lmstudio',
        status: 'ok',
        createdAt: '2025-01-01T00:01:10.000Z',
      },
      {
        conversationId: 'c1',
        role: 'user',
        content: 'User B',
        model: 'm1',
        provider: 'lmstudio',
        status: 'ok',
        createdAt: '2025-01-01T00:01:00.000Z',
      },
      ...turnsPayload.items,
    ];

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      const turnsCallsAfter = mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/turns'),
      ).length;
      expect(turnsCallsAfter).toBeGreaterThan(turnsCallsBefore);
    });

    expect(await screen.findByText('User B')).toBeInTheDocument();
    expect(await screen.findByText('Assistant B')).toBeInTheDocument();
    expect(screen.getByText('User A')).toBeInTheDocument();
    expect(screen.getByText('Assistant A')).toBeInTheDocument();

    const transcript = screen.getByTestId('chat-transcript');
    const text = transcript.textContent ?? '';
    expect(text.indexOf('Assistant B')).toBeLessThan(text.indexOf('User B'));
  });

  it('dedupes ws user_turn against the sender tab optimistic bubble', async () => {
    const userText = 'Hello from sender';
    const harness = setupChatWsHarness({ mockFetch });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: userText } });
    const sendButton = await screen.findByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';

    harness.emitUserTurn({
      conversationId: conversationId!,
      inflightId,
      content: userText,
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    await waitFor(() => {
      const matches = screen
        .getAllByTestId('chat-bubble')
        .filter((el) => el.getAttribute('data-role') === 'user')
        .filter((el) => (el.textContent ?? '').includes(userText));
      expect(matches).toHaveLength(1);
    });
  });

  it('renders ws user_turn bubbles in a tab that did not send the prompt', async () => {
    const conversationId = 'c-user-turn-2';
    const userText = 'Hello from other tab';
    const harness = setupChatWsHarness({
      mockFetch,
      conversations: {
        items: [
          {
            conversationId,
            title: 'Other tab conversation',
            provider: 'lmstudio',
            model: 'm1',
            source: 'REST',
            lastMessageAt: '2025-01-01T00:00:00.000Z',
            archived: false,
          },
        ],
        nextCursor: null,
      },
      turns: { items: [], nextCursor: null },
    });

    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const row = await screen.findByTestId('conversation-row');
    await act(async () => {
      await user.click(row);
    });

    harness.emitUserTurn({
      conversationId,
      inflightId: 'i1',
      content: userText,
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    await waitFor(() => {
      const matches = screen
        .getAllByTestId('chat-bubble')
        .filter((el) => el.getAttribute('data-role') === 'user')
        .filter((el) => (el.textContent ?? '').includes(userText));
      expect(matches).toHaveLength(1);
    });
  });
});
