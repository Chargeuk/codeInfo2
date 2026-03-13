import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ensureCodexFlagsPanelExpanded } from './support/ensureCodexFlagsPanelExpanded';

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

// Intentionally not matching server defaults to prove the UI uses the server response.
const defaultCodexDefaults = {
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  modelReasoningEffort: 'medium',
  networkAccessEnabled: false,
  webSearchEnabled: false,
} as const;

const defaultCodexModels = [
  {
    key: 'gpt-5.1-codex-max',
    displayName: 'gpt-5.1-codex-max',
    type: 'codex',
    supportedReasoningEfforts: ['minimal', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
  },
] satisfies Array<Record<string, unknown>>;

function mockCodexReady(options?: {
  codexDefaults?: typeof defaultCodexDefaults;
  includeDefaults?: boolean;
  codexModels?: Array<Record<string, unknown>>;
}) {
  const codexModels = options?.codexModels ?? defaultCodexModels;
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
      const includeDefaults = options?.includeDefaults ?? true;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          ...(includeDefaults
            ? {
                codexDefaults: options?.codexDefaults ?? defaultCodexDefaults,
                codexWarnings: [],
              }
            : {}),
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
    if (href.includes('/chat')) {
      return Promise.resolve({
        ok: true,
        status: 202,
        json: async () => ({
          status: 'started',
          conversationId: 'draft-conversation',
          inflightId: 'draft-inflight',
          provider: 'lmstudio',
          model: 'lm',
        }),
      }) as unknown as Response;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as unknown as Response;
  });
}

