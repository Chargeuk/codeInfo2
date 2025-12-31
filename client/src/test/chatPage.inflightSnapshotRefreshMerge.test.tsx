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
    items: [],
    nextCursor: null,
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
  await act(async () => {
    await user.click(row);
  });

  expect(await screen.findByText('Snapshot partial')).toBeInTheDocument();

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
