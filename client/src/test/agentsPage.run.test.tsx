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

describe('Agents page - run', () => {
  it('renders thinking, answer, and a vector summary tool row', async () => {
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
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
          } as Response);
        }

        if (target.includes('/agents/coding_agent/run')) {
          expect(init?.method).toBe('POST');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              agentName: 'coding_agent',
              conversationId: 'c1',
              modelId: 'gpt-5.1-codex-max',
              segments: [
                { type: 'thinking', text: 'thinking...' },
                {
                  type: 'vector_summary',
                  files: [
                    { path: 'repo/a.ts', chunks: 1, match: 0.5, lines: 10 },
                  ],
                },
                { type: 'answer', text: 'Final answer' },
              ],
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

    const input = await screen.findByTestId('agent-input');
    await userEvent.type(input, 'Question');
    await act(async () => {
      await userEvent.click(screen.getByTestId('agent-send'));
    });

    await waitFor(() =>
      expect(screen.getByText('Final answer')).toBeInTheDocument(),
    );
    expect(await screen.findByTestId('think-toggle')).toBeInTheDocument();
    expect(await screen.findByText('vector_summary')).toBeInTheDocument();
    expect(await screen.findByTestId('tool-row')).toBeInTheDocument();
  });
});
