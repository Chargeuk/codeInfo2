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

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

describe('Chat snapshot refresh on focus/visibility + reconnect', () => {
  it('refreshes turns + conversations when the tab becomes visible again', async () => {
    const turnsPayload = { items: [], nextCursor: null } as {
      items: Array<{
        conversationId: string;
        role: 'user' | 'assistant';
        content: string;
        model: string;
        provider: string;
        status: 'ok' | 'stopped' | 'failed';
        createdAt: string;
      }>;
      nextCursor: string | null;
    };

    const conversationsPayload = { items: [], nextCursor: null };

    const harness = setupChatWsHarness({
      mockFetch,
      conversations: conversationsPayload,
      turns: turnsPayload,
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
    expect(conversationId).toBeTruthy();

    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });
    harness.emitAssistantDelta({
      conversationId: conversationId!,
      inflightId,
      delta: 'Partial response',
    });

    expect(await screen.findByText('Partial response')).toBeInTheDocument();

    // Simulate the tab being backgrounded while another tab finishes the run.
    await act(async () => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const now = Date.now();
    const storedUserAt = new Date(now).toISOString();
    const storedAssistantAt = new Date(now + 1_000).toISOString();
    turnsPayload.items = [
      {
        conversationId: conversationId!,
        role: 'assistant',
        content: 'Final response',
        model: 'm1',
        provider: 'lmstudio',
        status: 'ok',
        createdAt: storedAssistantAt,
      },
      {
        conversationId: conversationId!,
        role: 'user',
        content: 'Hello',
        model: 'm1',
        provider: 'lmstudio',
        status: 'ok',
        createdAt: storedUserAt,
      },
    ];

    conversationsPayload.items = [
      {
        conversationId: conversationId!,
        title: 'Hello',
        provider: 'lmstudio',
        model: 'm1',
        source: 'REST',
        lastMessageAt: storedAssistantAt,
        archived: false,
      },
    ];

    const turnsFetchCountBefore = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes('/turns'),
    ).length;
    const conversationsFetchCountBefore = mockFetch.mock.calls.filter(
      (call) =>
        String(call[0]).includes('/conversations') &&
        !String(call[0]).includes('/turns'),
    ).length;

    await act(async () => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      const turnsFetchCountAfter = mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/turns'),
      ).length;
      const conversationsFetchCountAfter = mockFetch.mock.calls.filter(
        (call) =>
          String(call[0]).includes('/conversations') &&
          !String(call[0]).includes('/turns'),
      ).length;

      expect(turnsFetchCountAfter).toBeGreaterThan(turnsFetchCountBefore);
      expect(conversationsFetchCountAfter).toBeGreaterThan(
        conversationsFetchCountBefore,
      );
    });

    expect(await screen.findByText('Final response')).toBeInTheDocument();
  });

  it('refreshes turns + conversations on websocket reconnect before resubscribe', async () => {
    jest.useFakeTimers();

    const turnsPayload = { items: [], nextCursor: null };
    const conversationsPayload = { items: [], nextCursor: null };

    const harness = setupChatWsHarness({
      mockFetch,
      conversations: conversationsPayload,
      turns: turnsPayload,
    });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    const sendButton = await screen.findByTestId('chat-send');

    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await user.click(sendButton);
    });

    await waitFor(() => expect(harness.chatBodies.length).toBe(1));

    const conversationId = harness.getConversationId();
    expect(conversationId).toBeTruthy();

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

    const turnsFetchCountBefore = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes('/turns'),
    ).length;
    const conversationsFetchCountBefore = mockFetch.mock.calls.filter(
      (call) =>
        String(call[0]).includes('/conversations') &&
        !String(call[0]).includes('/turns'),
    ).length;

    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { last: () => { close: () => void } | null };
      }
    ).__wsMock;
    wsRegistry?.last()?.close();

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      const turnsFetchCountAfter = mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/turns'),
      ).length;
      const conversationsFetchCountAfter = mockFetch.mock.calls.filter(
        (call) =>
          String(call[0]).includes('/conversations') &&
          !String(call[0]).includes('/turns'),
      ).length;

      expect(turnsFetchCountAfter).toBeGreaterThan(turnsFetchCountBefore);
      expect(conversationsFetchCountAfter).toBeGreaterThan(
        conversationsFetchCountBefore,
      );
    });
  });
});
