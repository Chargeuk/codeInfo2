import { ReadableStream } from 'node:stream/web';
import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { installMockWebSocket } from './utils/mockWebSocket';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
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

function streamFromFrames(frames: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
      controller.close();
    },
  });
}

describe('Chat page codex threadId restore', () => {
  it('restores threadId from conversation flags and includes it on the next send', async () => {
    const ws = installMockWebSocket();
    try {
      let chatBody: Record<string, unknown> | null = null;
      mockFetch.mockImplementation(
        (url: RequestInfo | URL, init?: RequestInit) => {
          const href = typeof url === 'string' ? url : url.toString();
          if (href.includes('/health')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ mongoConnected: true }),
            }) as unknown as Response;
          }
          if (href.includes('/chat/providers')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                providers: [
                  {
                    id: 'codex',
                    label: 'Codex',
                    available: true,
                    toolsAvailable: true,
                  },
                ],
              }),
            }) as unknown as Response;
          }
          if (href.includes('/chat/models')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                provider: 'codex',
                available: true,
                toolsAvailable: true,
                models: [{ key: 'gpt-5', displayName: 'GPT 5', type: 'chat' }],
              }),
            }) as unknown as Response;
          }
          if (href.includes('/conversations/') && href.includes('/turns')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ items: [], hasMore: false }),
            }) as unknown as Response;
          }
          if (href.includes('/conversations')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                items: [
                  {
                    conversationId: 'c-codex',
                    title: 'Codex conversation',
                    provider: 'codex',
                    model: 'gpt-5',
                    source: 'REST',
                    lastMessageAt: '2025-01-01T00:00:00Z',
                    archived: false,
                    flags: { threadId: 'thread-abc' },
                  },
                ],
                nextCursor: undefined,
              }),
            }) as unknown as Response;
          }
          if (href.endsWith('/chat')) {
            chatBody = init?.body ? JSON.parse(String(init.body)) : null;
            return Promise.resolve({
              ok: true,
              status: 200,
              body: streamFromFrames([
                'data: {"type":"final","message":{"role":"assistant","content":"hi"}}\n\n',
                'data: {"type":"complete"}\n\n',
              ]),
            }) as unknown as Response;
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({}),
          }) as unknown as Response;
        },
      );

      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(ws.instances.length).toBe(1));
      ws.instances[0].__emitOpen();

      fireEvent.click(await screen.findByText('Codex conversation'));

      const input = await screen.findByTestId('chat-input');
      fireEvent.change(input, { target: { value: 'Hello' } });
      const sendButton = await screen.findByTestId('chat-send');
      fireEvent.click(sendButton);

      await waitFor(() => expect(chatBody).not.toBeNull());
      expect(chatBody?.threadId).toBe('thread-abc');
    } finally {
      ws.restore();
    }
  });
});
