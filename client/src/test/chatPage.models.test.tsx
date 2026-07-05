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
                  supportedValues: [
                    { value: 'high', label: 'High' },
                    { value: 'xhigh', label: 'Xhigh' },
                    { value: 'minimal', label: 'Minimal' },
                  ],
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

  it('renders the composer info surface as sectioned cards with icons', async () => {
    const user = userEvent.setup();
    mockCodexModelNextSendApi();

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(
        screen.queryByText(/loading chat providers and models/i),
      ).toBeNull(),
    );

    await user.click(await screen.findByTestId('chat-composer-info'));

    const infoPopover = await screen.findByTestId('chat-composer-info-popover');
    expect(
      within(infoPopover).getByText(
        'These values describe exactly what the next chat run will use.',
      ),
    ).toBeInTheDocument();
    expect(
      within(infoPopover).getByTestId('chat-composer-info-section-context'),
    ).toBeInTheDocument();
    expect(
      within(infoPopover).getByTestId('chat-composer-info-section-options'),
    ).toBeInTheDocument();
    expect(
      within(infoPopover).getByTestId('chat-composer-info-provider-icon'),
    ).toBeInTheDocument();
    expect(
      within(infoPopover).getByTestId('chat-composer-info-model-icon'),
    ).toBeInTheDocument();
    expect(
      within(infoPopover).getByTestId('chat-composer-info-thinking-icon'),
    ).toBeInTheDocument();
    expect(within(infoPopover).getByText('Run context')).toBeInTheDocument();
    expect(within(infoPopover).getByText('Active options')).toBeInTheDocument();
    expect(within(infoPopover).getByText('Defaults')).toBeInTheDocument();
    expect(
      within(infoPopover).getByText(
        'No option overrides are active. New sends will use the current defaults.',
      ),
    ).toBeInTheDocument();
  });

  it('shows endpoint label and URL in the composer info panel for endpoint-backed models', async () => {
    const user = userEvent.setup();
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
            selectedProvider: 'codex',
            selectedModel: 'unsloth/gemma-3-27b',
            selectedEndpointId: 'http://192.168.1.3:8888/v1',
          });
        }
        if (target.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'codex',
            available: true,
            toolsAvailable: true,
            providerInfo: {
              id: 'codex',
              label: 'OpenAI Codex',
              available: true,
              toolsAvailable: true,
            },
            models: [
              {
                key: 'unsloth/gemma-3-27b',
                displayName: 'SparkUnsloth / unsloth/gemma-3-27b',
                type: 'codex',
                endpointId: 'http://192.168.1.3:8888/v1',
                endpointLabel: 'SparkUnsloth',
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

    await waitFor(() =>
      expect(
        screen.queryByText(/loading chat providers and models/i),
      ).toBeNull(),
    );

    await user.click(await screen.findByTestId('chat-composer-info'));
    const infoPopover = await screen.findByTestId('chat-composer-info-popover');

    expect(within(infoPopover).getByText('Endpoint')).toBeInTheDocument();
    expect(within(infoPopover).getByText('SparkUnsloth')).toBeInTheDocument();
    expect(within(infoPopover).getByText('Endpoint URL')).toBeInTheDocument();
    expect(
      within(infoPopover).getByText('http://192.168.1.3:8888/v1'),
    ).toBeInTheDocument();
  });

  it('surfaces an error alert when model fetch fails without inventing fallback models', async () => {
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
          throw new Error('chat models down');
        }
        return mockJsonResponse({});
      }),
    );

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const select = await screen.findByRole('combobox', { name: /model/i });
    expect(await screen.findAllByText(/chat models down/i)).not.toHaveLength(0);
    await waitFor(() =>
      expect(select).not.toHaveTextContent('Mock Chat Model'),
    );
    expect(screen.queryByText('Mock Chat Model')).toBeNull();
  });

  it('surfaces a contract error when a successful model payload is malformed', async () => {
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
            reason: 'missing required fields',
          });
        }
        return mockJsonResponse({});
      }),
    );

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const select = await screen.findByRole('combobox', { name: /model/i });
    expect(
      await screen.findAllByText(/malformed chat models response/i),
    ).not.toHaveLength(0);
    await waitFor(() =>
      expect(select).not.toHaveTextContent(/mock chat model/i),
    );
    expect(screen.queryByText('Mock Chat Model')).toBeNull();
  });

  it('loads Copilot models from /chat/models when Copilot is selected', async () => {
    const user = userEvent.setup();
    const requestedProviders: string[] = [];

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
          });
        }
        if (target.includes('/chat/models')) {
          const providerId = new URL(
            target,
            'http://localhost',
          ).searchParams.get('provider');
          requestedProviders.push(providerId ?? 'missing');
          if (providerId === 'copilot') {
            return mockJsonResponse({
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
            });
          }
          return mockJsonResponse({
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
          });
        }
        return mockJsonResponse({});
      }),
    );

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5.1-codex-max/i,
      ),
    );

    await user.click(providerSelect);
    await user.click(
      await screen.findByRole('option', { name: /^GitHub Copilot$/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /copilot chat/i,
      ),
    );
    expect(requestedProviders).toContain('copilot');
  });

  it('keeps duplicate raw model ids independently selectable by endpoint identity', async () => {
    const user = userEvent.setup();

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
            selectedProvider: 'codex',
            selectedModel: 'gpt-5.2',
            selectedEndpointId: 'https://alpha.example/base/v1',
          });
        }
        if (target.includes('/chat/models')) {
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
        return mockJsonResponse({});
      }),
    );

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.2 \(alpha\.example \/ base\)/i,
      ),
    );

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await user.click(modelSelect);

    const baseOption = screen.getByRole('option', {
      name: /gpt-5\.2 \(alpha\.example \/ base\)/i,
    });
    const altOption = screen.getByRole('option', {
      name: /gpt-5\.2 \(alpha\.example \/ alt\)/i,
    });
    expect(baseOption).toHaveAttribute('aria-selected', 'true');
    expect(altOption).toHaveAttribute('aria-selected', 'false');

    await user.click(altOption);

    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.2 \(alpha\.example \/ alt\)/i,
      ),
    );

    const refreshedModelSelect = screen.getByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(refreshedModelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await user.click(refreshedModelSelect);
    const refreshedBaseOption = screen.getByRole('option', {
      name: /gpt-5\.2 \(alpha\.example \/ base\)/i,
    });
    const refreshedAltOption = screen.getByRole('option', {
      name: /gpt-5\.2 \(alpha\.example \/ alt\)/i,
    });
    expect(refreshedBaseOption).toHaveAttribute('aria-selected', 'false');
    expect(refreshedAltOption).toHaveAttribute('aria-selected', 'true');
  });

  it('does not re-enable a provider when /chat/models top-level availability is degraded', async () => {
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
                id: 'copilot',
                label: 'GitHub Copilot',
                available: true,
                toolsAvailable: true,
              },
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
            selectedProvider: 'copilot',
          });
        }
        if (target.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'copilot',
            available: false,
            toolsAvailable: false,
            reason: 'copilot bootstrap degraded',
            providerInfo: {
              id: 'copilot',
              label: 'GitHub Copilot',
              available: false,
              toolsAvailable: false,
              reason: 'copilot bootstrap degraded',
            },
            models: [],
          });
        }
        return mockJsonResponse({});
      }),
    );

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    const modelSelect = await screen.findByRole('combobox', { name: /model/i });

    await waitFor(() =>
      expect(providerSelect).toHaveTextContent(/github copilot/i),
    );
    await waitFor(() =>
      expect(modelSelect).toHaveAttribute('aria-disabled', 'true'),
    );
    expect(
      await screen.findByText(
        /no chat-capable models available for this provider/i,
      ),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: /message/i })).toBeDisabled();
  });

  it('keeps model-specific Agent Flag narrowing aligned to the combined payload when the model changes', async () => {
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
                key: 'gpt-5.1-codex-max',
                displayName: 'gpt-5.1-codex-max',
                type: 'codex',
                supportedReasoningEfforts: ['minimal', 'high', 'xhigh'],
                defaultReasoningEffort: 'minimal',
              },
              {
                key: 'gpt-5.2-codex',
                displayName: 'gpt-5.2-codex',
                type: 'codex',
                supportedReasoningEfforts: ['minimal'],
                defaultReasoningEffort: 'minimal',
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

    await ensureAgentFlagsPanelExpanded();
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
    expect(await screen.findByRole('option', { name: /xhigh/i })).toBeVisible();
    await act(async () => {
      await userEvent.click(screen.getByRole('option', { name: /xhigh/i }));
    });

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await userEvent.click(modelSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /gpt-5.2-codex/i }),
    );

    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/minimal/i));
    await userEvent.click(reasoningSelect);
    expect(
      await screen.findByRole('option', { name: /minimal/i }),
    ).toBeVisible();
    expect(screen.queryByRole('option', { name: /xhigh/i })).toBeNull();
  });

  it('shows provider-aware brand icons in the model selector rows', async () => {
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
                id: 'copilot',
                label: 'GitHub Copilot',
                available: true,
                toolsAvailable: true,
              },
            ],
          });
        }
        if (target.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'copilot',
            available: true,
            toolsAvailable: true,
            models: [
              { key: 'auto', displayName: 'Auto', type: 'copilot' },
              {
                key: 'gpt-5.2',
                displayName: 'gpt-5.2',
                type: 'copilot',
              },
              {
                key: 'claude-sonnet-4.6',
                displayName: 'Claude Sonnet 4.6',
                type: 'copilot',
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

    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: /model/i }),
      ).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await userEvent.click(
      await screen.findByRole('combobox', { name: /model/i }),
    );

    const autoOption = await screen.findByRole('option', { name: /^auto$/i });
    const gptOption = await screen.findByRole('option', { name: /gpt-5\.2/i });
    const claudeOption = await screen.findByRole('option', {
      name: /claude sonnet 4\.6/i,
    });

    expect(
      within(autoOption).getByAltText(/github copilot logo/i),
    ).toBeVisible();
    expect(within(gptOption).getByAltText(/openai logo/i)).toBeVisible();
    expect(within(claudeOption).getByAltText(/claude logo/i)).toBeVisible();
  }, 30000);

  it('groups model options by source first, preserves family sections within each source, and keeps a visible search filter', async () => {
    const user = userEvent.setup();

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
                id: 'copilot',
                label: 'GitHub Copilot',
                available: true,
                toolsAvailable: true,
              },
            ],
            selectedProvider: 'copilot',
            selectedModel: 'moonshotai/kimi-k2.6',
            selectedEndpointId: 'https://openrouter.ai/api/v1',
          });
        }
        if (target.includes('/chat/models')) {
          return mockJsonResponse({
            provider: 'copilot',
            available: true,
            toolsAvailable: true,
            models: [
              {
                key: 'auto',
                displayName: 'Auto',
                type: 'copilot',
              },
              {
                key: 'gpt-5.2',
                displayName: 'gpt-5.2',
                type: 'copilot',
              },
              {
                key: 'claude-sonnet-4.6',
                displayName: 'Claude Sonnet 4.6',
                type: 'copilot',
              },
              {
                key: 'openai/gpt-5.5',
                displayName: 'OpenRouter / openai/gpt-5.5',
                type: 'copilot',
                endpointId: 'https://openrouter.ai/api/v1',
                endpointLabel: 'OpenRouter',
              },
              {
                key: 'moonshotai/kimi-k2.7-code',
                displayName: 'OpenRouter / moonshotai/kimi-k2.7-code',
                type: 'copilot',
                endpointId: 'https://openrouter.ai/api/v1',
                endpointLabel: 'OpenRouter',
              },
              {
                key: 'moonshotai/kimi-k2.6',
                displayName: 'OpenRouter / moonshotai/kimi-k2.6',
                type: 'copilot',
                endpointId: 'https://openrouter.ai/api/v1',
                endpointLabel: 'OpenRouter',
              },
              {
                key: 'nvidia/nemotron-3-ultra-550b-a55b',
                displayName: 'OpenRouter / nvidia/nemotron-3-ultra-550b-a55b',
                type: 'copilot',
                endpointId: 'https://openrouter.ai/api/v1',
                endpointLabel: 'OpenRouter',
              },
              {
                key: 'nvidia/nemotron-3-super-120b-a12b',
                displayName: 'OpenRouter / nvidia/nemotron-3-super-120b-a12b',
                type: 'copilot',
                endpointId: 'https://openrouter.ai/api/v1',
                endpointLabel: 'OpenRouter',
              },
              {
                key: 'google/gemma-4-27b-it',
                displayName: 'SparkUnsloth / google/gemma-4-27b-it',
                type: 'copilot',
                endpointId: 'http://192.168.1.3:8888/v1',
                endpointLabel: 'SparkUnsloth',
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

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await user.click(modelSelect);

    expect(await screen.findByTestId('chat-model-search')).toBeVisible();
    expect(
      screen
        .getAllByTestId('chat-model-source-header')
        .map((header) => header.textContent),
    ).toEqual(['GitHub Copilot', 'OpenRouter', 'SparkUnsloth']);
    expect(
      screen
        .getAllByTestId('chat-model-family-header')
        .map((header) => header.textContent),
    ).toEqual([
      'Claude',
      'GitHub Copilot',
      'OpenAI',
      'Kimi',
      'Nvidia',
      'OpenAI',
      'Gemma',
    ]);

    const optionNames = screen
      .getAllByRole('option')
      .map((option) => option.getAttribute('aria-label'));
    expect(optionNames).toEqual([
      'Claude Sonnet 4.6',
      'Auto',
      'gpt-5.2',
      'OpenRouter / moonshotai/kimi-k2.6',
      'OpenRouter / moonshotai/kimi-k2.7-code',
      'OpenRouter / nvidia/nemotron-3-super-120b-a12b',
      'OpenRouter / nvidia/nemotron-3-ultra-550b-a55b',
      'OpenRouter / openai/gpt-5.5',
      'SparkUnsloth / google/gemma-4-27b-it',
    ]);

    await user.type(screen.getByTestId('chat-model-search'), 'sparkunsloth');

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(
      screen
        .getAllByTestId('chat-model-source-header')
        .map((header) => header.textContent),
    ).toEqual(['SparkUnsloth']);
    expect(
      screen
        .getAllByTestId('chat-model-family-header')
        .map((header) => header.textContent),
    ).toEqual(['Gemma']);
    expect(
      screen.getByRole('option', {
        name: /sparkunsloth \/ google\/gemma-4-27b-it/i,
      }),
    ).toBeVisible();
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

    await ensureAgentFlagsPanelExpanded();
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

    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
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

    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
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
  }, 30000);

  it('clears stale hidden reasoning draft values when the selected model changes', async () => {
    const { chatBodies } = mockCodexModelNextSendApi();
    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const user = userEvent.setup();
    await ensureAgentFlagsPanelExpanded(user);

    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await user.click(reasoningSelect);
    await user.click(await screen.findByRole('option', { name: /xhigh/i }));
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/xhigh/i));

    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await user.click(modelSelect);
    await user.click(await screen.findByRole('option', { name: /gpt-5.2/i }));

    const narrowedReasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() =>
      expect(narrowedReasoningSelect).toHaveTextContent(/minimal/i),
    );
    await user.click(narrowedReasoningSelect);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    await user.click(await screen.findByRole('option', { name: /minimal/i }));
    expect(screen.queryByRole('option', { name: /xhigh/i })).toBeNull();

    const input = await screen.findByTestId('chat-input');
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, 'Use the narrowed draft');
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    await act(async () => {
      await user.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]?.model).toBe('gpt-5.2');
    expect(
      (chatBodies[0]?.agentFlags as Record<string, unknown>)
        ?.modelReasoningEffort,
    ).toBe('minimal');
  }, 15000);

  it('refreshes the displayed resolved default from the combined payload when the model changes', async () => {
    mockCodexModelNextSendApi();

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const user = userEvent.setup();
    await ensureAgentFlagsPanelExpanded(user);

    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/high/i));

    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await user.click(modelSelect);
    await user.click(await screen.findByRole('option', { name: /gpt-5.2/i }));

    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/minimal/i));
  });
});
