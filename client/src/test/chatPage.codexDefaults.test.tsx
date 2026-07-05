import type { CodexDefaults } from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
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
const defaultCodexDefaults: CodexDefaults = {
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  modelReasoningEffort: 'medium',
  networkAccessEnabled: false,
  webSearchEnabled: false,
};

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
  codexDefaults?: CodexDefaults;
  compatibilityCodexDefaults?: CodexDefaults;
  compatibilityCodexWarnings?: string[];
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
          ...(options?.compatibilityCodexDefaults ||
          options?.compatibilityCodexWarnings
            ? {
                compatibility: {
                  ...(options?.compatibilityCodexDefaults
                    ? {
                        codexDefaults: options.compatibilityCodexDefaults,
                      }
                    : {}),
                  ...(options?.compatibilityCodexWarnings
                    ? {
                        codexWarnings: options.compatibilityCodexWarnings,
                      }
                    : {}),
                },
              }
            : {}),
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

describe('Codex compatibility defaults behavior', () => {
  it('prefers canonical compatibility defaults over stale legacy top-level Codex fields', async () => {
    mockCodexReady({
      codexDefaults: defaultCodexDefaults,
      compatibilityCodexDefaults: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: true,
      },
      codexModels: [
        {
          key: 'compatibility-model',
          displayName: 'Compatibility Model',
          type: 'codex',
          supportedReasoningEfforts: ['medium', 'high'],
          defaultReasoningEffort: '',
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

    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: /sandbox mode/i }),
      ).toHaveTextContent(/workspace write/i),
    );
    expect(
      screen.getByRole('combobox', { name: /approval policy/i }),
    ).toHaveTextContent(/on request/i);
    expect(screen.getByTestId('reasoning-effort-select')).toHaveTextContent(
      /high/i,
    );
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

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /agent flags/i }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('combobox', { name: /sandbox mode/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('network-access-switch')).toBeNull();
  });

  it('resets invalid reasoning effort when switching models', async () => {
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
      await ensureAgentFlagsPanelExpanded();

      const modelSelect = await screen.findByRole('combobox', {
        name: /model/i,
      });
      await waitFor(() =>
        expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
      );
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
        errorSpy.mock.calls.some(
          ([message]) =>
            typeof message === 'string' &&
            message.includes('[DEV-0000037][T16]') &&
            message.includes('result=error'),
        ),
      ).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('preserves Codex defaults behavior when changing the next-send model during an active run', async () => {
    mockCodexReady({
      codexModels: [
        {
          key: 'model-a',
          displayName: 'Model A',
          type: 'codex',
          supportedReasoningEfforts: ['medium', 'high'],
          defaultReasoningEffort: 'medium',
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

    const input = await screen.findByTestId('chat-input');
    await userEvent.type(input, 'keep the first model running');
    await act(async () => {
      await userEvent.click(screen.getByTestId('chat-send'));
    });

    const sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    const approvalSelect = await screen.findByRole('combobox', {
      name: /approval policy/i,
    });
    const modelSelect = await screen.findByRole('combobox', {
      name: /model/i,
    });
    await waitFor(() =>
      expect(modelSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );

    await waitFor(() => expect(sandboxSelect).toHaveTextContent(/read-only/i));
    await waitFor(() => expect(approvalSelect).toHaveTextContent(/never/i));

    await userEvent.click(modelSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /model b/i }),
    );

    const reasoningSelect = await screen.findByRole('combobox', {
      name: /reasoning effort/i,
    });
    await waitFor(() => expect(reasoningSelect).toHaveTextContent(/minimal/i));
    expect(sandboxSelect).toHaveTextContent(/read-only/i);
    expect(approvalSelect).toHaveTextContent(/never/i);
  }, 15000);

  it('resets invalid reasoning effort after capability payload refresh', async () => {
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

    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /^LM Studio$/i }),
    );
    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /openai codex/i }),
    );

    await ensureAgentFlagsPanelExpanded();
    await waitFor(() =>
      expect(screen.getByTestId('reasoning-effort-select')).toHaveTextContent(
        /minimal/i,
      ),
    );
    expect(codexModelsRequestCount).toBeGreaterThanOrEqual(2);
  }, 15000);

  it('logs deterministic error for malformed empty supportedReasoningEfforts payload', async () => {
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

    expect(screen.getByTestId('chat-input')).toBeEnabled();
  });

  it('falls back deterministically when defaultReasoningEffort is not supported', async () => {
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
    await waitFor(() =>
      expect(screen.getByTestId('reasoning-effort-select')).toHaveTextContent(
        /low/i,
      ),
    );
  });
});
