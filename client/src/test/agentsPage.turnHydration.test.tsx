import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
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

describe('Agents page - turn hydration', () => {
  it('hydrates and renders stored turns when selecting a conversation', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        } as Response);
      }

      if (target.includes('/agents') && !target.includes('/run')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ agents: [{ name: 'coding_agent' }] }),
        } as Response);
      }

      if (target.includes('/conversations') && !target.includes('/turns')) {
        const hasAgentParam = target.includes('agentName=coding_agent');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: hasAgentParam
              ? [
                  {
                    conversationId: 'c1',
                    title: 'T',
                    provider: 'codex',
                    model: 'gpt',
                    lastMessageAt: '2025-01-01T00:00:00.000Z',
                  },
                ]
              : [],
          }),
        } as Response);
      }

      if (target.includes('/conversations/c1/turns')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                conversationId: 'c1',
                role: 'assistant',
                content: 'Saved answer',
                model: 'gpt-5.1-codex-max',
                provider: 'codex',
                status: 'ok',
                createdAt: '2025-01-01T00:00:02.000Z',
              },
              {
                conversationId: 'c1',
                role: 'user',
                content: 'Saved question',
                model: 'gpt-5.1-codex-max',
                provider: 'codex',
                status: 'ok',
                createdAt: '2025-01-01T00:00:01.000Z',
              },
            ],
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const row = await screen.findByTestId('conversation-row');
    await act(async () => {
      await userEvent.click(row);
    });

    await waitFor(() =>
      expect(screen.getByText('Saved question')).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText('Saved answer')).toBeInTheDocument(),
    );
  });
});
