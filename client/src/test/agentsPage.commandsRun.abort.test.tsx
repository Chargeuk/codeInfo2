import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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

describe('Agents page - abort command execute', () => {
  it('Stop aborts an in-flight command execute request', async () => {
    let capturedSignal: AbortSignal | undefined;

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
    await act(async () => {
      await userEvent.click(commandSelect);
    });
    const option = await screen.findByTestId(
      'agent-command-option-improve_plan',
    );
    await act(async () => {
      await userEvent.click(option);
    });

    await act(async () => {
      await userEvent.keyboard('{Escape}');
    });

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
    fireEvent.click(execute);

    await waitFor(() => expect(capturedSignal).toBeDefined());

    await waitFor(() => expect(screen.getByTestId('agent-stop')).toBeEnabled());
    await act(async () => {
      await userEvent.click(screen.getByTestId('agent-stop'));
    });

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
  });
});
