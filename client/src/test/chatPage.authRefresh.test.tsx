import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
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

const installChatFetchMocks = () => {
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
              available: false,
              toolsAvailable: false,
              reason: 'Missing auth.json in /app/codex',
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          provider,
          available: provider !== 'codex',
          toolsAvailable: provider !== 'codex',
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
};

describe('Chat page auth refresh', () => {
  it('does not show re-authenticate on the chat page even when Codex is unavailable', async () => {
    installChatFetchMocks();

    const router = createMemoryRouter(routes, { initialEntries: ['/chat'] });
    render(<RouterProvider router={router} />);

    await screen.findByRole('combobox', { name: /provider/i });
    expect(
      screen.queryByRole('button', { name: /re-authenticate/i }),
    ).toBeNull();
  });
});
