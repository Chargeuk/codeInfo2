import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ensureCodexFlagsPanelExpanded } from './support/ensureCodexFlagsPanelExpanded';
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

  it('surfaces an error alert when fetch fails', async () => {
    mockFetch.mockImplementation(() => {
      throw new Error('network down');
    });

    const router = createMemoryRouter(routes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    const select = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => expect(select).toHaveTextContent('Mock Chat Model'));
  });

  it('renders capability-driven reasoning options for Codex defaults', async () => {
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
                key: 'gpt-5.2-codex',
                displayName: 'gpt-5.2-codex',
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

    await ensureCodexFlagsPanelExpanded();
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
    expect(screen.queryByRole('option', { name: /xhigh/i })).toBeNull();
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

    await ensureCodexFlagsPanelExpanded();
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
});
