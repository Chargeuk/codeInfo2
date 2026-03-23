import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
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
const { default: AgentsPage } = await import('../pages/AgentsPage');
const { default: HomePage } = await import('../pages/HomePage');

const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'agents', element: <AgentsPage /> },
    ],
  },
];

describe('Agents page auth dialog', () => {
  it('opens the shared dialog from the agents page while agent execution stays Codex-backed', async () => {
    const user = userEvent.setup();
    let runCalls = 0;

    mockFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
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
                id: 'copilot',
                label: 'GitHub Copilot',
                available: false,
                toolsAvailable: false,
                reason: 'GitHub login required',
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
      if (href.includes('/chat/models')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'codex',
            available: true,
            toolsAvailable: true,
            models: [{ key: 'model', displayName: 'Model', type: 'codex' }],
          }),
        }) as unknown as Response;
      }
      if (
        href.includes('/agents') &&
        !href.includes('/commands') &&
        !href.includes('/run')
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ agents: [{ name: 'a1' }] }),
        }) as unknown as Response;
      }
      if (href.includes('/agents/') && href.includes('/commands')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ commands: [] }),
        }) as unknown as Response;
      }
      if (href.includes('/conversations')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], nextCursor: null }),
        }) as unknown as Response;
      }
      if (href.includes('/agents/a1/run')) {
        runCalls += 1;
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({ status: 'started' }),
        }) as unknown as Response;
      }
      if (href.endsWith('/copilot/device-auth')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            provider: 'copilot',
            state: 'already_authenticated',
          }),
        }) as unknown as Response;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as unknown as Response;
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await user.click(
      await screen.findByRole('button', {
        name: /re-authenticate \(device auth\)/i,
      }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Choose Authentication' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Codex Auth' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copilot Auth' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copilot Auth' }));

    expect(
      await screen.findByText(
        'GitHub Copilot is already authenticated for this runtime.',
      ),
    ).toBeInTheDocument();
    expect(runCalls).toBe(0);
  });
});
