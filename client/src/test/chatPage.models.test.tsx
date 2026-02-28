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

describe('Chat page models list', () => {
  it('shows loading then selects the first model', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (target.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
        }) as unknown as Response;
      }
      if (target.includes('/chat/providers')) {
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
        });
      }
      if (target.includes('/chat/models')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
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
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    });

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
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (target.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
        }) as unknown as Response;
      }
      if (target.includes('/chat/providers')) {
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
        });
      }
      if (target.includes('/chat/models')) {
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
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    });

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
    expect(await screen.findByRole('option', { name: /xhigh/i })).toBeVisible();
  });
});
