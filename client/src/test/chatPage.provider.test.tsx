import { jest } from '@jest/globals';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ensureAgentFlagsPanelExpanded } from './support/ensureAgentFlagsPanelExpanded';

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
const { shouldPreserveCopilotReasoningDefault } = await import(
  '../hooks/useChatModel'
);

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

function mockChatProvidersFetch(options: {
  providers: Array<{
    id: string;
    label: string;
    available: boolean;
    toolsAvailable: boolean;
    reason?: string;
  }>;
  modelsProvider: string;
  models?: Array<Record<string, unknown>>;
  defaultModel?: string;
  selectedProvider?: string;
  selectedModel?: string;
  selectedEndpointId?: string;
  providerInfo?: Record<string, unknown>;
  agents?: Array<{ name: string }>;
}) {
  mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('/health')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ mongoConnected: true }),
      }) as unknown as Response;
    }
    if (href.includes('/conversations')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ items: [], nextCursor: null }),
      }) as unknown as Response;
    }
    if (href.includes('/chat/providers')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          providers: options.providers,
          ...(options.selectedProvider
            ? { selectedProvider: options.selectedProvider }
            : {}),
          ...(options.selectedModel
            ? { selectedModel: options.selectedModel }
            : {}),
          ...(options.selectedEndpointId
            ? { selectedEndpointId: options.selectedEndpointId }
            : {}),
        }),
      }) as unknown as Response;
    }
    if (href.includes('/chat/models')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          provider: options.modelsProvider,
          available: true,
          toolsAvailable: true,
          ...(options.defaultModel
            ? { defaultModel: options.defaultModel }
            : {}),
          ...(options.providerInfo
            ? { providerInfo: options.providerInfo }
            : {}),
          models: options.models ?? [
            { key: 'm1', displayName: 'Model 1', type: 'gguf' },
          ],
        }),
      }) as unknown as Response;
    }
    if (href.endsWith('/agents')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ agents: options.agents ?? [] }),
      }) as unknown as Response;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as unknown as Response;
  });
}

