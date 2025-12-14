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

describe('Agents page - conversation selection', () => {
  it('continues the selected conversationId on the next send', async () => {
    const bodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
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

        if (target.includes('/conversations')) {
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

        if (target.includes('/agents/coding_agent/run')) {
          if (init?.body) {
            bodies.push(JSON.parse(init.body.toString()));
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              agentName: 'coding_agent',
              conversationId: 'c1',
              modelId: 'gpt-5.1-codex-max',
              segments: [{ type: 'answer', text: 'ok' }],
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response);
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const row = await screen.findByTestId('conversation-row');
    await act(async () => {
      await userEvent.click(row);
    });

    const input = await screen.findByTestId('agent-input');
    await userEvent.type(input, 'Hello');
    await act(async () => {
      await userEvent.click(screen.getByTestId('agent-send'));
    });

    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    expect(bodies[0]).toMatchObject({ conversationId: 'c1' });
  });
});
