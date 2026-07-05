import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { setupChatWsHarness } from './support/mockChatWs';

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

const parseSocketMessages = () => {
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
    .filter((entry): entry is Record<string, unknown> => entry !== null);
};

const renderChatPage = () => {
  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);
};

const startInflightConversation = async (
  user: ReturnType<typeof userEvent.setup>,
) => {
  const harness = setupChatWsHarness({ mockFetch });

  renderChatPage();

  const input = await screen.findByTestId('chat-input');
  fireEvent.change(input, { target: { value: 'Hello' } });
  const sendButton = await screen.findByTestId('chat-send');
  await waitFor(() => expect(sendButton).toBeEnabled());

  await act(async () => {
    await user.click(sendButton);
  });

  await waitFor(() => expect(harness.chatBodies.length).toBe(1));

  const conversationId = harness.getConversationId();
  const inflightId = harness.getInflightId() ?? 'i1';
  if (!conversationId) {
    throw new Error('Expected a conversation id after starting a run');
  }

  harness.emitInflightSnapshot({
    conversationId,
    inflightId,
    assistantText: 'Draft partial reply',
  });

  await screen.findByText('Draft partial reply');

  return { harness, input, sendButton, conversationId, inflightId };
};

describe('Chat page new conversation control', () => {
  it('does not send cancel_inflight when opening a new conversation during an active run', async () => {
    const user = userEvent.setup();
    const { conversationId } = await startInflightConversation(user);
    expect(
      await screen.findByTestId('chat-new-conversation-trigger'),
    ).toBeEnabled();

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
    });

    expect(
      screen.getByText(/Transcript will appear here once you send a message/i),
    ).toBeInTheDocument();

    const cancelMessages = parseSocketMessages().filter(
      (message) =>
        message.type === 'cancel_inflight' &&
        message.conversationId === conversationId,
    );

    expect(cancelMessages).toHaveLength(0);
  });

  it('lets the previous conversation keep running server-side after opening a new conversation', async () => {
    const user = userEvent.setup();
    const { harness, conversationId, inflightId } =
      await startInflightConversation(user);

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
    });

    await act(async () => {
      harness.emitAssistantDelta({
        conversationId,
        inflightId,
        delta: ' + more work',
      });
      harness.emitFinal({
        conversationId,
        inflightId,
        status: 'ok',
      });
    });

    await waitFor(() =>
      expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Transcript will appear here once you send a message/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Draft partial reply + more work'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeEnabled();

    const cancelMessages = parseSocketMessages().filter(
      (message) =>
        message.type === 'cancel_inflight' &&
        message.conversationId === conversationId,
    );
    expect(cancelMessages).toHaveLength(0);
  });

  it('opens a clean draft with an interactive composer and cleared local state', async () => {
    const user = userEvent.setup();
    const { input } = await startInflightConversation(user);

    expect(screen.getByText(/Draft partial reply/i)).toBeInTheDocument();
    expect(screen.getByTestId('chat-stop')).toBeInTheDocument();

    await act(async () => {
      await user.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
    });

    const transcript = screen.getByTestId('chat-transcript');
    expect(
      within(transcript).getByText(
        /Transcript will appear here once you send a message/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(transcript).queryByText(/Draft partial reply/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toBeEnabled();
    expect(screen.getByTestId('chat-send')).toBeEnabled();

    await user.type(input, 'Fresh draft');
    expect(input).toHaveValue('Fresh draft');
  });

  it('clears restored provider state after an explicit new-conversation reset before a fresh provider change sends', async () => {
    const user = userEvent.setup();
    const chatBodies: Array<Record<string, unknown>> = [];

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
                {
                  id: 'copilot',
                  label: 'GitHub Copilot',
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
            }),
          }) as unknown as Response;
        }
        if (href.includes('/chat/models')) {
          const providerId = new URL(href, 'http://localhost').searchParams.get(
            'provider',
          );
          if (providerId === 'copilot') {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                provider: 'copilot',
                available: true,
                toolsAvailable: true,
                models: [
                  {
                    key: 'copilot-chat',
                    displayName: 'Copilot Chat',
                    type: 'chat',
                  },
                ],
              }),
            }) as unknown as Response;
          }

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
                  supportedReasoningEfforts: ['high'],
                  defaultReasoningEffort: 'high',
                },
              ],
            }),
          }) as unknown as Response;
        }
        if (href.includes('/conversations/') && href.includes('/turns')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  conversationId: 'persisted-codex-conversation',
                  role: 'user',
                  content: 'Earlier prompt',
                  model: 'gpt-5.1-codex-max',
                  provider: 'codex',
                  toolCalls: null,
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:00.000Z',
                },
                {
                  conversationId: 'persisted-codex-conversation',
                  role: 'assistant',
                  content: 'Earlier reply',
                  model: 'gpt-5.1-codex-max',
                  provider: 'codex',
                  toolCalls: null,
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:01.000Z',
                },
              ],
            }),
          }) as unknown as Response;
        }
        if (href.includes('/conversations') && opts?.method !== 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  conversationId: 'persisted-codex-conversation',
                  title: 'Persisted Codex conversation',
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
              inflightId: 'next-inflight',
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

    renderChatPage();

    const conversationRow = await screen.findByTestId('conversation-row');
    await act(async () => {
      await user.click(conversationRow);
    });

    expect(await screen.findByText('Earlier reply')).toBeInTheDocument();
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      /openai codex/i,
    );
    expect(screen.getByRole('combobox', { name: /provider/i })).toHaveAttribute(
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
    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    expect(providerSelect).toBeEnabled();
    await user.click(providerSelect);
    await user.click(
      await screen.findByRole('option', { name: /^GitHub Copilot$/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /github copilot/i,
      ),
    );
    const input = await screen.findByTestId('chat-input');
    await user.type(input, 'Use Copilot next');
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]?.provider).toBe('copilot');
    expect(chatBodies[0]?.model).toBe('copilot-chat');
    expect(chatBodies[0]?.conversationId).not.toBe(
      'persisted-codex-conversation',
    );

    await act(async () => {
      await user.click(screen.getByTestId('conversation-row'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /openai codex/i,
      ),
    );
    expect(await screen.findByText('Earlier reply')).toBeInTheDocument();
  }, 15000);

  it('clears restored model state after an explicit new-conversation reset before a fresh model change sends', async () => {
    const user = userEvent.setup();
    const chatBodies: Array<Record<string, unknown>> = [];

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
                  supportedReasoningEfforts: ['high'],
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
        if (href.includes('/conversations/') && href.includes('/turns')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  conversationId: 'persisted-codex-conversation',
                  role: 'user',
                  content: 'Earlier prompt',
                  model: 'gpt-5.1-codex-max',
                  provider: 'codex',
                  toolCalls: null,
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:00.000Z',
                },
                {
                  conversationId: 'persisted-codex-conversation',
                  role: 'assistant',
                  content: 'Earlier reply',
                  model: 'gpt-5.1-codex-max',
                  provider: 'codex',
                  toolCalls: null,
                  status: 'ok',
                  createdAt: '2025-01-01T00:00:01.000Z',
                },
              ],
            }),
          }) as unknown as Response;
        }
        if (href.includes('/conversations') && opts?.method !== 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  conversationId: 'persisted-codex-conversation',
                  title: 'Persisted Codex conversation',
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
              inflightId: 'next-inflight',
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

    renderChatPage();

    const conversationRow = await screen.findByTestId('conversation-row');
    await act(async () => {
      await user.click(conversationRow);
    });

    expect(await screen.findByText('Earlier reply')).toBeInTheDocument();
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

    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await user.click(modelSelect);
    await user.click(await screen.findByRole('option', { name: /gpt-5.2/i }));

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(/gpt-5.2/i),
    );

    const input = await screen.findByTestId('chat-input');
    await user.type(input, 'Use the newer model next');
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]?.provider).toBe('codex');
    expect(chatBodies[0]?.model).toBe('gpt-5.2');
    expect(chatBodies[0]?.conversationId).not.toBe(
      'persisted-codex-conversation',
    );
  });
});
