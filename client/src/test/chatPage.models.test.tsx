import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ensureCodexFlagsPanelExpanded } from './support/ensureCodexFlagsPanelExpanded';
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

function getWsMessages() {
  const wsRegistry = (
    globalThis as unknown as {
      __wsMock?: { instances?: Array<{ sent: string[] }> };
    }
  ).__wsMock;

  return (wsRegistry?.instances ?? [])
    .flatMap((socket) => socket.sent)
    .map((entry) => {
      try {
        return JSON.parse(entry) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function mockCodexModelNextSendApi() {
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
                id: 'codex',
                label: 'OpenAI Codex',
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
            codexDefaults: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'on-failure',
              modelReasoningEffort: 'high',
              networkAccessEnabled: true,
              webSearchEnabled: true,
            },
            codexWarnings: [],
            models: [
              {
                key: 'gpt-5.1-codex-max',
                displayName: 'gpt-5.1-codex-max',
                type: 'codex',
                supportedReasoningEfforts: ['high', 'xhigh'],
                defaultReasoningEffort: 'high',
              },
              {
                key: 'gpt-5.2',
                displayName: 'gpt-5.2',
                type: 'codex',
                supportedReasoningEfforts: ['minimal'],
                defaultReasoningEffort: 'minimal',
              },
            ],
          }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations/draft-conversation/turns')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                conversationId: 'draft-conversation',
                role: 'user',
                content: 'Earlier prompt',
                model: 'gpt-5.1-codex-max',
                provider: 'codex',
                toolCalls: null,
                status: 'ok',
                createdAt: '2025-01-01T00:00:00.000Z',
              },
              {
                conversationId: 'draft-conversation',
                role: 'assistant',
                content: 'Earlier reply',
                model: 'gpt-5.1-codex-max',
                provider: 'codex',
                toolCalls: null,
                status: 'ok',
                createdAt: '2025-01-01T00:00:01.000Z',
              },
            ],
            inflight: {
              inflightId: 'draft-inflight',
              assistantText: 'Partial reply',
              assistantThink: '',
              toolEvents: [],
              startedAt: '2025-01-01T00:00:02.000Z',
              seq: 3,
            },
          }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations/') && href.includes('/turns')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations') && opts?.method !== 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                conversationId: 'draft-conversation',
                title: 'Draft conversation',
                provider: 'codex',
                model: 'gpt-5.1-codex-max',
                source: 'REST',
                lastMessageAt: '2025-01-01T00:00:03.000Z',
                archived: false,
              },
            ],
            nextCursor: null,
          }),
        }) as unknown as Response;
      }
      if (href.includes('/chat') && opts?.method === 'POST') {
        const body =
          typeof opts.body === 'string'
            ? (JSON.parse(opts.body) as Record<string, unknown>)
            : {};
        chatBodies.push(body);
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            status: 'started',
            conversationId: body.conversationId,
            inflightId:
              chatBodies.length === 1 ? 'draft-inflight' : 'next-inflight',
            provider: body.provider,
            model: body.model,
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

  return { chatBodies };
}