describe('Codex defaults from server', () => {
  it('initializes Codex flags from codexDefaults', async () => {
    mockCodexReady();

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

    await ensureCodexFlagsPanelExpanded();

    const sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    const approvalSelect = await screen.findByRole('combobox', {
      name: /approval policy/i,
    });
    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    const networkSwitch = await screen.findByTestId('network-access-switch');
    const webSearchSwitch = await screen.findByTestId('web-search-switch');

    await waitFor(() => expect(sandboxSelect).toHaveTextContent(/read-only/i));
    await waitFor(() => expect(approvalSelect).toHaveTextContent(/never/i));
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/medium/i));
    expect(networkSwitch).not.toBeChecked();
    expect(webSearchSwitch).not.toBeChecked();
  });

  it('re-applies defaults when switching providers', async () => {
    mockCodexReady();

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

    await ensureCodexFlagsPanelExpanded();

    const sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    await userEvent.click(sandboxSelect);
    const dangerOption = await screen.findByRole('option', {
      name: /danger full access/i,
    });
    await userEvent.click(dangerOption);
    await waitFor(() =>
      expect(sandboxSelect).toHaveTextContent(/danger full access/i),
    );

    await userEvent.click(providerSelect);
    const lmOption = await screen.findByRole('option', { name: /lm studio/i });
    await userEvent.click(lmOption);

    await userEvent.click(providerSelect);
    const codexReturn = await screen.findByRole('option', {
      name: /openai codex/i,
    });
    await userEvent.click(codexReturn);

    await ensureCodexFlagsPanelExpanded();

    const sandboxSelectAfterSwitch = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    await waitFor(() =>
      expect(sandboxSelectAfterSwitch).toHaveTextContent(/read-only/i),
    );
  });

  it('re-applies defaults when starting a new conversation', async () => {
    mockCodexReady();

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

    await ensureCodexFlagsPanelExpanded();

    const sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    await userEvent.click(sandboxSelect);
    const dangerOption = await screen.findByRole('option', {
      name: /danger full access/i,
    });
    await userEvent.click(dangerOption);
    await waitFor(() =>
      expect(sandboxSelect).toHaveTextContent(/danger full access/i),
    );

    const newConversationButton = screen.getByRole('button', {
      name: /new conversation/i,
    });
    await act(async () => {
      await userEvent.click(newConversationButton);
    });

    await ensureCodexFlagsPanelExpanded();

    const sandboxSelectAfterReset = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    await waitFor(() =>
      expect(sandboxSelectAfterReset).toHaveTextContent(/read-only/i),
    );
  });

  it('applies Codex defaults when switching providers during an active run', async () => {
    mockCodexReady();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const input = await screen.findByTestId('chat-input');
    await userEvent.type(input, 'keep lmstudio running');
    await act(async () => {
      await userEvent.click(screen.getByTestId('chat-send'));
    });

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await userEvent.click(providerSelect);
    const codexOption = await screen.findByRole('option', {
      name: /openai codex/i,
    });
    await userEvent.click(codexOption);

    await ensureCodexFlagsPanelExpanded();

    const sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    const approvalSelect = await screen.findByRole('combobox', {
      name: /approval policy/i,
    });
    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    const networkSwitch = await screen.findByTestId('network-access-switch');
    const webSearchSwitch = await screen.findByTestId('web-search-switch');

    await waitFor(() => expect(sandboxSelect).toHaveTextContent(/read-only/i));
    await waitFor(() => expect(approvalSelect).toHaveTextContent(/never/i));
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/medium/i));
    expect(networkSwitch).not.toBeChecked();
    expect(webSearchSwitch).not.toBeChecked();
  });

  it('disables Codex flags when defaults are missing', async () => {
    mockCodexReady({ includeDefaults: false });

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

    await ensureCodexFlagsPanelExpanded();

    const sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    const networkSwitch = await screen.findByTestId('network-access-switch');

    expect(sandboxSelect).toHaveAttribute('aria-disabled', 'true');
    expect(networkSwitch).toBeDisabled();
  });

  it('resets invalid reasoning effort when switching models', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCodexReady({
      codexModels: [
        {
          key: 'model-a',
          displayName: 'Model A',
          type: 'codex',
          supportedReasoningEfforts: ['high', 'xhigh'],
          defaultReasoningEffort: 'high',
        },
        {
          key: 'model-b',
          displayName: 'Model B',
          type: 'codex',
          supportedReasoningEfforts: ['minimal'],
          defaultReasoningEffort: 'minimal',
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
      await ensureCodexFlagsPanelExpanded();

      const modelSelect = await screen.findByRole('combobox', {
        name: /model/i,
      });
      await userEvent.click(modelSelect);
      await userEvent.click(
        await screen.findByRole('option', { name: /model b/i }),
      );

      await waitFor(() =>
        expect(screen.getByTestId('reasoning-effort-select')).toHaveTextContent(
          /minimal/i,
        ),
      );
      expect(
        infoSpy.mock.calls.some(
          ([message]) =>
            message ===
            '[DEV-0000037][T16] event=chat_model_capability_defaults_applied result=success',
        ),
      ).toBe(true);
      expect(
        errorSpy.mock.calls.some(
          ([message]) =>
            typeof message === 'string' &&
            message.includes('[DEV-0000037][T16]') &&
            message.includes('result=error'),
        ),
      ).toBe(false);
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('resets invalid reasoning effort after capability payload refresh', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    let codexModelsRequestCount = 0;

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
        codexModelsRequestCount += 1;
        const models =
          codexModelsRequestCount === 1
            ? [
                {
                  key: 'refresh-model',
                  displayName: 'Refresh Model',
                  type: 'codex',
                  supportedReasoningEfforts: ['high', 'xhigh'],
                  defaultReasoningEffort: 'high',
                },
              ]
            : [
                {
                  key: 'refresh-model',
                  displayName: 'Refresh Model',
                  type: 'codex',
                  supportedReasoningEfforts: ['minimal'],
                  defaultReasoningEffort: 'minimal',
                },
              ];
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'codex',
            available: true,
            toolsAvailable: true,
            codexDefaults: {
              sandboxMode: 'read-only',
              approvalPolicy: 'never',
              modelReasoningEffort: 'high',
              networkAccessEnabled: false,
              webSearchEnabled: false,
            },
            codexWarnings: [],
            models,
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
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
      await ensureCodexFlagsPanelExpanded();

      await userEvent.click(providerSelect);
      await userEvent.click(
        await screen.findByRole('option', { name: /lm studio/i }),
      );
      await userEvent.click(providerSelect);
      await userEvent.click(
        await screen.findByRole('option', { name: /openai codex/i }),
      );

      await ensureCodexFlagsPanelExpanded();
      await waitFor(() =>
        expect(screen.getByTestId('reasoning-effort-select')).toHaveTextContent(
          /minimal/i,
        ),
      );
      expect(codexModelsRequestCount).toBeGreaterThanOrEqual(2);
      expect(
        infoSpy.mock.calls.some(
          ([message]) =>
            message ===
            '[DEV-0000037][T16] event=chat_model_capability_defaults_applied result=success',
        ),
      ).toBe(true);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('logs deterministic error for malformed empty supportedReasoningEfforts payload', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCodexReady({
      includeDefaults: false,
      codexModels: [
        {
          key: 'malformed-model',
          displayName: 'Malformed Model',
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
      await ensureCodexFlagsPanelExpanded();

      await waitFor(() =>
        expect(
          errorSpy.mock.calls.some(
            ([message]) =>
              message ===
              '[DEV-0000037][T16] event=chat_model_capability_defaults_applied result=error reason=invalid_model_capabilities model=malformed-model',
          ),
        ).toBe(true),
      );
      expect(screen.getByTestId('chat-input')).toBeEnabled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('falls back deterministically when defaultReasoningEffort is not supported', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    mockCodexReady({
      codexDefaults: {
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        modelReasoningEffort: 'medium',
        networkAccessEnabled: false,
        webSearchEnabled: false,
      },
      codexModels: [
        {
          key: 'mismatched-default',
          displayName: 'Mismatched Default',
          type: 'codex',
          supportedReasoningEfforts: ['low'],
          defaultReasoningEffort: 'medium',
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

      await ensureCodexFlagsPanelExpanded();
      await waitFor(() =>
        expect(screen.getByTestId('reasoning-effort-select')).toHaveTextContent(
          /low/i,
        ),
      );
      expect(
        infoSpy.mock.calls.some(
          ([message]) =>
            message ===
            '[DEV-0000037][T16] event=chat_model_capability_defaults_applied result=success',
        ),
      ).toBe(true);
    } finally {
      infoSpy.mockRestore();
    }
  });
});
