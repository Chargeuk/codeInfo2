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

describe('Chat page stop control', () => {
  it('sends cancel_inflight over WS and shows a stopped status bubble', async () => {
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

    const stopButton = await screen.findByTestId('chat-stop');
    expect(stopButton).toBeVisible();

    await act(async () => {
      await user.click(stopButton);
    });

    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { instances?: Array<{ sent: string[] }> };
      }
    ).__wsMock;

    await waitFor(() => {
      const sockets = wsRegistry?.instances ?? [];
      expect(sockets.length).toBeGreaterThan(0);

      const cancelMessages = sockets
        .flatMap((socket) => socket.sent)
        .map((entry) => {
          try {
            return JSON.parse(entry) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .filter((msg) => msg?.type === 'cancel_inflight');

      expect(cancelMessages.length).toBeGreaterThan(0);
      expect(cancelMessages.at(-1)?.conversationId).toBe(conversationId);
      expect(cancelMessages.at(-1)?.inflightId).toBe(inflightId);
    });

    await waitFor(() => expect(sendButton).toBeEnabled());
    expect(await screen.findByText(/generation stopped/i)).toBeInTheDocument();
  });
});
