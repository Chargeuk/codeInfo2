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
            status: 202,
            json: async () => ({
              status: 'started',
              agentName: 'coding_agent',
              conversationId: 'c1',
              inflightId: 'i1',
              modelId: 'gpt-5.1-codex-max',
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

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

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

  it('allows switching conversations and editing input during an active run while execute remains disabled', async () => {
    const user = userEvent.setup();
    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: {
          instances: Array<{ sent: string[]; _receive: (d: unknown) => void }>;
          last: () => { _receive: (d: unknown) => void } | null;
        };
      }
    ).__wsMock;

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        void init;
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

        if (target.includes('/agents/coding_agent/commands')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              commands: [
                {
                  name: 'improve_plan',
                  description: 'Improve',
                  disabled: false,
                },
              ],
            }),
          } as Response);
        }

        if (target.includes('/conversations/') && target.includes('/turns')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [], inflight: null }),
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
                      title: 'First',
                      provider: 'codex',
                      model: 'gpt',
                      lastMessageAt: '2025-01-01T00:00:00.000Z',
                    },
                    {
                      conversationId: 'c2',
                      title: 'Second',
                      provider: 'codex',
                      model: 'gpt',
                      lastMessageAt: '2025-01-01T00:00:01.000Z',
                    },
                  ]
                : [],
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

    await waitFor(() => {
      expect(wsRegistry?.instances?.length).toBeGreaterThan(0);
    });

    const initialRows = await screen.findAllByTestId('conversation-row');
    await act(async () => {
      await user.click(initialRows[0]);
    });

    const ws = wsRegistry?.last();
    if (!ws) {
      throw new Error('missing WS instance after mount');
    }
    const subscribeMessage = wsRegistry?.instances
      ?.flatMap((instance) => instance.sent)
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return {};
        }
      })
      .find((message) => message.type === 'subscribe_conversation');
    const activeConversationId =
      subscribeMessage && typeof subscribeMessage.conversationId === 'string'
        ? subscribeMessage.conversationId
        : 'c1';

    act(() => {
      ws._receive({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId: activeConversationId,
        seq: 1,
        inflight: {
          inflightId: 'i1',
          assistantText: '',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      });
    });

    const input = await screen.findByTestId('agent-input');
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, 'draft text');
    expect(input).toHaveValue('draft text');

    act(() => {
      ws._receive({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId: activeConversationId,
        seq: 2,
        inflightId: 'i1',
        delta: 'Working',
      });
    });
    expect(input).toHaveValue('draft text');

    const executeButton = screen.getByTestId('agent-command-execute');
    expect(executeButton).toBeDisabled();
    expect(screen.queryByTestId('agent-send')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-stop')).toBeInTheDocument();

    const refreshedRows = await screen.findAllByTestId('conversation-row');
    await act(async () => {
      await user.click(refreshedRows[1]);
    });

    await waitFor(() => {
      const subscribeIds =
        wsRegistry?.instances
          ?.flatMap((instance) => instance.sent)
          .map((entry) => {
            try {
              return JSON.parse(entry) as Record<string, unknown>;
            } catch {
              return {};
            }
          })
          .filter((message) => message.type === 'subscribe_conversation')
          .map((message) =>
            typeof message.conversationId === 'string'
              ? message.conversationId
              : '',
          ) ?? [];
      expect(new Set(subscribeIds).size).toBeGreaterThan(1);
    });

    const sent = wsRegistry?.instances
      ?.flatMap((instance) => instance.sent)
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return {};
        }
      });
    expect(sent?.some((message) => message.type === 'cancel_inflight')).toBe(
      false,
    );
  });
});
