import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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

describe('Chat WS seq guards', () => {
  it('ignores out-of-order sidebar and transcript events', async () => {
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

      act(() => {
        socket.__emitMessage(
          JSON.stringify({
            type: 'conversation_upsert',
            seq: 2,
            conversation: {
              conversationId: 'c1',
              title: 'New title',
              provider: 'lmstudio',
              model: 'm1',
              source: 'REST',
              lastMessageAt: '2025-01-02T00:00:00Z',
              archived: false,
            },
          }),
        );
        socket.__emitMessage(
          JSON.stringify({
            type: 'conversation_upsert',
            seq: 1,
            conversation: {
              conversationId: 'c1',
              title: 'Old title',
              provider: 'lmstudio',
              model: 'm1',
              source: 'REST',
              lastMessageAt: '2025-01-01T00:00:00Z',
              archived: false,
            },
          }),
        );
      });

      expect(await screen.findByText('New title')).toBeInTheDocument();
      expect(screen.queryByText('Old title')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('New title'));

      await waitFor(() => {
        const payloads = socket.send.mock.calls.map(([arg]) => String(arg));
        const joined = payloads.join('\n');
        expect(joined).toContain('subscribe_conversation');
        expect(joined).toContain('c1');
      });

      act(() => {
        socket.__emitMessage(
          JSON.stringify({
            type: 'inflight_snapshot',
            conversationId: 'c1',
            seq: 2,
            inflight: {
              inflightId: 'inflight-1',
              assistantText: 'Hello',
              analysisText: '',
              tools: [],
              startedAt: '2025-01-01T00:00:00Z',
            },
          }),
        );
        socket.__emitMessage(
          JSON.stringify({
            type: 'assistant_delta',
            conversationId: 'c1',
            seq: 1,
            inflightId: 'inflight-1',
            delta: ' BAD',
          }),
        );
      });

      expect(await screen.findByText('Hello')).toBeInTheDocument();
      expect(screen.queryByText('Hello BAD')).not.toBeInTheDocument();
    } finally {
      ws.restore();
    }
  });
});
