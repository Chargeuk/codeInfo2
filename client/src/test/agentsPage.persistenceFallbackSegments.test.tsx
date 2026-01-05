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

describe('Agents page - WS unavailable fallback', () => {
  it('renders REST segments for single-instruction runs when realtime is disabled', async () => {
    const user = userEvent.setup();
    const runBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ mongoConnected: false }),
          } as Response);
        }

        if (
          target.includes('/agents') &&
          !target.includes('/commands') &&
          !target.includes('/run')
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'coding_agent' }] }),
          } as Response);
        }

        if (target.includes('/agents/coding_agent/commands')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ commands: [] }),
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
          const body =
            typeof init?.body === 'string'
              ? (JSON.parse(init.body) as Record<string, unknown>)
              : {};
          runBodies.push(body);
          const conversationId =
            typeof body.conversationId === 'string' && body.conversationId
              ? body.conversationId
              : 'c1';
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              agentName: 'coding_agent',
              conversationId,
              modelId: 'gpt-5.1-codex-max',
              segments: [{ type: 'answer', text: 'SEGMENT_FALLBACK_OK' }],
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

    const agentSelect = await screen.findByRole('combobox', {
      name: /agent/i,
    });
    await waitFor(() => expect(agentSelect).toHaveTextContent('coding_agent'));

    const input = await screen.findByTestId('agent-input');
    await user.type(input, 'Question');

    await waitFor(() => expect(screen.getByTestId('agent-send')).toBeEnabled());

    await act(async () => {
      await user.click(screen.getByTestId('agent-send'));
    });

    await screen.findByText('SEGMENT_FALLBACK_OK');
    await waitFor(() => expect(runBodies.length).toBe(1));
    expect(typeof runBodies[0].conversationId).toBe('string');
    expect((runBodies[0].conversationId as string).length).toBeGreaterThan(0);
  });
});