describe('Chat page models list', () => {
  it('shows loading then selects the first model', async () => {
    mockFetch.mockImplementation(
      asFetchImplementation(async (url: RequestInfo | URL) => {
        const target = typeof url === 'string' ? url : url.toString();
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        if (target.includes('/conversations')) {
          return mockJsonResponse({ items: [], nextCursor: null });
        }
        if (target.includes('/chat/providers')) {
          return mockJsonResponse({
            providers: [
              {
                id: 'lmstudio',
                label: 'LM Studio',
                available: true,
                toolsAvailable: true,
              },
            ],
          });
        }
        if (target.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'lmstudio',
            available: true,
            toolsAvailable: true,
            models: [
              { key: 'm1', displayName: 'Model 1', type: 'gguf' },
              {
                key: 'embed',
                displayName: 'Embedding Model',
                type: 'embedding',
              },
            ],
          });
        }
        return mockJsonResponse({});
      }),
    );

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    expect(
      screen.getAllByText(/loading chat providers and models/i).length,
    ).toBeGreaterThan(0);

    const select = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => expect(select).toHaveTextContent('Model 1'));
    expect(screen.queryByText(/Embedding Model/i)).toBeNull();
  });

  it('surfaces an error alert when fetch fails', async () => {
    mockFetch.mockImplementation(() => {
      throw new Error('network down');
    });

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const select = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => expect(select).toHaveTextContent('Mock Chat Model'));
  });

  it('renders capability-driven reasoning options for Codex defaults', async () => {
    mockFetch.mockImplementation(
      asFetchImplementation(async (url: RequestInfo | URL) => {
        const target = typeof url === 'string' ? url : url.toString();
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        if (target.includes('/conversations')) {
          return mockJsonResponse({ items: [], nextCursor: null });
        }
        if (target.includes('/chat/providers')) {
          return mockJsonResponse({
            providers: [
              {
                id: 'codex',
                label: 'OpenAI Codex',
                available: true,
                toolsAvailable: true,
              },
            ],
          });
        }
        if (target.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'codex',
            available: true,
            toolsAvailable: true,
            codexDefaults: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'on-failure',
              modelReasoningEffort: 'minimal',
              networkAccessEnabled: true,
              webSearchEnabled: true,
            },
            codexWarnings: [],
            models: [
              {
                key: 'gpt-5.2-codex',
                displayName: 'gpt-5.2-codex',
                type: 'codex',
              },
            ],
          });
        }
        return mockJsonResponse({});
      }),
    );

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    await ensureCodexFlagsPanelExpanded();
    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/minimal/i));
    await act(async () => {
      await userEvent.click(reasoningSelect);
    });
    expect(
      await screen.findByRole('option', { name: /minimal/i }),
    ).toBeVisible();
    expect(screen.queryByRole('option', { name: /xhigh/i })).toBeNull();
  });

  it('renders non-standard runtime reasoning values from model capabilities', async () => {
    mockFetch.mockImplementation(
      asFetchImplementation(async (url: RequestInfo | URL) => {
        const target = typeof url === 'string' ? url : url.toString();
        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        if (target.includes('/conversations')) {
          return mockJsonResponse({ items: [], nextCursor: null });
        }
        if (target.includes('/chat/providers')) {
          return mockJsonResponse({
            providers: [
              {
                id: 'codex',
                label: 'OpenAI Codex',
                available: true,
                toolsAvailable: true,
              },
            ],
          });
        }
        if (target.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'codex',
            available: true,
            toolsAvailable: true,
            codexDefaults: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'on-failure',
              modelReasoningEffort: 'turbo-max',
              networkAccessEnabled: true,
              webSearchEnabled: true,
            },
            codexWarnings: [],
            models: [
              {
                key: 'gpt-5.3-experimental',
                displayName: 'gpt-5.3-experimental',
                type: 'codex',
                supportedReasoningEfforts: ['turbo-max'],
                defaultReasoningEffort: 'turbo-max',
              },
            ],
          });
        }
        return mockJsonResponse({});
      }),
    );

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    await ensureCodexFlagsPanelExpanded();
    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() =>
      expect(reasoningSelect).toHaveTextContent(/turbo-max/i),
    );
    await act(async () => {
      await userEvent.click(reasoningSelect);
    });
    expect(
      await screen.findByRole('option', { name: /turbo-max/i }),
    ).toBeVisible();
  });

  it('does not send cancel_inflight when changing model during an active run', async () => {
    const { chatBodies } = mockCodexModelNextSendApi();
    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const user = userEvent.setup();
    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).toHaveTextContent(/gpt-5.1-codex-max/i),
    );
    const input = await screen.findByTestId('chat-input');
    await user.type(input, 'Keep this run going');
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));

    await user.click(modelSelect);
    await user.click(await screen.findByRole('option', { name: /gpt-5.2/i }));

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(/gpt-5.2/i),
    );

    const cancelMessages = getWsMessages().filter(
      (msg) =>
        msg.type === 'cancel_inflight' &&
        msg.conversationId === String(chatBodies[0]?.conversationId ?? ''),
    );
    expect(cancelMessages).toHaveLength(0);
  });

  it('uses the newly selected model only for the next send while the hidden run keeps its persisted model', async () => {
    const { chatBodies } = mockCodexModelNextSendApi();
    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const user = userEvent.setup();
    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).toHaveTextContent(/gpt-5.1-codex-max/i),
    );
    const input = await screen.findByTestId('chat-input');
    await user.type(input, 'Start with the default model');
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]?.model).toBe('gpt-5.1-codex-max');

    await user.click(modelSelect);
    await user.click(await screen.findByRole('option', { name: /gpt-5.2/i }));

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(/gpt-5.2/i),
    );

    await user.type(screen.getByTestId('chat-input'), 'Use the new model next');
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(2));
    expect(chatBodies[1]?.model).toBe('gpt-5.2');

    await user.click(await screen.findByTestId('conversation-row'));

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5.1-codex-max/i,
      ),
    );
    expect(await screen.findByText('Earlier reply')).toBeInTheDocument();
  });
});
