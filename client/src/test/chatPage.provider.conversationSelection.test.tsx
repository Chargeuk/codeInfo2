import { jest } from '@jest/globals';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ensureAgentFlagsPanelExpanded } from './support/ensureAgentFlagsPanelExpanded';
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

const codexConversationId = 'conv-codex';
const lmConversationId = 'conv-lm';

function mockApi() {
  const chatBodies: Record<string, unknown>[] = [];

  mockFetch.mockImplementation(
    async (url: RequestInfo | URL, opts?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString();

      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok', mongoConnected: true }),
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

      if (href.includes('/chat/models') && href.includes('provider=lmstudio')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'lmstudio',
            available: true,
            toolsAvailable: true,
            defaultModel: 'model-1',
            defaultModelSource: 'config',
            providerInfo: {
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
              defaultModel: 'model-1',
              defaultModelSource: 'config',
            },
            models: [{ key: 'lm', displayName: 'LM Model', type: 'gguf' }],
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

      if (href.includes('/conversations/') && href.includes('/turns')) {
        const isCodex = href.includes(codexConversationId);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                conversationId: isCodex
                  ? codexConversationId
                  : lmConversationId,
                role: 'user',
                content: isCodex ? 'hello codex' : 'hello lm',
                model: 'm1',
                provider: isCodex ? 'codex' : 'lmstudio',
                toolCalls: null,
                status: 'ok',
                createdAt: '2025-12-09T12:00:00.000Z',
              },
              {
                conversationId: isCodex
                  ? codexConversationId
                  : lmConversationId,
                role: 'assistant',
                content: isCodex ? 'codex reply' : 'lm reply',
                model: 'm1',
                provider: isCodex ? 'codex' : 'lmstudio',
                toolCalls: null,
                status: 'ok',
                createdAt: '2025-12-09T12:00:01.000Z',
              },
            ],
          }),
        }) as unknown as Response;
      }

      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                conversationId: codexConversationId,
                title: 'Codex conversation',
                provider: 'codex',
                model: 'gpt-5.1-codex-max',
                lastMessageAt: '2025-12-09T12:00:02.000Z',
                archived: false,
              },
              {
                conversationId: lmConversationId,
                title: 'LM conversation',
                provider: 'lmstudio',
                model: 'lm',
                lastMessageAt: '2025-12-09T11:59:59.000Z',
                archived: false,
              },
            ],
            nextCursor: undefined,
          }),
        }) as unknown as Response;
      }

      if (href.includes('/chat') && opts?.method === 'POST') {
        const body =
          opts?.body && typeof opts.body === 'string'
            ? (JSON.parse(opts.body) as Record<string, unknown>)
            : {};
        chatBodies.push(body);
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            status: 'started',
            conversationId: body.conversationId,
            inflightId: 'i1',
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

async function startDraftRun() {
  const user = userEvent.setup();
  const { chatBodies } = mockApi();
  const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
  render(<RouterProvider router={router} />);

  await screen.findByText('Codex conversation');
  await selectProvider(user, /^LM Studio$/i);
  await waitFor(() =>
    expect(screen.getByTestId('provider-select')).toHaveTextContent(
      /LM Studio/i,
    ),
  );

  const input = screen.getByTestId('chat-input');
  await user.type(input, 'Hello inflight');

  await act(async () => {
    await user.click(screen.getByTestId('chat-send'));
  });

  await waitFor(() => expect(chatBodies).toHaveLength(1));

  return {
    user,
    draftConversationId: String(chatBodies[0]?.conversationId ?? ''),
  };
}

async function selectProvider(
  user: ReturnType<typeof userEvent.setup>,
  optionName: RegExp,
) {
  const providerSelect = screen.getByRole('combobox', { name: /provider/i });
  await act(async () => {
    await user.click(providerSelect);
  });
  const option = await screen.findByRole('option', { name: optionName });
  await act(async () => {
    await user.click(option);
  });
}

describe('Chat shared shell conversation selection', () => {
  it('does not send cancel_inflight when switching conversations during an active run', async () => {
    const { user, draftConversationId } = await startDraftRun();

    const codexRowTitle = screen.getByText('Codex conversation');
    const codexRow = codexRowTitle.closest('[data-testid="conversation-row"]');
    if (!codexRow) {
      throw new Error('Codex conversation row not found');
    }

    await act(async () => {
      await user.click(codexRow);
    });

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    const cancelMessages = getWsMessages().filter(
      (msg) =>
        msg.type === 'cancel_inflight' &&
        msg.conversationId === draftConversationId,
    );

    expect(cancelMessages).toHaveLength(0);
  }, 15000);

  it('shows only the selected conversation transcript and local state after switching', async () => {
    const { user } = await startDraftRun();

    expect(screen.getByText('Hello inflight')).toBeInTheDocument();
    expect(screen.queryByText(/Responding.../i)).not.toBeInTheDocument();

    const codexRowTitle = screen.getByText('Codex conversation');
    const codexRow = codexRowTitle.closest('[data-testid="conversation-row"]');
    if (!codexRow) {
      throw new Error('Codex conversation row not found');
    }

    await act(async () => {
      await user.click(codexRow);
    });

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    const transcript = await screen.findByTestId('chat-transcript');
    const userTurn = within(transcript).getByText('hello codex');
    const assistantTurn = within(transcript).getByText('codex reply');
    expect(
      userTurn.compareDocumentPosition(assistantTurn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(transcript).getByText('codex reply')).toBeInTheDocument();
    expect(
      within(transcript).queryByText('Hello inflight'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Responding.../i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeEnabled();
  }, 15000);

  it('does not send cancel_inflight when changing provider during an active run', async () => {
    const { user, draftConversationId } = await startDraftRun();

    await selectProvider(user, /openai codex/i);

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    const cancelMessages = getWsMessages().filter(
      (msg) =>
        msg.type === 'cancel_inflight' &&
        msg.conversationId === draftConversationId,
    );

    expect(cancelMessages).toHaveLength(0);
  });

  it('keeps the provider selector enabled for the visible next-send view', async () => {
    const { user } = await startDraftRun();

    const providerSelect = screen.getByRole('combobox', { name: /provider/i });
    expect(providerSelect).toBeEnabled();

    await selectProvider(user, /openai codex/i);

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );

    expect(screen.getByRole('combobox', { name: /provider/i })).toBeEnabled();
    expect(screen.getByTestId('chat-input')).toBeEnabled();
    expect(screen.queryByText('Hello inflight')).not.toBeInTheDocument();
    expect(screen.queryByText(/Responding.../i)).not.toBeInTheDocument();
  }, 15000);

  it('keeps resumed provider and model selectors read-only while a stored conversation is selected', async () => {
    const user = userEvent.setup();
    mockApi();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const codexRowTitle = await screen.findByText('Codex conversation');
    const codexRow = codexRowTitle.closest('[data-testid="conversation-row"]');
    if (!codexRow) {
      throw new Error('Codex conversation row not found');
    }

    await act(async () => {
      await user.click(codexRow);
    });

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.1-codex-max/i,
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
    expect(screen.getByText('codex reply')).toBeInTheDocument();
  }, 15000);

  it('restores the selected conversation over an unsent provider draft without merging hidden draft flags', async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation(
      async (url: RequestInfo | URL, opts?: RequestInit) => {
        const href = typeof url === 'string' ? url : url.toString();

        if (href.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ status: 'ok', mongoConnected: true }),
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
              ],
            }),
          }) as unknown as Response;
        }

        if (
          href.includes('/chat/models') &&
          href.includes('provider=copilot')
        ) {
          const copilotAgentFlags = [
            {
              key: 'toolAccess',
              label: 'Tool Access',
              controlType: 'select',
              editable: true,
              seedDefault: 'on',
              resolvedDefault: 'on',
              supportedValues: [
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ],
            },
          ];
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              provider: 'copilot',
              available: true,
              toolsAvailable: true,
              providerInfo: {
                id: 'copilot',
                label: 'GitHub Copilot',
                available: true,
                toolsAvailable: true,
                agentFlags: copilotAgentFlags,
              },
              agentFlags: copilotAgentFlags,
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

        if (href.includes('/chat/models') && href.includes('provider=codex')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              provider: 'codex',
              available: true,
              toolsAvailable: true,
              providerInfo: {
                id: 'codex',
                label: 'OpenAI Codex',
                available: true,
                toolsAvailable: true,
                agentFlags: [
                  {
                    key: 'sandboxMode',
                    label: 'Sandbox Mode',
                    controlType: 'select',
                    editable: true,
                    seedDefault: 'workspace-write',
                    resolvedDefault: 'workspace-write',
                    supportedValues: [
                      { value: 'workspace-write', label: 'Workspace write' },
                      { value: 'read-only', label: 'Read-only' },
                      {
                        value: 'danger-full-access',
                        label: 'Danger full access',
                      },
                    ],
                  },
                  {
                    key: 'approvalPolicy',
                    label: 'Approval Policy',
                    controlType: 'select',
                    editable: true,
                    seedDefault: 'on-request',
                    resolvedDefault: 'on-request',
                    supportedValues: [
                      { value: 'never', label: 'Never (auto-approve)' },
                      { value: 'on-request', label: 'On request' },
                      { value: 'untrusted', label: 'Untrusted' },
                    ],
                  },
                  {
                    key: 'modelReasoningEffort',
                    label: 'Reasoning Effort',
                    controlType: 'select',
                    editable: true,
                    seedDefault: 'high',
                    resolvedDefault: 'high',
                    supportedValues: [{ value: 'high', label: 'High' }],
                  },
                  {
                    key: 'networkAccessEnabled',
                    label: 'Network Access',
                    controlType: 'boolean',
                    editable: true,
                    seedDefault: true,
                    resolvedDefault: true,
                  },
                  {
                    key: 'webSearchMode',
                    label: 'Web Search',
                    controlType: 'select',
                    editable: true,
                    seedDefault: 'live',
                    resolvedDefault: 'live',
                    supportedValues: [
                      { value: 'disabled', label: 'Disabled' },
                      { value: 'cached', label: 'Cached' },
                      { value: 'live', label: 'Live' },
                    ],
                  },
                ],
              },
              agentFlags: [
                {
                  key: 'sandboxMode',
                  label: 'Sandbox Mode',
                  controlType: 'select',
                  editable: true,
                  seedDefault: 'workspace-write',
                  resolvedDefault: 'workspace-write',
                  supportedValues: [
                    { value: 'workspace-write', label: 'Workspace write' },
                    { value: 'read-only', label: 'Read-only' },
                    {
                      value: 'danger-full-access',
                      label: 'Danger full access',
                    },
                  ],
                },
                {
                  key: 'approvalPolicy',
                  label: 'Approval Policy',
                  controlType: 'select',
                  editable: true,
                  seedDefault: 'on-request',
                  resolvedDefault: 'on-request',
                  supportedValues: [
                    { value: 'never', label: 'Never (auto-approve)' },
                    { value: 'on-request', label: 'On request' },
                    { value: 'untrusted', label: 'Untrusted' },
                  ],
                },
                {
                  key: 'modelReasoningEffort',
                  label: 'Reasoning Effort',
                  controlType: 'select',
                  editable: true,
                  seedDefault: 'high',
                  resolvedDefault: 'high',
                  supportedValues: [{ value: 'high', label: 'High' }],
                },
                {
                  key: 'networkAccessEnabled',
                  label: 'Network Access',
                  controlType: 'boolean',
                  editable: true,
                  seedDefault: true,
                  resolvedDefault: true,
                },
                {
                  key: 'webSearchMode',
                  label: 'Web Search',
                  controlType: 'select',
                  editable: true,
                  seedDefault: 'live',
                  resolvedDefault: 'live',
                  supportedValues: [
                    { value: 'disabled', label: 'Disabled' },
                    { value: 'cached', label: 'Cached' },
                    { value: 'live', label: 'Live' },
                  ],
                },
              ],
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
                  conversationId: codexConversationId,
                  role: 'user',
                  content: 'hello codex',
                  model: 'gpt-5.1-codex-max',
                  provider: 'codex',
                  toolCalls: null,
                  status: 'ok',
                  createdAt: '2025-12-09T12:00:00.000Z',
                },
                {
                  conversationId: codexConversationId,
                  role: 'assistant',
                  content: 'codex reply',
                  model: 'gpt-5.1-codex-max',
                  provider: 'codex',
                  toolCalls: null,
                  status: 'ok',
                  createdAt: '2025-12-09T12:00:01.000Z',
                },
              ],
            }),
          }) as unknown as Response;
        }

        if (href.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  conversationId: codexConversationId,
                  title: 'Codex conversation',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  lastMessageAt: '2025-12-09T12:00:02.000Z',
                  archived: false,
                },
              ],
              nextCursor: undefined,
            }),
          }) as unknown as Response;
        }

        if (href.includes('/chat') && opts?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              conversationId: 'draft-conversation',
              inflightId: 'i1',
              provider: 'copilot',
              model: 'copilot-chat',
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

    const conversationRow = await screen.findByTestId('conversation-row');
    await act(async () => {
      await user.click(conversationRow);
    });

    expect(await screen.findByText('codex reply')).toBeInTheDocument();
    await ensureAgentFlagsPanelExpanded(user);
    expect(
      screen.getByRole('combobox', { name: /sandbox mode/i }),
    ).toBeInTheDocument();
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

    await selectProvider(user, /^GitHub Copilot$/i);
    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /GitHub Copilot/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /Copilot Chat/i,
      ),
    );
    expect(screen.queryByText('codex reply')).not.toBeInTheDocument();
    await ensureAgentFlagsPanelExpanded(user);
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: /tool access/i }),
      ).toHaveTextContent(/on/i),
    );
    await user.click(screen.getByRole('combobox', { name: /tool access/i }));
    await user.click(await screen.findByRole('option', { name: /^Off$/i }));
    await waitFor(() =>
      expect(screen.getByTestId('tool-access-select')).toHaveTextContent(
        /off/i,
      ),
    );

    await act(async () => {
      await user.click(screen.getByTestId('conversation-row'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );
    expect(await screen.findByText('codex reply')).toBeInTheDocument();
    await ensureAgentFlagsPanelExpanded(user);
    expect(
      screen.getByRole('combobox', { name: /sandbox mode/i }),
    ).toHaveTextContent(/workspace write/i);
    expect(
      screen.queryByRole('combobox', { name: /tool access/i }),
    ).not.toBeInTheDocument();
  });

  it('reloads LM Studio models and replaces a persisted Codex model label when the next-send provider changes after a stale LM Studio default response', async () => {
    const user = userEvent.setup();
    mockApi();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const codexRowTitle = await screen.findByText('Codex conversation');
    const codexRow = codexRowTitle.closest('[data-testid="conversation-row"]');
    if (!codexRow) {
      throw new Error('Codex conversation row not found');
    }

    await act(async () => {
      await user.click(codexRow);
    });

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.1-codex-max/i,
      ),
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

    await selectProvider(user, /^LM Studio$/i);

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /LM Studio/i,
      ),
    );
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([url]) =>
          String(url).includes('/chat/models?provider=lmstudio'),
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(/LM Model/i),
    );
    expect(screen.getByTestId('model-select')).not.toHaveTextContent(
      /gpt-5\.1-codex-max/i,
    );
  });

  it('keeps the restored endpoint identity local while a conversation is selected and restores the native create-mode pair after starting a fresh draft', async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation(
      asFetchImplementation(
        async (url: RequestInfo | URL, opts?: RequestInit) => {
          const href = typeof url === 'string' ? url : url.toString();

          if (href.includes('/health')) {
            return mockJsonResponse({ mongoConnected: true });
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
              ],
              selectedProvider: 'codex',
              selectedModel: 'gpt-5.2',
              selectedEndpointId: 'https://alpha.example/stale/v1',
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
              selectedEndpointId: 'https://alpha.example/stale/v1',
              providerInfo: {
                id: 'codex',
                label: 'OpenAI Codex',
                available: true,
                toolsAvailable: true,
                defaultModel: 'gpt-5.2',
              },
              models: [
                {
                  key: 'gpt-5.2',
                  displayName: 'gpt-5.2',
                  type: 'codex',
                },
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

          if (href.includes('/conversations/codex-conv/turns')) {
            return mockJsonResponse({
              items: [
                {
                  conversationId: 'codex-conv',
                  role: 'user',
                  content: 'hello codex',
                  model: 'gpt-5.1-codex-max',
                  provider: 'codex',
                  toolCalls: null,
                  status: 'ok',
                  createdAt: '2025-12-09T12:00:00.000Z',
                },
                {
                  conversationId: 'codex-conv',
                  role: 'assistant',
                  content: 'codex reply',
                  model: 'gpt-5.1-codex-max',
                  provider: 'codex',
                  toolCalls: null,
                  status: 'ok',
                  createdAt: '2025-12-09T12:00:01.000Z',
                },
              ],
            });
          }

          if (href.includes('/conversations')) {
            return mockJsonResponse({
              items: [
                {
                  conversationId: 'codex-conv',
                  title: 'Codex conversation',
                  provider: 'codex',
                  model: 'gpt-5.1-codex-max',
                  flags: {
                    endpointId: 'https://alpha.example/alt/v1',
                  },
                  lastMessageAt: '2025-12-09T12:00:02.000Z',
                  archived: false,
                },
              ],
              nextCursor: undefined,
            });
          }

          if (href.includes('/chat') && opts?.method === 'POST') {
            return mockJsonResponse({
              status: 'started',
              conversationId: 'draft-conversation',
              inflightId: 'i1',
              provider: 'codex',
              model: 'gpt-5.2',
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
      expect(screen.getByTestId('model-select')).toHaveTextContent(/gpt-5\.2/i),
    );
    expect(screen.getByTestId('model-select')).not.toHaveTextContent(
      /alpha\.example/i,
    );

    const conversationRow = await screen.findByTestId('conversation-row');
    await act(async () => {
      await user.click(conversationRow);
    });

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
      expect(screen.getByTestId('model-select')).toHaveTextContent(/gpt-5\.2/i),
    );
    expect(screen.getByTestId('model-select')).not.toHaveTextContent(
      /alpha\.example/i,
    );
    expect(
      screen.getByRole('combobox', { name: /provider/i }),
    ).not.toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('combobox', { name: /model/i }),
    ).not.toHaveAttribute('aria-disabled', 'true');
  });
});
