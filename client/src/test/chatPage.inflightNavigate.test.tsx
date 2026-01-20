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

test('navigating away/back during inflight keeps persisted history + inflight', async () => {
  const turnsPayload = {
    items: [
      {
        conversationId: 'c1',
        role: 'user',
        content: 'In-flight user',
        model: 'm1',
        provider: 'lmstudio',
        toolCalls: null,
        status: 'ok',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        conversationId: 'c1',
        role: 'assistant',
        content: 'Past reply',
        model: 'm1',
        provider: 'lmstudio',
        toolCalls: null,
        status: 'ok',
        createdAt: '2024-12-31T00:00:00.000Z',
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

  expect(await screen.findByText('Past reply')).toBeInTheDocument();
  const assistantTexts = screen
    .getAllByTestId('assistant-markdown')
    .map((node) => node.textContent ?? '');
  expect(assistantTexts.join('\n')).toContain('Snapshot partial');

  await act(async () => {
    await router.navigate('/');
    await router.navigate('/chat');
  });

  const rowAfter = await screen.findByTestId('conversation-row');
  await waitFor(() => expect(rowAfter).toBeEnabled());
  await user.click(rowAfter);

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

  expect(await screen.findByText('Past reply')).toBeInTheDocument();
  const assistantTextsAfter = screen
    .getAllByTestId('assistant-markdown')
    .map((node) => node.textContent ?? '');
  expect(assistantTextsAfter.join('\n')).toContain('Snapshot partial');

  await act(async () => {
    harness.emitAssistantDelta({
      conversationId: 'c1',
      inflightId: 'i1',
      delta: ' + delta',
    });
  });

  expect(
    await screen.findByText('Snapshot partial + delta'),
  ).toBeInTheDocument();
});
