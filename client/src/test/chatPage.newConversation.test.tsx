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

describe('Chat page new conversation control', () => {
  it('clears transcript and refocuses input without cancelling the run', async () => {
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

    const newConversationButton = screen.getByRole('button', {
      name: /new conversation/i,
    });

    await act(async () => {
      await user.click(newConversationButton);
    });

    expect(
      screen.getByText(/Transcript will appear here/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(input).toHaveFocus());

    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { last: () => { sent: string[] } | null };
      }
    ).__wsMock;
    const ws = wsRegistry?.last();
    const cancel = (ws?.sent ?? []).some((entry) => {
      try {
        return (
          (JSON.parse(entry) as Record<string, unknown>).type ===
          'cancel_inflight'
        );
      } catch {
        return false;
      }
    });

    expect(cancel).toBe(false);
  });
});
