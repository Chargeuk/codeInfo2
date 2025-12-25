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

describe('Chat WS analysis delta handling', () => {
  it('appends analysis_delta into the existing thought-process panel in-place', async () => {
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
            json: async () => ({
              items: [
                {
                  conversationId: 'c1',
                  title: 'Conversation A',
                  provider: 'lmstudio',
                  model: 'm1',
                  source: 'REST',
                  lastMessageAt: '2025-01-01T00:00:00Z',
                  archived: false,
                },
              ],
              nextCursor: undefined,
            }),
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
      socket.__emitOpen();

      fireEvent.click(await screen.findByText('Conversation A'));

      act(() => {
        socket.__emitMessage(
          JSON.stringify({
            type: 'inflight_snapshot',
            conversationId: 'c1',
            seq: 1,
            inflight: {
              inflightId: 'inflight-1',
              assistantText: 'Answer',
              analysisText: 'Reasoning',
              tools: [],
              startedAt: '2025-01-01T00:00:00Z',
            },
          }),
        );
        socket.__emitMessage(
          JSON.stringify({
            type: 'analysis_delta',
            conversationId: 'c1',
            seq: 2,
            inflightId: 'inflight-1',
            delta: ' continues',
          }),
        );
      });

      const thinkToggle = await screen.findByTestId('think-toggle');
      fireEvent.click(thinkToggle);

      expect(
        await screen.findByText('Reasoning continues'),
      ).toBeInTheDocument();
    } finally {
      ws.restore();
    }
  });
});
