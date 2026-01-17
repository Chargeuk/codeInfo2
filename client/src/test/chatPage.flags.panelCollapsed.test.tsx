import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

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

function mockCodexReady() {
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

async function selectProvider(optionName: RegExp) {
  const providerSelect = await screen.findByRole('combobox', {
    name: /provider/i,
  });
  await userEvent.click(providerSelect);
  const option = await screen.findByRole('option', {
    name: optionName,
  });
  await userEvent.click(option);
}

describe('Codex flags panel collapsed defaults', () => {
  it('is collapsed by default and expands on click', async () => {
    mockCodexReady();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await selectProvider(/openai codex/i);

    const summaryButton = await screen.findByRole('button', {
      name: /codex flags/i,
    });
    expect(summaryButton).toHaveAttribute('aria-expanded', 'false');

    expect(
      screen.queryByRole('combobox', { name: /sandbox mode/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(summaryButton);
    await waitFor(() =>
      expect(summaryButton).toHaveAttribute('aria-expanded', 'true'),
    );

    const sandboxSelect = await screen.findByRole('combobox', {
      name: /sandbox mode/i,
    });
    await waitFor(() =>
      expect(sandboxSelect).toHaveTextContent(/workspace write/i),
    );
  });

  it('reverts to collapsed after switching providers away and back', async () => {
    mockCodexReady();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await selectProvider(/openai codex/i);

    const summaryButton = await screen.findByRole('button', {
      name: /codex flags/i,
    });
    await userEvent.click(summaryButton);
    await waitFor(() =>
      expect(summaryButton).toHaveAttribute('aria-expanded', 'true'),
    );

    await selectProvider(/lm studio/i);
    await selectProvider(/openai codex/i);

    const newSummaryButton = await screen.findByRole('button', {
      name: /codex flags/i,
    });
    expect(newSummaryButton).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('combobox', { name: /sandbox mode/i }),
    ).not.toBeInTheDocument();
  });
});
