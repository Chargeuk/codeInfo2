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

describe('Agents page - abort command execute', () => {
  it('Stop aborts an in-flight command execute request', async () => {
    let capturedSignal: AbortSignal | undefined;
    const user = userEvent.setup();

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

        if (target.includes('/agents') && !target.includes('/commands')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'a1' }] }),
          } as Response);
        }

        if (target.includes('/agents/a1/commands/run')) {
          capturedSignal = init?.signal as AbortSignal | undefined;
          return new Promise((_resolve, reject) => {
            const rejectAbort = () => {
              const err = new Error('aborted');
              (err as Error & { name: string }).name = 'AbortError';
              reject(err);
            };
            if (capturedSignal?.aborted) {
              rejectAbort();
              return;
            }
            capturedSignal?.addEventListener('abort', rejectAbort, {
              once: true,
            });
          });
        }

        if (target.includes('/agents/a1/commands')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              commands: [
                {
                  name: 'improve_plan',
                  description: 'd',
                  disabled: false,
                },
              ],
            }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
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

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);
    const option = await screen.findByTestId(
      'agent-command-option-improve_plan',
    );
    await user.click(option);

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(
        screen.queryByTestId('agent-command-option-improve_plan'),
      ).toBeNull(),
    );

    await waitFor(() =>
      expect(screen.getByTestId('agent-command-description')).toHaveTextContent(
        'd',
      ),
    );

    const execute = await screen.findByTestId('agent-command-execute');
    await waitFor(() => expect(execute).toBeEnabled());
    await user.click(execute);

    await waitFor(() => expect(capturedSignal).toBeDefined());

    await waitFor(() => expect(screen.getByTestId('agent-stop')).toBeEnabled());
    await user.click(screen.getByTestId('agent-stop'));

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
  });

  it('Stop sends WS cancel_inflight when inflight id is known', async () => {
    let capturedSignal: AbortSignal | undefined;
    const user = userEvent.setup();
    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: {
          instances: Array<{ sent: string[]; _receive: (d: unknown) => void }>;
        };
      }
    ).__wsMock;

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

        if (target.includes('/agents') && !target.includes('/commands')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'a1' }] }),
          } as Response);
        }

        if (target.includes('/agents/a1/commands/run')) {
          capturedSignal = init?.signal as AbortSignal | undefined;
          return new Promise((_resolve, reject) => {
            const rejectAbort = () => {
              const err = new Error('aborted');
              (err as Error & { name: string }).name = 'AbortError';
              reject(err);
            };
            if (capturedSignal?.aborted) {
              rejectAbort();
              return;
            }
            capturedSignal?.addEventListener('abort', rejectAbort, {
              once: true,
            });
          });
        }

        if (target.includes('/agents/a1/commands')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              commands: [
                {
                  name: 'improve_plan',
                  description: 'd',
                  disabled: false,
                },
              ],
            }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
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

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);
    const option = await screen.findByTestId(
      'agent-command-option-improve_plan',
    );
    await user.click(option);
    await user.keyboard('{Escape}');

    const execute = await screen.findByTestId('agent-command-execute');
    await waitFor(() => expect(execute).toBeEnabled());
    await user.click(execute);

    await waitFor(() => expect(capturedSignal).toBeDefined());
    await waitFor(() => expect(screen.getByTestId('agent-stop')).toBeEnabled());

    const ws = wsRegistry?.instances?.at(-1);
    expect(ws).toBeDefined();

    const parseSent = (entries: string[]) =>
      entries.map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return {};
        }
      });

    const sent = parseSent(ws?.sent ?? []);
    const subscribeMsg = sent.find(
      (msg) => msg.type === 'subscribe_conversation',
    );
    const conversationId =
      subscribeMsg && typeof subscribeMsg.conversationId === 'string'
        ? subscribeMsg.conversationId
        : '';
    expect(conversationId).toBeTruthy();
    const inflightId = 'i1';

    await act(async () => {
      ws?._receive({
        protocolVersion: 'v1',
        type: 'inflight_snapshot',
        conversationId,
        seq: 1,
        inflight: {
          inflightId,
          assistantText: '',
          assistantThink: '',
          toolEvents: [],
          startedAt: '2025-01-01T00:00:00.000Z',
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('status-chip')).toHaveTextContent('Processing'),
    );

    await user.click(screen.getByTestId('agent-stop'));

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));

    const nextSent = parseSent(ws?.sent ?? []);
    expect(
      nextSent.some(
        (msg) =>
          msg.type === 'cancel_inflight' &&
          msg.conversationId === conversationId &&
          msg.inflightId === inflightId,
      ),
    ).toBe(true);
  });

  it('Stop before inflight id is known does not send WS cancel_inflight (but aborts HTTP)', async () => {
    let capturedSignal: AbortSignal | undefined;
    const user = userEvent.setup();
    const wsRegistry = (
      globalThis as unknown as {
        __wsMock?: { instances: Array<{ sent: string[] }> };
      }
    ).__wsMock;

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

        if (target.includes('/agents') && !target.includes('/commands')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ agents: [{ name: 'a1' }] }),
          } as Response);
        }

        if (target.includes('/agents/a1/commands/run')) {
          capturedSignal = init?.signal as AbortSignal | undefined;
          return new Promise((_resolve, reject) => {
            const rejectAbort = () => {
              const err = new Error('aborted');
              (err as Error & { name: string }).name = 'AbortError';
              reject(err);
            };
            if (capturedSignal?.aborted) {
              rejectAbort();
              return;
            }
            capturedSignal?.addEventListener('abort', rejectAbort, {
              once: true,
            });
          });
        }

        if (target.includes('/agents/a1/commands')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              commands: [
                {
                  name: 'improve_plan',
                  description: 'd',
                  disabled: false,
                },
              ],
            }),
          } as Response);
        }

        if (target.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
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

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);
    const option = await screen.findByTestId(
      'agent-command-option-improve_plan',
    );
    await user.click(option);
    await user.keyboard('{Escape}');

    const execute = await screen.findByTestId('agent-command-execute');
    await waitFor(() => expect(execute).toBeEnabled());
    await user.click(execute);

    await waitFor(() => expect(capturedSignal).toBeDefined());

    await waitFor(() => expect(screen.getByTestId('agent-stop')).toBeEnabled());
    await user.click(screen.getByTestId('agent-stop'));

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));

    const ws = wsRegistry?.instances?.at(-1);
    const sent = (ws?.sent ?? []).map((entry) => {
      try {
        return JSON.parse(entry) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
    expect(sent.some((msg) => msg.type === 'cancel_inflight')).toBe(false);
  });
});
