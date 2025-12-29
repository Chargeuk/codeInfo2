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
});
