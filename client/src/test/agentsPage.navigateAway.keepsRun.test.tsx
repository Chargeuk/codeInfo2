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

describe('Agents page - navigate away keeps run', () => {
  it('does not send cancel_inflight on navigation and resumes transcript via WS after returning', async () => {
    const user = userEvent.setup();
    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: {
          instances: Array<{ sent: string[]; _receive: (d: unknown) => void }>;
          last: () => { sent: string[]; _receive: (d: unknown) => void } | null;
        };
      }
    ).__wsMock;

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: true }),
        } as Response);
      }

      if (target.endsWith('/agents')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ agents: [{ name: 'a1' }] }),
        } as Response);
      }

      if (target.includes('/agents/a1/commands') && !target.includes('/run')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            commands: [
              { name: 'improve_plan', description: 'Improve', disabled: false },
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
        const hasAgentParam = target.includes('agentName=a1');
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
                    model: 'gpt-5.1-codex-max',
                    lastMessageAt: '2025-01-01T00:00:00.000Z',
                  },
                ]
              : [],
          }),
        } as Response);
      }

      if (target.includes('/agents/a1/commands/run')) {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            status: 'started',
            agentName: 'a1',
            commandName: 'improve_plan',
            conversationId: 'c1',
            modelId: 'gpt-5.1-codex-max',
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

    await waitFor(() => expect(wsRegistry?.last()?.sent).toBeDefined());

    await waitFor(() => {
      expect(wsRegistry?.last && wsRegistry.last()?.readyState).toBe(1);
    });

    // Select conversation c1 (so command run reuses it).
    const row = await screen.findByTestId('conversation-row');
    await act(async () => {
      await user.click(row);
    });

    // Select command.
    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await act(async () => {
      await user.click(commandSelect);
    });
    const option = await screen.findByTestId(
      'agent-command-option-improve_plan',
    );
    await act(async () => {
      await user.click(option);
    });

    await act(async () => {
      await user.click(screen.getByTestId('agent-command-execute'));
    });

    const firstWs = wsRegistry?.instances?.at(-1);
    expect(firstWs).toBeDefined();

    // Navigate away.
    await act(async () => {
      await router.navigate('/');
    });

    // Ensure we didn't send cancel_inflight.
    const sent = (firstWs?.sent ?? []).map((entry) => {
      try {
        return JSON.parse(entry) as Record<string, unknown>;
      } catch {
        return {};
      }
    });

    expect(sent.some((msg) => msg.type === 'cancel_inflight')).toBe(false);

    // Navigate back.
    await act(async () => {
      await router.navigate('/agents');
    });

    const secondRow = await screen.findByTestId('conversation-row');
    await act(async () => {
      await user.click(secondRow);
    });

    const secondWs = wsRegistry?.instances?.at(-1);
    if (!secondWs) throw new Error('missing WS instance after remount');

    // Resume via WS events on the re-mounted page.
    await act(async () => {
      secondWs._receive({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId: 'c1',
        seq: 1,
        inflight: {
          inflightId: 'i1',
          assistantText: '',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      });
      secondWs._receive({
        protocolVersion: 'v1',
        type: 'assistant_delta',
        conversationId: 'c1',
        seq: 2,
        inflightId: 'i1',
        delta: 'Final answer',
      });
      secondWs._receive({
        protocolVersion: 'v1',
        type: 'turn_final',
        conversationId: 'c1',
        seq: 3,
        inflightId: 'i1',
        status: 'ok',
      });
    });

    await screen.findByText('Final answer');
  });
});
