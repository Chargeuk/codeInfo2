import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ensureCodexFlagsPanelExpanded } from './support/ensureCodexFlagsPanelExpanded';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
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

function mockCodexReady(options?: {
  codexDefaults?: typeof defaultCodexDefaults;
  includeDefaults?: boolean;
}) {
  mockFetch.mockImplementation((url: RequestInfo | URL) => {
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
});
