import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

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

describe('Chat page fresh-run context', () => {
  it('uses current create-mode provider and model for a fresh run after revisiting historical state', async () => {
    const user = userEvent.setup();
    const chatBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      async (url: RequestInfo | URL, opts?: RequestInit) => {
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
                {
                  id: 'codex',
                  label: 'OpenAI Codex',
                  available: true,
                  toolsAvailable: true,
                },
              ],
            }),
          }) as unknown as Response;
        }

        if (href.includes('/chat/models') && href.includes('provider=codex')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              provider: 'codex',
              available: true,
              toolsAvailable: true,
              models: [
                {
                  key: 'gpt-5.1-codex-max',
                  displayName: 'gpt-5.1-codex-max',
                  type: 'codex',
                },
                {
                  key: 'gpt-5.2',
                  displayName: 'gpt-5.2',
                  type: 'codex',
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
              models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
            }),
          }) as unknown as Response;
        }

        if (href.includes('/conversations/c1/turns')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  conversationId: 'c1',
                  role: 'user',
                  content: 'Earlier prompt',
                  provider: 'lmstudio',
                  model: 'lm',
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:00.000Z',
                },
                {
                  conversationId: 'c1',
                  role: 'assistant',
                  content: 'Earlier reply',
                  provider: 'lmstudio',
                  model: 'lm',
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:01.000Z',
                },
              ],
            }),
          }) as unknown as Response;
        }

        if (
          href.includes('/conversations') &&
          !href.includes('/turns') &&
          opts?.method !== 'POST'
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  conversationId: 'c1',
                  title: 'Historic LM conversation',
                  provider: 'lmstudio',
                  model: 'lm',
                  lastMessageAt: '2025-01-01T00:00:03.000Z',
                  archived: false,
                },
              ],
              nextCursor: null,
            }),
          }) as unknown as Response;
        }

        if (href.includes('/chat') && opts?.method === 'POST') {
          chatBodies.push(
            typeof opts.body === 'string'
              ? (JSON.parse(opts.body) as Record<string, unknown>)
              : {},
          );
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              conversationId:
                typeof chatBodies.at(-1)?.conversationId === 'string'
                  ? chatBodies.at(-1)?.conversationId
                  : 'new-conversation',
              inflightId: `i${chatBodies.length}`,
            }),
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

    await user.click(await screen.findByTestId('conversation-row'));
    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /LM Studio/i,
      ),
    );

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
    });

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /provider/i })).toBeEnabled(),
    );

    const providerSelect = screen.getByRole('combobox', { name: /provider/i });
    await user.click(providerSelect);
    await user.click(
      await screen.findByRole('option', { name: /openai codex/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    const modelSelect = screen.getByRole('combobox', { name: /model/i });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await user.click(modelSelect);
    await user.click(await screen.findByRole('option', { name: /gpt-5.2/i }));

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(/gpt-5.2/i),
    );

    await user.type(screen.getByTestId('chat-input'), 'Fresh run uses codex');
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.2',
    });
    expect(chatBodies[0]?.conversationId).not.toBe('c1');
  }, 15000);
});
