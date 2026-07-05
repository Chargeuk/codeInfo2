import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ensureAgentFlagsPanelExpanded } from './support/ensureAgentFlagsPanelExpanded';
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

function mockProvidersWithBodies(
  chatBodies: Array<Record<string, unknown>>,
  options?: {
    codexDefaults?: Record<string, unknown> | null;
    codexModels?: Array<Record<string, unknown>>;
  },
) {
  const defaultCodexDefaults = {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-failure',
    modelReasoningEffort: 'high',
    networkAccessEnabled: true,
    webSearchEnabled: true,
  };
  const codexDefaults =
    options?.codexDefaults === null
      ? undefined
      : (options?.codexDefaults ?? defaultCodexDefaults);
  const codexModels = options?.codexModels ?? [
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
  ];
  const supportedReasoningValues = Array.from(
    new Set(
      codexModels.flatMap((model) =>
        Array.isArray(model.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts
          : [],
      ),
    ),
  );
  const codexProviderInfo = codexDefaults
    ? {
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
            resolvedDefault: String(
              codexDefaults.sandboxMode ?? 'workspace-write',
            ),
            supportedValues: [
              { value: 'workspace-write', label: 'Workspace write' },
              { value: 'read-only', label: 'Read-only' },
              { value: 'danger-full-access', label: 'Danger full access' },
            ],
          },
          {
            key: 'approvalPolicy',
            label: 'Approval Policy',
            controlType: 'select',
            editable: true,
            seedDefault: 'on-request',
            resolvedDefault:
              codexDefaults.approvalPolicy === 'on-failure'
                ? 'on-request'
                : String(codexDefaults.approvalPolicy ?? 'on-request'),
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
            resolvedDefault: String(
              codexDefaults.modelReasoningEffort ?? 'high',
            ),
            supportedValues:
              supportedReasoningValues.length > 0
                ? supportedReasoningValues.map((value) => ({
                    value,
                    label: value.charAt(0).toUpperCase() + value.slice(1),
                  }))
                : [],
          },
          {
            key: 'networkAccessEnabled',
            label: 'Network Access',
            controlType: 'boolean',
            editable: true,
            seedDefault: true,
            resolvedDefault: Boolean(codexDefaults.networkAccessEnabled),
          },
          {
            key: 'webSearchMode',
            label: 'Web Search',
            controlType: 'select',
            editable: true,
            seedDefault: 'live',
            resolvedDefault:
              codexDefaults.webSearchEnabled === false ? 'disabled' : 'live',
            supportedValues: [
              { value: 'disabled', label: 'Disabled' },
              { value: 'cached', label: 'Cached' },
              { value: 'live', label: 'Live' },
            ],
          },
        ],
      }
    : undefined;
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
      if (href.includes('/chat/models') && href.includes('provider=codex')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'codex',
            available: true,
            toolsAvailable: true,
            ...(codexProviderInfo ? { providerInfo: codexProviderInfo } : {}),
            ...(codexDefaults ? { codexDefaults, codexWarnings: [] } : {}),
            models: codexModels,
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
        if (opts?.body) {
          try {
            chatBodies.push(JSON.parse(opts.body as string));
          } catch {
            chatBodies.push({});
          }
        }

        const body = chatBodies.at(-1) ?? {};
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
}

