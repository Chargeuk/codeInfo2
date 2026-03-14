import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

const renderChatPage = () => {
  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);
};

const startInflightConversation = async (
  user: ReturnType<typeof userEvent.setup>,
) => {
  const harness = setupChatWsHarness({ mockFetch });

  renderChatPage();

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
  if (!conversationId) {
    throw new Error('Expected a conversation id after starting a run');
  }

  harness.emitInflightSnapshot({
    conversationId,
    inflightId,
    assistantText: 'Draft partial reply',
  });

  await screen.findByText('Draft partial reply');

  return { harness, input, sendButton, conversationId, inflightId };
};

describe('Chat page new conversation control', () => {
  it('does not send cancel_inflight when opening a new conversation during an active run', async () => {
    const user = userEvent.setup();
    const { conversationId } = await startInflightConversation(user);

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
    });

    expect(
      screen.getByText(/Transcript will appear here once you send a message/i),
    ).toBeInTheDocument();

    const cancelMessages = parseSocketMessages().filter(
      (message) =>
        message.type === 'cancel_inflight' &&
        message.conversationId === conversationId,
    );

    expect(cancelMessages).toHaveLength(0);
  });

  it('lets the previous conversation keep running server-side after opening a new conversation', async () => {
    const user = userEvent.setup();
    const { harness, conversationId, inflightId } =
      await startInflightConversation(user);

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
    });

    await act(async () => {
      harness.emitAssistantDelta({
        conversationId,
        inflightId,
        delta: ' + more work',
      });
      harness.emitFinal({
        conversationId,
        inflightId,
        status: 'ok',
      });
    });

    await waitFor(() =>
      expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Transcript will appear here once you send a message/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Draft partial reply + more work'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeEnabled();

    const cancelMessages = parseSocketMessages().filter(
      (message) =>
        message.type === 'cancel_inflight' &&
        message.conversationId === conversationId,
    );
    expect(cancelMessages).toHaveLength(0);
  });

  it('opens a clean draft with an interactive composer and cleared local state', async () => {
    const user = userEvent.setup();
    const { input } = await startInflightConversation(user);

    expect(screen.getByText(/Draft partial reply/i)).toBeInTheDocument();
    expect(screen.getByTestId('chat-stop')).toBeInTheDocument();

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
    });

    const transcript = screen.getByTestId('chat-transcript');
    expect(
      within(transcript).getByText(
        /Transcript will appear here once you send a message/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(transcript).queryByText(/Draft partial reply/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toBeEnabled();
    expect(screen.getByTestId('chat-send')).toBeEnabled();

    await user.type(input, 'Fresh draft');
    expect(input).toHaveValue('Fresh draft');
  });
});
