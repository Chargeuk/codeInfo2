import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { asFetchImplementation, mockJsonResponse } from './support/fetchMock';

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

describe('Chat page resumed execution identity', () => {
  it('pins resumed sends to the stored provider and model instead of the create-mode bootstrap defaults', async () => {
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

        if (href.includes('/chat/providers')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              providers: [
                {
                  id: 'codex',
                  label: 'OpenAI Codex',
                  available: true,
                  toolsAvailable: true,
                },
                {
                  id: 'lmstudio',
                  label: 'LM Studio',
                  available: true,
                  toolsAvailable: true,
                },
              ],
              selectedProvider: 'codex',
              selectedModel: 'gpt-5.1-codex-max',
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
              conversationId: 'c1',
              inflightId: 'i1',
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

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    await user.click(await screen.findByTestId('conversation-row'));

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /LM Studio/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(/LM Model/i),
    );
    expect(screen.getByRole('combobox', { name: /provider/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('combobox', { name: /model/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.type(screen.getByTestId('chat-input'), 'Use stored identity');
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]).toMatchObject({
      provider: 'lmstudio',
      model: 'lm',
      conversationId: 'c1',
    });
    expect(chatBodies[0]).not.toHaveProperty('agentName');
  }, 60000);

  it('restores the endpoint identity when it is present on the saved conversation', async () => {
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
                  title: 'Historic endpoint conversation',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  lastMessageAt: '2025-01-01T00:00:03.000Z',
                  archived: false,
                  flags: { endpointId: 'https://alpha.example/alt/v1' },
                },
              ],
              nextCursor: null,
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
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:00.000Z',
                },
                {
                  conversationId: 'c1',
                  role: 'assistant',
                  content: 'Earlier reply',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:01.000Z',
                },
              ],
            }),
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
                  label: 'OpenAI Codex',
                  available: true,
                  toolsAvailable: true,
                },
                {
                  id: 'lmstudio',
                  label: 'LM Studio',
                  available: true,
                  toolsAvailable: true,
                },
              ],
              selectedProvider: 'codex',
              selectedModel: 'gpt-5.1-codex-max',
              selectedEndpointId: 'https://alpha.example/alt/v1',
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
                  endpointId: 'https://alpha.example/alt/v1',
                },
              ],
            }),
          }) as unknown as Response;
        }

        if (href.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'lmstudio',
            available: true,
            toolsAvailable: true,
            models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
          });
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
              conversationId: 'c1',
              inflightId: 'i1',
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

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    await user.click(await screen.findByTestId('conversation-row'));

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.1-codex-max/i,
      ),
    );
    expect(screen.getByTestId('model-select')).not.toHaveTextContent(
      /alpha\.example/i,
    );

    await user.type(
      screen.getByTestId('chat-input'),
      'Use restored endpoint identity',
    );
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      endpointId: 'https://alpha.example/alt/v1',
    });
  }, 60000);

  it('keeps the persisted endpoint identity when bootstrap selectedEndpointId points at a different endpoint', async () => {
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
                  title: 'Historic endpoint conversation',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  lastMessageAt: '2025-01-01T00:00:03.000Z',
                  archived: false,
                  flags: { endpointId: 'https://alpha.example/base/v1' },
                },
              ],
              nextCursor: null,
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
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:00.000Z',
                },
                {
                  conversationId: 'c1',
                  role: 'assistant',
                  content: 'Earlier reply',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:01.000Z',
                },
              ],
            }),
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
                  label: 'OpenAI Codex',
                  available: true,
                  toolsAvailable: true,
                },
                {
                  id: 'lmstudio',
                  label: 'LM Studio',
                  available: true,
                  toolsAvailable: true,
                },
              ],
              selectedProvider: 'codex',
              selectedModel: 'gpt-5.2',
              selectedEndpointId: 'https://alpha.example/alt/v1',
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
                  endpointId: 'https://alpha.example/base/v1',
                },
                {
                  key: 'gpt-5.1-codex-max',
                  displayName: 'gpt-5.1-codex-max',
                  type: 'codex',
                  endpointId: 'https://alpha.example/alt/v1',
                },
                {
                  key: 'gpt-5.2',
                  displayName: 'gpt-5.2',
                  type: 'codex',
                  endpointId: 'https://alpha.example/alt/v1',
                },
              ],
            }),
          }) as unknown as Response;
        }

        if (href.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'lmstudio',
            available: true,
            toolsAvailable: true,
            models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
          });
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
              conversationId: 'c1',
              inflightId: 'i1',
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

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    await user.click(await screen.findByTestId('conversation-row'));

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.1-codex-max \(alpha\.example \/ base\)/i,
      ),
    );

    await user.type(
      screen.getByTestId('chat-input'),
      'Use persisted endpoint identity',
    );
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      endpointId: 'https://alpha.example/base/v1',
    });
  }, 60000);

  it('keeps the saved endpoint identity when the saved endpoint disappears but another endpoint still exposes the same raw model id', async () => {
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
                  title: 'Historic endpoint conversation',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  lastMessageAt: '2025-01-01T00:00:03.000Z',
                  archived: false,
                  flags: { endpointId: 'https://saved.example/v1' },
                },
              ],
              nextCursor: null,
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
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:00.000Z',
                },
                {
                  conversationId: 'c1',
                  role: 'assistant',
                  content: 'Earlier reply',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:01.000Z',
                },
              ],
            }),
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
                  label: 'OpenAI Codex',
                  available: true,
                  toolsAvailable: true,
                },
                {
                  id: 'lmstudio',
                  label: 'LM Studio',
                  available: true,
                  toolsAvailable: true,
                },
              ],
              selectedProvider: 'codex',
              selectedModel: 'gpt-5.2',
              selectedEndpointId: 'https://alpha.example/alt/v1',
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
                  endpointId: 'https://alpha.example/alt/v1',
                },
                {
                  key: 'gpt-5.2',
                  displayName: 'gpt-5.2',
                  type: 'codex',
                  endpointId: 'https://alpha.example/alt/v1',
                },
              ],
            }),
          }) as unknown as Response;
        }

        if (href.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'lmstudio',
            available: true,
            toolsAvailable: true,
            models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
          });
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
              conversationId: 'c1',
              inflightId: 'i1',
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

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    await user.click(await screen.findByTestId('conversation-row'));

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.1-codex-max/i,
      ),
    );
    expect(screen.getByTestId('model-select')).not.toHaveTextContent(
      /saved\.example/i,
    );

    await user.type(
      screen.getByTestId('chat-input'),
      'Keep the saved endpoint identity',
    );
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      endpointId: 'https://saved.example/v1',
    });
  }, 60000);

  it('restores the create-mode endpoint pair when returning from a resumed conversation to a fresh draft', async () => {
    const user = userEvent.setup();
    const chatBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      asFetchImplementation(
        async (url: RequestInfo | URL, opts?: RequestInit) => {
          const href = typeof url === 'string' ? url : url.toString();

          if (href.includes('/health')) {
            return mockJsonResponse({ mongoConnected: true });
          }

          if (
            href.includes('/conversations') &&
            !href.includes('/turns') &&
            opts?.method !== 'POST'
          ) {
            return mockJsonResponse({
              items: [
                {
                  conversationId: 'c1',
                  title: 'Historic Codex conversation',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  lastMessageAt: '2025-01-01T00:00:03.000Z',
                  archived: false,
                },
              ],
              nextCursor: null,
            });
          }

          if (href.includes('/conversations/c1/turns')) {
            return mockJsonResponse({
              items: [
                {
                  conversationId: 'c1',
                  role: 'user',
                  content: 'Earlier prompt',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:00.000Z',
                },
                {
                  conversationId: 'c1',
                  role: 'assistant',
                  content: 'Earlier reply',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:01.000Z',
                },
              ],
            });
          }

          if (href.includes('/chat/providers')) {
            return mockJsonResponse({
              providers: [
                {
                  id: 'codex',
                  label: 'OpenAI Codex',
                  available: true,
                  toolsAvailable: true,
                },
                {
                  id: 'lmstudio',
                  label: 'LM Studio',
                  available: true,
                  toolsAvailable: true,
                },
              ],
              selectedProvider: 'codex',
              selectedModel: 'gpt-5.2',
              selectedEndpointId: 'https://alpha.example/alt/v1',
            });
          }

          if (
            href.includes('/chat/models') &&
            href.includes('provider=codex')
          ) {
            return mockJsonResponse({
              provider: 'codex',
              available: true,
              toolsAvailable: true,
              providerInfo: {
                id: 'codex',
                label: 'OpenAI Codex',
                available: true,
                toolsAvailable: true,
                defaultModel: 'gpt-5.2',
              },
              models: [
                {
                  key: 'gpt-5.1-codex-max',
                  displayName: 'gpt-5.1-codex-max',
                  type: 'codex',
                  endpointId: 'https://alpha.example/base/v1',
                },
                {
                  key: 'gpt-5.1-codex-max',
                  displayName: 'gpt-5.1-codex-max',
                  type: 'codex',
                  endpointId: 'https://alpha.example/alt/v1',
                },
                {
                  key: 'gpt-5.2',
                  displayName: 'gpt-5.2',
                  type: 'codex',
                  endpointId: 'https://alpha.example/base/v1',
                },
                {
                  key: 'gpt-5.2',
                  displayName: 'gpt-5.2',
                  type: 'codex',
                  endpointId: 'https://alpha.example/alt/v1',
                },
              ],
            });
          }

          if (href.includes('/chat/models')) {
            return mockJsonResponse({
              provider: 'lmstudio',
              available: true,
              toolsAvailable: true,
              models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
            });
          }

          if (href.includes('/chat') && opts?.method === 'POST') {
            const body =
              typeof opts.body === 'string'
                ? (JSON.parse(opts.body) as Record<string, unknown>)
                : {};
            chatBodies.push(body);
            return mockJsonResponse({
              status: 'started',
              conversationId: 'c1',
              inflightId: 'i1',
            });
          }

          return mockJsonResponse({});
        },
      ),
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          /Transcript will appear here once you send a message/i,
        ),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.2 \(alpha\.example \/ alt\)/i,
      ),
    );

    await user.click(await screen.findByTestId('conversation-row'));

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.1-codex-max \(alpha\.example \/ alt\)/i,
      ),
    );
    expect(screen.getByRole('combobox', { name: /provider/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('combobox', { name: /model/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          /Transcript will appear here once you send a message/i,
        ),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.2 \(alpha\.example \/ alt\)/i,
      ),
    );
    expect(
      screen.getByRole('combobox', { name: /provider/i }),
    ).not.toHaveAttribute('aria-disabled');
    expect(
      screen.getByRole('combobox', { name: /model/i }),
    ).not.toHaveAttribute('aria-disabled');

    await user.type(screen.getByTestId('chat-input'), 'Use restored draft');
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.2',
    });
    expect(chatBodies[0]).not.toMatchObject({
      conversationId: 'c1',
    });
  }, 60000);
});