describe('Codex model reasoning Agent Flag payloads', () => {
  it('renders dynamic reasoning options exactly from selected model capabilities', async () => {
    const chatBodies: Record<string, unknown>[] = [];
    mockProvidersWithBodies(chatBodies);

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

    await ensureAgentFlagsPanelExpanded();
    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });

    await userEvent.click(reasoningSelect);
    const firstModelOptions = await screen.findAllByRole('option');
    expect(
      firstModelOptions.map((option) => option.textContent?.trim()),
    ).toEqual(['High', 'Xhigh']);
    await userEvent.click(screen.getByRole('option', { name: /xhigh/i }));

    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await userEvent.click(modelSelect);
    const gpt52Option = await screen.findByRole('option', { name: /gpt-5.2/i });
    await userEvent.click(gpt52Option);

    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/minimal/i));
    await userEvent.click(reasoningSelect);
    const secondModelOptions = await screen.findAllByRole('option');
    expect(
      secondModelOptions.map((option) => option.textContent?.trim()),
    ).toEqual(['Minimal']);
  });

  it('omits reasoning effort for LM Studio, forwards selected value for Codex, and resets to default', async () => {
    const chatBodies: Record<string, unknown>[] = [];
    mockProvidersWithBodies(chatBodies);

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send');
    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });

    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /^LM Studio$/i }),
    );

    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.clear(input);
    await userEvent.type(input, 'Hello LM');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(1));
    const lmBody = chatBodies[0];
    expect(lmBody.provider).toBe('lmstudio');
    expect(lmBody).not.toHaveProperty('modelReasoningEffort');

    const newConversationButton = screen.getByRole('button', {
      name: /new conversation/i,
    });
    await act(async () => {
      await userEvent.click(newConversationButton);
    });

    await userEvent.click(providerSelect);
    const codexOption = await screen.findByRole('option', {
      name: /openai codex/i,
    });
    await userEvent.click(codexOption);

    await ensureAgentFlagsPanelExpanded();

    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).toHaveTextContent('gpt-5.1-codex-max'),
    );

    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/high/i));
    await userEvent.click(reasoningSelect);
    const xhighOption = await screen.findByRole('option', {
      name: /xhigh/i,
    });
    await userEvent.click(xhighOption);

    await userEvent.clear(input);
    await userEvent.type(input, 'Hello Codex');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(2));
    const codexBody = chatBodies[1];
    expect(codexBody.provider).toBe('codex');
    expect(
      (codexBody.agentFlags as Record<string, unknown>)?.modelReasoningEffort,
    ).toBe('xhigh');

    await act(async () => {
      await userEvent.click(newConversationButton);
    });

    await ensureAgentFlagsPanelExpanded();
    const resetSelect = await screen.findByTestId('reasoning-effort-select');
    await waitFor(() => expect(resetSelect).toHaveTextContent(/high/i));
  }, 30000);

  it('emits only supported reasoning values and falls back to model default before send', async () => {
    const chatBodies: Record<string, unknown>[] = [];
    mockProvidersWithBodies(chatBodies);

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

    await ensureAgentFlagsPanelExpanded();

    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await userEvent.click(reasoningSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /xhigh/i }),
    );

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await userEvent.click(modelSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /gpt-5.2/i }),
    );
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/minimal/i));

    const input = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.clear(input);
    await userEvent.type(input, 'Validate fallback payload');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(1));
    const payload = chatBodies.at(-1) ?? {};
    expect(payload.provider).toBe('codex');
    expect(payload.model).toBe('gpt-5.2');
    expect(
      (payload.agentFlags as Record<string, unknown>)?.modelReasoningEffort,
    ).toBe('minimal');
  }, 30000);

  it('keeps single-option capability models valid for UI and payload', async () => {
    const chatBodies: Record<string, unknown>[] = [];
    mockProvidersWithBodies(chatBodies, {
      codexModels: [
        {
          key: 'gpt-5.2',
          displayName: 'gpt-5.2',
          type: 'codex',
          supportedReasoningEfforts: ['minimal'],
          defaultReasoningEffort: 'minimal',
        },
      ],
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /openai codex/i }),
    );

    await ensureAgentFlagsPanelExpanded();
    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/minimal/i));
    await userEvent.click(reasoningSelect);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'Minimal',
    ]);
    await userEvent.click(options[0]);

    const input = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.clear(input);
    await userEvent.type(input, 'single option send');
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(1));
    expect(
      (
        (chatBodies.at(-1) ?? {}).agentFlags as
          | Record<string, unknown>
          | undefined
      )?.modelReasoningEffort,
    ).toBe('minimal');
  });

  it('keeps same-conversation Agent Flag edits on the current conversation when only reasoning changes', async () => {
    const harness = setupChatWsHarness({
      mockFetch,
      providers: {
        providers: [
          {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
          },
        ],
      },
      models: {
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
        ],
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await ensureAgentFlagsPanelExpanded();

    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).toHaveTextContent(/gpt-5.1-codex-max/i),
    );

    const input = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(input).toBeEnabled());
    input.focus();
    await userEvent.clear(input);
    await userEvent.type(input, 'keep codex running');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() =>
      expect(harness.chatBodies.length).toBeGreaterThanOrEqual(1),
    );
    const firstPayload = harness.chatBodies[0] ?? {};
    const conversationId = harness.getConversationId();
    const inflightId = harness.getInflightId() ?? 'i1';
    expect(conversationId).toBeTruthy();
    harness.emitInflightSnapshot({
      conversationId: conversationId!,
      inflightId,
      assistantText: '',
    });
    harness.emitFinal({
      conversationId: conversationId!,
      inflightId,
      status: 'ok',
    });
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());

    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/high/i));
    await userEvent.click(reasoningSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /xhigh/i }),
    );

    await userEvent.clear(input);
    await userEvent.type(input, 'keep the same conversation');
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    await act(async () => {
      await userEvent.click(screen.getByTestId('chat-send'));
    });

    await waitFor(() =>
      expect(harness.chatBodies.length).toBeGreaterThanOrEqual(2),
    );
    const secondPayload = harness.chatBodies[1] ?? {};
    expect(secondPayload.provider).toBe('codex');
    expect(secondPayload.model).toBe('gpt-5.1-codex-max');
    expect(secondPayload.conversationId).toBe(firstPayload.conversationId);
    expect(
      (secondPayload.agentFlags as Record<string, unknown>)
        ?.modelReasoningEffort,
    ).toBe('xhigh');
  }, 30000);

  it('clears hidden reasoning values from both the control and submitted draft when the selected model narrows support', async () => {
    const chatBodies: Record<string, unknown>[] = [];
    mockProvidersWithBodies(chatBodies);

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /openai codex/i }),
    );

    await ensureAgentFlagsPanelExpanded();

    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await userEvent.click(reasoningSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /xhigh/i }),
    );
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/xhigh/i));

    const modelSelect = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
    await userEvent.click(modelSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /gpt-5.2/i }),
    );

    const narrowedReasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() =>
      expect(narrowedReasoningSelect).toHaveTextContent(/minimal/i),
    );
    await userEvent.click(narrowedReasoningSelect);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    await userEvent.click(
      await screen.findByRole('option', { name: /minimal/i }),
    );
    expect(screen.queryByRole('option', { name: /xhigh/i })).toBeNull();

    const input = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send');
    await waitFor(() => expect(input).toBeEnabled());
    input.focus();
    await userEvent.clear(input);
    await userEvent.type(input, 'submit narrowed reasoning');
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(1));
    const payload = chatBodies.at(-1) ?? {};
    expect(payload.model).toBe('gpt-5.2');
    expect(
      (payload.agentFlags as Record<string, unknown>)?.modelReasoningEffort,
    ).toBe('minimal');
  }, 15000);

  it('sends non-standard runtime reasoning values when model capabilities allow them', async () => {
    const chatBodies: Record<string, unknown>[] = [];
    mockProvidersWithBodies(chatBodies, {
      codexDefaults: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-failure',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: true,
      },
      codexModels: [
        {
          key: 'gpt-5.3-experimental',
          displayName: 'gpt-5.3-experimental',
          type: 'codex',
          supportedReasoningEfforts: ['turbo-max'],
          defaultReasoningEffort: 'turbo-max',
        },
      ],
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /openai codex/i }),
    );

    await ensureAgentFlagsPanelExpanded();
    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() =>
      expect(reasoningSelect).toHaveTextContent(/turbo-max/i),
    );

    const input = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send');
    await userEvent.clear(input);
    await userEvent.type(input, 'non-standard reasoning');
    await waitFor(() => expect(sendButton).toBeEnabled());
    await act(async () => {
      await userEvent.click(sendButton);
    });

    await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(1));
    expect(
      (
        (chatBodies.at(-1) ?? {}).agentFlags as
          | Record<string, unknown>
          | undefined
      )?.modelReasoningEffort,
    ).toBe('turbo-max');
  }, 10000);

  it('logs deterministic T17 error and omits invalid reasoning payload when capabilities are empty', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const chatBodies: Record<string, unknown>[] = [];
    mockProvidersWithBodies(chatBodies, {
      codexDefaults: null,
      codexModels: [
        {
          key: 'broken-codex-model',
          displayName: 'broken-codex-model',
          type: 'codex',
          supportedReasoningEfforts: [],
          defaultReasoningEffort: '',
        },
      ],
    });

    try {
      const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
      render(<RouterProvider router={router} />);

      const providerSelect = await screen.findByRole('combobox', {
        name: /provider/i,
      });
      await userEvent.click(providerSelect);
      await userEvent.click(
        await screen.findByRole('option', { name: /openai codex/i }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: /agent flags/i }),
        ).not.toBeInTheDocument(),
      );

      const input = await screen.findByTestId('chat-input');
      const sendButton = await screen.findByTestId('chat-send');
      await userEvent.clear(input);
      await userEvent.type(input, 'broken capabilities');
      await act(async () => {
        await userEvent.click(sendButton);
      });

      await waitFor(() => expect(chatBodies.length).toBeGreaterThanOrEqual(1));
      const payload = chatBodies.at(-1) ?? {};
      expect(payload.provider).toBe('codex');
      expect(
        (payload.agentFlags as Record<string, unknown> | undefined)
          ?.modelReasoningEffort,
      ).toBeUndefined();
      await waitFor(() =>
        expect(
          errorSpy.mock.calls.some(
            ([message]) =>
              typeof message === 'string' &&
              message.includes('[DEV-0000037][T17]') &&
              message.includes('result=error'),
          ),
        ).toBe(true),
      );
      expect(screen.getByTestId('chat-input')).toBeEnabled();
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
