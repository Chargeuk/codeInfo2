import { jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { setupChatWsHarness } from './support/mockChatWs';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as unknown as { __wsMock?: { reset: () => void } }).__wsMock?.reset();
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

describe('Chat reasoning rendering (analysis_delta)', () => {
  it('keeps reasoning collapsed by default and toggles open', async () => {
    const harness = setupChatWsHarness({ mockFetch });

    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Show reasoning' } });
    const sendButton = screen.getByTestId('chat-send');

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
      assistantText: 'Answer',
      assistantThink: 'Thinking...\nSecond line',
    });
    harness.emitFinal({ conversationId: conversationId!, inflightId, status: 'ok' });

    const toggle = await screen.findByTestId('think-toggle');
    expect(screen.queryByTestId('think-content')).toBeNull();

    await user.click(toggle);
    const thinkContent = await screen.findByTestId('think-content');
    await waitFor(() => expect(thinkContent).toBeVisible());
    expect(thinkContent.textContent ?? '').toContain('Thinking');
  });
});
