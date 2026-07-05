import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ensureAgentFlagsPanelExpanded } from './support/ensureAgentFlagsPanelExpanded';
import { waitForInteractiveCombobox } from './support/waitForInteractiveCombobox';

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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          provider: 'codex',
          available: true,
          toolsAvailable: true,
          codexDefaults: options?.codexDefaults ?? defaultCodexDefaults,
          codexWarnings: [],
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

describe('Chat page resolved defaults from combined payload', () => {
  it('shows config-resolved defaults instead of seed defaults when both are present', async () => {
    mockCodexReady();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await waitForInteractiveCombobox(providerSelect);
    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /openai codex/i }),
    );

    await ensureAgentFlagsPanelExpanded();

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

  it('re-applies resolved defaults when switching providers', async () => {
    mockCodexReady();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await waitForInteractiveCombobox(providerSelect);
    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /openai codex/i }),
    );

    await ensureAgentFlagsPanelExpanded();

    let sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    await userEvent.click(sandboxSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /danger full access/i }),
    );
    await waitFor(() =>
      expect(sandboxSelect).toHaveTextContent(/danger full access/i),
    );

    await waitForInteractiveCombobox(providerSelect);
    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /^LM Studio$/i }),
    );

    await waitForInteractiveCombobox(providerSelect);
    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /openai codex/i }),
    );

    await ensureAgentFlagsPanelExpanded();
    sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    await waitFor(() => expect(sandboxSelect).toHaveTextContent(/read-only/i));
  });

  it('re-applies resolved defaults when starting a new conversation', async () => {
    mockCodexReady();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    const providerSelect = await screen.findByRole('combobox', {
      name: /provider/i,
    });
    await waitForInteractiveCombobox(providerSelect);
    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /openai codex/i }),
    );

    await ensureAgentFlagsPanelExpanded();

    const sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    await userEvent.click(sandboxSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /danger full access/i }),
    );
    await waitFor(() =>
      expect(sandboxSelect).toHaveTextContent(/danger full access/i),
    );

    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: /new conversation/i }),
      );
    });

    await ensureAgentFlagsPanelExpanded();
    await waitFor(() => expect(sandboxSelect).toHaveTextContent(/read-only/i));
  });

  it('re-applies resolved defaults when switching providers during an active run', async () => {
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
    await waitForInteractiveCombobox(providerSelect);
    await userEvent.click(providerSelect);
    await userEvent.click(
      await screen.findByRole('option', { name: /openai codex/i }),
    );

    await ensureAgentFlagsPanelExpanded();

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
});
