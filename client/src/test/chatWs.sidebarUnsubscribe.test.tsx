import { jest } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react';
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

describe('Chat WS sidebar unsubscribe lifecycle', () => {
  it('unsubscribes from sidebar on unmount without sending cancel_inflight', async () => {
    const ws = installMockWebSocket();
    try {
      mockFetch.mockImplementation((url: RequestInfo | URL) => {
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
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        }) as unknown as Response;
      });

      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(ws.instances.length).toBe(1));
      const socket = ws.instances[0];
      act(() => socket.__emitOpen());

      await waitFor(() => {
        const payloads = socket.send.mock.calls.map(([arg]) => String(arg));
        expect(payloads.join('\n')).toContain('subscribe_sidebar');
      });

      await act(async () => {
        await router.navigate('/');
      });

      await waitFor(() => {
        const payloads = socket.send.mock.calls.map(([arg]) => String(arg));
        const joined = payloads.join('\n');
        expect(joined).toContain('unsubscribe_sidebar');
        expect(joined).not.toContain('cancel_inflight');
      });
    } finally {
      ws.restore();
    }
  });
});
