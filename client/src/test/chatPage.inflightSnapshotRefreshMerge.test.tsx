import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
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

const { default: App } = await import('../App');
const { default: ChatPage } = await import('../pages/ChatPage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [{ path: 'chat', element: <ChatPage /> }],
  },
];

test('hydrates inflight snapshot from turns refresh and continues streaming', async () => {
  const turnsPayload = {
    items: [
      {
        conversationId: 'c1',
        role: 'user',
        content: 'hello',
        model: 'm1',
        provider: 'lmstudio',
        toolCalls: null,
        status: 'ok',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    inflight: {
      inflightId: 'i1',
      assistantText: 'Snapshot partial',
      assistantThink: '',
      toolEvents: [],
      startedAt: '2025-01-01T00:00:00.000Z',
      seq: 3,
    },
  };
  const conversationsPayload = {
    items: [
      {
        conversationId: 'c1',
        title: 'Conversation 1',
        provider: 'lmstudio',
        model: 'm1',
        source: 'REST',
        lastMessageAt: '2025-01-01T00:00:00.000Z',
        archived: false,
      },
    ],
    nextCursor: null,
  };

  const harness = setupChatWsHarness({
    mockFetch,
    conversations: conversationsPayload,
    turns: turnsPayload,
  });
  const user = userEvent.setup();

  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);

  const row = await screen.findByTestId('conversation-row');
  await waitFor(() => expect(row).toBeEnabled());
  await user.click(row);

  await waitFor(() => {
    const debug = (
      window as unknown as { __chatDebug?: { activeConversationId?: string } }
    ).__chatDebug;
    expect(debug?.activeConversationId).toBe('c1');
  });

  await waitFor(() => {
    const debug = (
      window as unknown as { __chatDebug?: { turnsCount?: number } }
    ).__chatDebug;
    expect(debug?.turnsCount).toBeGreaterThan(0);
  });

  const assistantTexts = screen
    .getAllByTestId('assistant-markdown')
    .map((node) => node.textContent ?? '');
  expect(assistantTexts.join('\n')).toContain('Snapshot partial');

  await act(async () => {
    harness.emitAssistantDelta({
      conversationId: 'c1',
      inflightId: 'i1',
      delta: ' + delta',
    });
  });

  await waitFor(() => {
    expect(screen.getByText('Snapshot partial + delta')).toBeInTheDocument();
  });
});

test('hydration keeps assistant history when inflight bubble is empty', async () => {
  const turnsPayload = {
    items: [
      {
        conversationId: 'c1',
        role: 'assistant',
        content: 'Persisted A',
        model: 'm1',
        provider: 'lmstudio',
        toolCalls: null,
        status: 'ok',
        createdAt: '2025-01-01T00:00:00.001Z',
      },
      {
        conversationId: 'c1',
        role: 'assistant',
        content: 'Persisted B',
        model: 'm1',
        provider: 'lmstudio',
        toolCalls: null,
        status: 'ok',
        createdAt: '2025-01-01T00:00:00.002Z',
      },
      {
        conversationId: 'c1',
        role: 'user',
        content: 'hello',
        model: 'm1',
        provider: 'lmstudio',
        toolCalls: null,
        status: 'ok',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    inflight: {
      inflightId: 'i1',
      assistantText: '',
      assistantThink: '',
      toolEvents: [],
      startedAt: '2025-01-02T00:00:00.000Z',
      seq: 3,
    },
  };
  const conversationsPayload = {
    items: [
      {
        conversationId: 'c1',
        title: 'Conversation 1',
        provider: 'lmstudio',
        model: 'm1',
        source: 'REST',
        lastMessageAt: '2025-01-01T00:00:00.000Z',
        archived: false,
      },
    ],
    nextCursor: null,
  };

  setupChatWsHarness({
    mockFetch,
    conversations: conversationsPayload,
    turns: turnsPayload,
  });
  const user = userEvent.setup();

  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);

  const row = await screen.findByTestId('conversation-row');
  await waitFor(() => expect(row).toBeEnabled());
  await user.click(row);

  await waitFor(() => {
    const debug = (
      window as unknown as { __chatDebug?: { activeConversationId?: string } }
    ).__chatDebug;
    expect(debug?.activeConversationId).toBe('c1');
  });

  await waitFor(() => {
    const debug = (
      window as unknown as { __chatDebug?: { turnsCount?: number } }
    ).__chatDebug;
    expect(debug?.turnsCount).toBeGreaterThan(0);
  });

  const assistantTexts = screen
    .getAllByTestId('assistant-markdown')
    .map((node) => node.textContent ?? '');
  const nonEmptyAssistantTexts = assistantTexts
    .filter((text) => text.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));

  expect(nonEmptyAssistantTexts).toEqual(['Persisted A', 'Persisted B']);
  expect(nonEmptyAssistantTexts).toHaveLength(2);
});
