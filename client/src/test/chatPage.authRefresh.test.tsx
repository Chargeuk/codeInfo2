import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

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

describe('Chat page auth refresh', () => {
  it('refreshes provider readiness and active models after shared auth completes', async () => {
    const user = userEvent.setup();
    let providerCalls = 0;
    const modelProviders: string[] = [];

    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations') && href.includes('pageSize')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
        }) as unknown as Response;
      }
      if (href.includes('/chat/providers')) {
        providerCalls += 1;
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
                reason: 'GitHub login required',
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
        const provider = new URL(href).searchParams.get('provider') ?? 'codex';
        modelProviders.push(provider);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider,
            available: true,
            toolsAvailable: true,
            codexDefaults:
              provider === 'codex'
                ? {
                    sandboxMode: 'workspace-write',
                    approvalPolicy: 'on-failure',
                    modelReasoningEffort: 'high',
                    networkAccessEnabled: true,
                    webSearchEnabled: true,
                  }
                : undefined,
            codexWarnings: [],
            models: [
              {
                key: `${provider}-model`,
                displayName: `${provider} model`,
                type: provider,
              },
            ],
          }),
        }) as unknown as Response;
      }
      if (href.endsWith('/codex/device-auth')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'codex',
            state: 'completed',
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

    await user.click(
      await screen.findByRole('button', {
        name: /re-authenticate \(device auth\)/i,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Codex Auth' }));

    expect(
      await screen.findByText('OpenAI Codex authentication completed.'),
    ).toBeInTheDocument();

    await waitFor(() => expect(providerCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(
        modelProviders.filter((provider) => provider === 'codex').length,
      ).toBeGreaterThanOrEqual(2),
    );
  });
});
