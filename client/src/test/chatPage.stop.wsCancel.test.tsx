import { ReadableStream } from 'node:stream/web';
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

describe('Chat page stop (WS cancel)', () => {
  it('sends cancel_inflight over WS when inflightId is known', async () => {
    const ws = installMockWebSocket();
    try {
      let reads = 0;
      const reader = {
        read: jest.fn<() => Promise<ReadableStreamReadResult<Uint8Array>>>(
          () => {
            reads += 1;
            if (reads === 1) {
              return Promise.resolve({
                value: new TextEncoder().encode(
                  'data: {"type":"token","content":"hi"}\n\n',
                ),
                done: false,
              });
            }
            return new Promise(() => {});
          },
        ),
      };

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
                    id: 'lmstudio',
                    label: 'LM Studio',
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
                provider: 'lmstudio',
                available: true,
                toolsAvailable: true,
                models: [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }],
              }),
            }) as unknown as Response;
          }
          if (href.includes('/conversations')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ items: [], nextCursor: undefined }),
            }) as unknown as Response;
          }
          if (href.includes('/chat/cancel')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({}),
            }) as unknown as Response;
          }
          if (href.endsWith('/chat')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              body: {
                getReader: () => ({
                  read: reader.read,
                }),
              } as unknown as ReadableStream<Uint8Array>,
            }) as unknown as Response;
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              href,
              init,
            }),
          }) as unknown as Response;
        },
      );

      const user = userEvent.setup();
      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(ws.instances.length).toBe(1));
      const socket = ws.instances[0];
      socket.__emitOpen();

      const input = await screen.findByTestId('chat-input');
      fireEvent.change(input, { target: { value: 'Hello' } });
      const sendButton = await screen.findByTestId('chat-send');
      await waitFor(() => expect(sendButton).toBeEnabled());

      await act(async () => {
        await user.click(sendButton);
      });

      const stopButton = await screen.findByTestId('chat-stop');
      expect(stopButton).toBeVisible();

      await act(async () => {
        await user.click(stopButton);
      });

      await waitFor(() => {
        const payloads = socket.send.mock.calls.map(([arg]) => String(arg));
        expect(payloads.join('\n')).toContain('cancel_inflight');
      });

      const cancelCalls = mockFetch.mock.calls.filter(([target]) =>
        target.toString().includes('/chat/cancel'),
      );
      expect(cancelCalls).toHaveLength(0);
    } finally {
      ws.restore();
    }
  });
});