describe('Chat provider selection (WS transport)', () => {
  const copilotReasoningFlag = {
    key: 'modelReasoningEffort',
    label: 'Reasoning Effort',
    controlType: 'select',
    editable: true,
    seedDefault: 'medium',
    resolvedDefault: 'high',
    supportedValues: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
  } as const;

  it('uses the server-selected provider and model during bootstrap', async () => {
    mockChatProvidersFetch({
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
      modelsProvider: 'copilot',
      models: [
        {
          key: 'auto',
          displayName: 'Auto',
          type: 'copilot',
        },
        {
          key: 'gpt-5-mini',
          displayName: 'GPT-5 mini',
          type: 'copilot',
        },
      ],
      defaultModel: 'gpt-5-mini',
      selectedProvider: 'copilot',
      selectedModel: 'gpt-5-mini',
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(
        screen.queryByText(/loading chat providers and models/i),
      ).toBeNull(),
    );

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });

    await waitFor(() =>
      expect(providerSelect).toHaveTextContent(/github copilot/i),
    );
    await waitFor(() => expect(modelSelect).toHaveTextContent(/gpt-5 mini/i));
  });

  it('keeps the bootstrap endpoint identity alongside the server-selected model when duplicate raw ids exist', async () => {
    mockChatProvidersFetch({
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
      modelsProvider: 'codex',
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
      defaultModel: 'gpt-5.2',
      selectedProvider: 'codex',
      selectedModel: 'gpt-5.2',
      selectedEndpointId: 'https://alpha.example/base/v1',
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(
        screen.queryByText(/loading chat providers and models/i),
      ).toBeNull(),
    );

    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /openai codex/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.2 \(alpha\.example \/ base\)/i,
      ),
    );

    const modelSelect = screen.getByRole('combobox', { name: /model/i });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await userEvent.click(modelSelect);
    expect(
      screen.getAllByRole('option', {
        name: /gpt-5\.2 \(alpha\.example \/ (base|alt)\)/i,
      }),
    ).toHaveLength(2);
  });

  it('drops a degraded server-selected provider from the next request payload when another provider is runnable', async () => {
    const user = userEvent.setup();
    const sentBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const href = typeof url === 'string' ? url : url.toString();
        if (href.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ mongoConnected: true }),
          }) as unknown as Response;
        }
        if (href.includes('/conversations') && init?.method !== 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [], nextCursor: null }),
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
                  available: false,
                  toolsAvailable: false,
                  reason: 'copilot bootstrap degraded',
                },
                {
                  id: 'lmstudio',
                  label: 'LM Studio',
                  available: true,
                  toolsAvailable: true,
                },
              ],
              selectedProvider: 'copilot',
              selectedModel: 'copilot-gpt-5-mini',
            }),
          }) as unknown as Response;
        }
        if (href.includes('/chat/models')) {
          const providerId = new URL(href, 'http://localhost').searchParams.get(
            'provider',
          );
          if (providerId === 'codex') {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                provider: 'codex',
                available: true,
                toolsAvailable: true,
                defaultModel: 'gpt-5.3-codex',
                providerInfo: {
                  id: 'codex',
                  label: 'OpenAI Codex',
                  available: true,
                  toolsAvailable: true,
                  defaultModel: 'gpt-5.3-codex',
                },
                models: [
                  {
                    key: 'gpt-5.3-codex',
                    displayName: 'GPT-5.3 Codex',
                    type: 'codex',
                  },
                ],
              }),
            }) as unknown as Response;
          }

          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
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
            }),
          }) as unknown as Response;
        }
        if (href.includes('/chat') && init?.method === 'POST') {
          const body =
            typeof init.body === 'string'
              ? (JSON.parse(init.body) as Record<string, unknown>)
              : {};
          sentBodies.push(body);
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              status: 'started',
              conversationId: body.conversationId,
              inflightId: 'inflight-1',
              provider: body.provider,
              model: body.model,
            }),
          }) as unknown as Response;
        }
        if (href.endsWith('/agents')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [] }),
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
      expect(
        screen.queryByText(/loading chat providers and models/i),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /openai codex/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.3 codex/i,
      ),
    );

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'hello');
    await user.click(screen.getByTestId('chat-send'));

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    expect(sentBodies[0]?.provider).toBe('codex');
    expect(sentBodies[0]?.model).toBe('gpt-5.3-codex');
  });

  it('keeps an explicit provider change after bootstrapping from the server-selected default', async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
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
            selectedProvider: 'copilot',
            selectedModel: 'gpt-5-mini',
          }),
        }) as unknown as Response;
      }
      if (href.includes('/chat/models')) {
        const providerId = new URL(href, 'http://localhost').searchParams.get(
          'provider',
        );

        if (providerId === 'codex') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              provider: 'codex',
              available: true,
              toolsAvailable: true,
              defaultModel: 'gpt-5.3-codex',
              codexDefaults: {
                sandboxMode: 'workspace-write',
                approvalPolicy: 'on-request',
                modelReasoningEffort: 'high',
                networkAccessEnabled: true,
                webSearchMode: 'live',
              },
              codexWarnings: [],
              providerInfo: {
                id: 'codex',
                label: 'OpenAI Codex',
                available: true,
                toolsAvailable: true,
                defaultModel: 'gpt-5.3-codex',
              },
              models: [
                {
                  key: 'gpt-5.3-codex',
                  displayName: 'GPT-5.3 Codex',
                  type: 'codex',
                },
              ],
            }),
          }) as unknown as Response;
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'copilot',
            available: true,
            toolsAvailable: true,
            defaultModel: 'gpt-5-mini',
            models: [
              {
                key: 'gpt-5-mini',
                displayName: 'GPT-5 mini',
                type: 'copilot',
              },
            ],
          }),
        }) as unknown as Response;
      }
      if (href.endsWith('/agents')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ agents: [] }),
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

    await waitFor(() =>
      expect(
        screen.queryByText(/loading chat providers and models/i),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /github copilot/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5 mini/i,
      ),
    );

    await user.click(screen.getByRole('combobox', { name: /provider/i }));
    await user.click(
      await screen.findByRole('option', { name: /^OpenAI Codex$/i }),
    );

    await waitFor(() =>
      expect(
        screen.queryByText(/loading chat providers and models/i),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /openai codex/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5\.3 codex/i,
      ),
    );
  });

  it('keeps the Copilot config reasoning default for the default Copilot provider-model pair', async () => {
    mockChatProvidersFetch({
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
      modelsProvider: 'copilot',
      models: [
        {
          key: 'gpt-5-mini',
          displayName: 'GPT-5 mini',
          type: 'copilot',
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
          flagOverrides: [
            {
              key: 'modelReasoningEffort',
              resolvedDefault: 'medium',
              supportedValues: [
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ],
            },
          ],
        },
      ],
      defaultModel: 'gpt-5-mini',
      selectedProvider: 'copilot',
      selectedModel: 'gpt-5-mini',
      providerInfo: {
        id: 'copilot',
        label: 'GitHub Copilot',
        available: true,
        toolsAvailable: true,
        defaultModel: 'gpt-5-mini',
        agentFlags: [copilotReasoningFlag],
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await ensureAgentFlagsPanelExpanded();

    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/high/i));
  });

  it('uses the model reasoning default when the selected Copilot model is not the config default model', async () => {
    mockChatProvidersFetch({
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
      modelsProvider: 'copilot',
      models: [
        {
          key: 'gpt-5.5',
          displayName: 'GPT-5.5',
          type: 'copilot',
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
          flagOverrides: [
            {
              key: 'modelReasoningEffort',
              resolvedDefault: 'medium',
              supportedValues: [
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ],
            },
          ],
        },
      ],
      defaultModel: 'gpt-5-mini',
      selectedProvider: 'copilot',
      selectedModel: 'gpt-5.5',
      providerInfo: {
        id: 'copilot',
        label: 'GitHub Copilot',
        available: true,
        toolsAvailable: true,
        defaultModel: 'gpt-5-mini',
        agentFlags: [copilotReasoningFlag],
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await ensureAgentFlagsPanelExpanded();

    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/medium/i));
  });

  it('does not preserve the Copilot config reasoning default when Copilot is not the server default provider', () => {
    expect(
      shouldPreserveCopilotReasoningDefault({
        provider: 'copilot',
        serverSelectedProvider: 'codex',
        descriptorKey: 'modelReasoningEffort',
        providerDefaultModel: 'gpt-5-mini',
        selectedModel: 'gpt-5-mini',
      }),
    ).toBe(false);
  });

  it('renders providers in codex, copilot, lmstudio order and shows the Copilot disabled reason', async () => {
    const user = userEvent.setup();
    mockChatProvidersFetch({
      providers: [
        {
          id: 'lmstudio',
          label: 'LM Studio',
          available: true,
          toolsAvailable: true,
        },
        {
          id: 'copilot',
          label: 'GitHub Copilot',
          available: false,
          toolsAvailable: false,
          reason: 'GitHub login required',
        },
        {
          id: 'codex',
          label: 'OpenAI Codex',
          available: true,
          toolsAvailable: true,
        },
      ],
      modelsProvider: 'codex',
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await user.click(providerSelect);

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'OpenAI Codex',
      'GitHub Copilot (unavailable: GitHub login required)',
      'LM Studio',
    ]);
    expect(options[1]).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps provider rows visible but unavailable when provider bootstrap fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
        }) as unknown as Response;
      }
      if (href.includes('/chat/providers')) {
        throw new Error('provider bootstrap unavailable');
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    expect(
      await screen.findAllByText(/provider bootstrap unavailable/i),
    ).not.toHaveLength(0);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });

    await user.click(providerSelect);
    expect(
      await screen.findByRole('option', {
        name: /github copilot \(unavailable: provider bootstrap unavailable\)/i,
      }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      await screen.findByRole('option', {
        name: /lm studio \(unavailable: provider bootstrap unavailable\)/i,
      }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('stops loading and keeps a deterministic provider when every provider is unavailable', async () => {
    const user = userEvent.setup();
    mockChatProvidersFetch({
      providers: [
        {
          id: 'codex',
          label: 'OpenAI Codex',
          available: false,
          toolsAvailable: false,
          reason: 'Codex unavailable',
        },
        {
          id: 'copilot',
          label: 'GitHub Copilot',
          available: false,
          toolsAvailable: false,
          reason: 'Copilot unavailable',
        },
        {
          id: 'lmstudio',
          label: 'LM Studio',
          available: false,
          toolsAvailable: false,
          reason: 'LM Studio unavailable',
        },
      ],
      modelsProvider: 'codex',
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(
        screen.queryByText(/loading chat providers and models/i),
      ).toBeNull();
    });

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    expect(providerSelect).toBeInTheDocument();

    await user.click(providerSelect);
    expect(
      await screen.findByRole('option', {
        name: /openai codex \(unavailable: codex unavailable\)/i,
      }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('surfaces a contract error when a successful provider payload is malformed', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
        }) as unknown as Response;
      }
      if (href.includes('/chat/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ providerList: [] }),
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

    expect(
      await screen.findAllByText(/malformed chat providers response/i),
    ).not.toHaveLength(0);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });

    await user.click(providerSelect);
    expect(
      await screen.findByRole('option', {
        name: /github copilot \(unavailable: malformed chat providers response\)/i,
      }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the explicit legacy array bootstrap path working for provider bootstrap', async () => {
    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
        }) as unknown as Response;
      }
      if (href.includes('/chat/providers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            { key: 'legacy-model', displayName: 'Legacy Model', type: 'gguf' },
          ],
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

    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: /provider/i }),
      ).toHaveTextContent(/lm studio/i),
    );
    expect(screen.getByTestId('model-select')).toHaveTextContent(
      /legacy model/i,
    );
    expect(screen.queryByText(/malformed chat providers response/i)).toBeNull();
  });

  it('shows Codex as unavailable with guidance banner', async () => {
    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
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
                available: false,
                toolsAvailable: false,
                reason: 'Compose mounts missing',
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    expect(providerSelect).toBeInTheDocument();

    await userEvent.click(providerSelect);
    const codexOption = await screen.findByRole('option', {
      name: /openai codex/i,
    });
    expect(codexOption).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');

    const banner = await screen.findByTestId('codex-unavailable-banner');
    expect(banner).toHaveTextContent('Compose mounts');
    const link = within(banner).getByRole('link', { name: /codex \(cli\)/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('#codex-cli'));
  });

  it('does not show re-authenticate on chat when Codex is selected and available', async () => {
    mockChatProvidersFetch({
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
      modelsProvider: 'codex',
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /provider/i });
    expect(
      screen.queryByRole('button', { name: /re-authenticate/i }),
    ).toBeNull();
  });

  it('does not show re-authenticate on chat when Codex is unavailable', async () => {
    mockChatProvidersFetch({
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
          available: false,
          toolsAvailable: false,
        },
      ],
      modelsProvider: 'lmstudio',
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /provider/i });
    expect(
      screen.queryByRole('button', { name: /re-authenticate/i }),
    ).toBeNull();
  });

  it('renders provider-driven Agent Flags and refreshes them when switching between Codex and Copilot', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
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
          const copilotAgentFlags = [
            {
              key: 'modelReasoningEffort',
              label: 'Reasoning Effort',
              controlType: 'select',
              editable: true,
              seedDefault: 'medium',
              resolvedDefault: 'medium',
              supportedValues: [
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ],
            },
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
            codexWarnings: ['Codex warning'],
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

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await ensureAgentFlagsPanelExpanded(user);
    expect(screen.getByTestId('codex-warnings-banner')).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /sandbox mode/i }),
    ).toBeInTheDocument();

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await user.click(providerSelect);
    await user.click(
      await screen.findByRole('option', { name: /^GitHub Copilot$/i }),
    );
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

    expect(
      screen.queryByRole('button', { name: /re-authenticate/i }),
    ).toBeNull();
    expect(
      screen.queryByTestId('codex-warnings-banner'),
    ).not.toBeInTheDocument();
    await ensureAgentFlagsPanelExpanded(user);
    await waitFor(() =>
      expect(
        screen.queryByRole('combobox', { name: /sandbox mode/i }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: /reasoning effort/i }),
      ).toHaveTextContent(/medium/i),
    );
    await waitFor(() =>
      expect(screen.getByTestId('tool-access-select')).toHaveTextContent(/on/i),
    );

    await user.click(screen.getByRole('combobox', { name: /provider/i }));
    await user.click(
      await screen.findByRole('option', { name: /^OpenAI Codex$/i }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('provider-select')).toHaveTextContent(
        /OpenAI Codex/i,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('model-select')).toHaveTextContent(
        /gpt-5.1-codex-max/i,
      ),
    );

    expect(
      screen.queryByRole('button', { name: /re-authenticate/i }),
    ).toBeNull();
    await ensureAgentFlagsPanelExpanded(user);
    expect(screen.getByTestId('codex-warnings-banner')).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /sandbox mode/i }),
    ).toHaveTextContent(/workspace write/i);
  }, 10000);

  it('clears hidden Codex draft values immediately when switching to Copilot', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
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
      if (href.includes('/chat/models') && href.includes('provider=copilot')) {
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await ensureAgentFlagsPanelExpanded(user);
    const sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    await user.click(sandboxSelect);
    await user.click(
      await screen.findByRole('option', { name: /danger full access/i }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('sandbox-mode-select')).toHaveTextContent(
        /danger full access/i,
      ),
    );

    await user.click(screen.getByRole('combobox', { name: /provider/i }));
    await user.click(
      await screen.findByRole('option', { name: /^GitHub Copilot$/i }),
    );

    expect(
      screen.queryByRole('combobox', { name: /sandbox mode/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('tool-access-select')).toHaveTextContent(/on/i);

    await user.click(screen.getByRole('combobox', { name: /provider/i }));
    await user.click(
      await screen.findByRole('option', { name: /^OpenAI Codex$/i }),
    );

    await ensureAgentFlagsPanelExpanded(user);
    expect(
      screen.getByRole('combobox', { name: /sandbox mode/i }),
    ).toHaveTextContent(/workspace write/i);
  }, 10000);

  it('keeps Provider/Model selects visible when models are empty', async () => {
    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
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
            models: [],
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

    const banner = await screen.findByText(/no chat-capable models available/i);
    expect(banner).toBeInTheDocument();

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    expect(providerSelect).toBeInTheDocument();

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    expect(modelSelect).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables Model select when provider is unavailable', async () => {
    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
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
            available: false,
            toolsAvailable: false,
            models: [{ key: 'm1', displayName: 'Model 1', type: 'gguf' }],
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

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    expect(modelSelect).toHaveAttribute('aria-disabled', 'true');
  });

  it('reuses Codex threadId from WS turn_final on subsequent turns', async () => {
    const bodies: Record<string, unknown>[] = [];

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
        if (href.includes('/conversations') && opts?.method !== 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [], nextCursor: null }),
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
        if (href.includes('/chat/models')) {
          const providerParam = new URL(
            href,
            'http://localhost',
          ).searchParams.get('provider');
          if (providerParam === 'codex') {
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
        if (href.includes('/chat') && opts?.method === 'POST') {
          const body =
            opts?.body && typeof opts.body === 'string'
              ? JSON.parse(opts.body)
              : {};
          bodies.push(body);
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

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await userEvent.click(providerSelect);
    const codexOption = await screen.findByRole('option', {
      name: /openai codex/i,
    });
    await userEvent.click(codexOption);

    const input = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send');

    await userEvent.type(input, 'First');
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]).not.toHaveProperty('threadId');

    const conversationId = bodies[0].conversationId as string;

    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { last: () => { _receive: (d: unknown) => void } | null };
      }
    ).__wsMock;
    const ws = wsRegistry?.last();
    expect(ws).toBeTruthy();

    ws!._receive({
      protocolVersion: 'v1',
      type: 'turn_final',
      conversationId,
      seq: 1,
      inflightId: 'i1',
      status: 'ok',
      threadId: 't1',
    });

    await userEvent.clear(input);
    await userEvent.type(input, 'Second');
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(bodies.length).toBe(2));
    expect(bodies[1].threadId).toBe('t1');
  });
});
