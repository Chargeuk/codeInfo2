import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('Agents page - command execute disabled when persistence unavailable', () => {
  it('disables Execute and shows the persistence note when mongoConnected === false', async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ mongoConnected: false }),
        } as Response);
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ agents: [{ name: 'a1' }] }),
        } as Response);
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
                stepCount: 1,
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
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const execute = await screen.findByTestId('agent-command-execute');
    await waitFor(() => expect(execute).toBeDisabled());
    expect(
      await screen.findByTestId('agent-command-persistence-note'),
    ).toHaveTextContent('Commands require conversation history');
  });

  it('sends selected startStep as an integer in command execute payload', async () => {
    const user = userEvent.setup();
    const runBodies: Array<Record<string, unknown>> = [];

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
            json: async () => ({ agents: [{ name: 'a1' }] }),
          } as Response);
        }

        if (target.includes('/agents/a1/commands')) {
          if (target.includes('/run')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {};
            runBodies.push(body as Record<string, unknown>);
            return Promise.resolve({
              ok: true,
              status: 202,
              json: async () => ({
                status: 'started',
                agentName: 'a1',
                commandName: 'improve_plan',
                conversationId: 'conv-1',
                modelId: 'gpt-5.3-codex',
              }),
            } as Response);
          }

          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              commands: [
                {
                  name: 'improve_plan',
                  description: 'd',
                  disabled: false,
                  stepCount: 3,
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

    await waitFor(() => {
      const registry = (
        globalThis as unknown as {
          __wsMock?: { last: () => { readyState: number } | null };
        }
      ).__wsMock;
      expect(registry?.last()?.readyState).toBe(1);
    });

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await user.click(commandSelect);
    await user.click(
      await screen.findByTestId('agent-command-option-improve_plan::local'),
    );

    const startStepSelect = await screen.findByRole('combobox', {
      name: /start step/i,
    });
    await user.click(startStepSelect);
    await user.click(await screen.findByRole('option', { name: 'Step 2' }));
    await waitFor(() => expect(startStepSelect).toHaveTextContent('Step 2'));

    await user.click(await screen.findByTestId('agent-command-execute'));

    await waitFor(() => expect(runBodies).toHaveLength(1));
    expect(runBodies[0]?.startStep).toBe(2);
    expect(Number.isInteger(runBodies[0]?.startStep)).toBe(true);
  });

  it('renders Start step only on the AGENTS command row in this surface', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
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
                stepCount: 2,
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
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await user.click(commandSelect);
    await user.click(
      await screen.findByTestId('agent-command-option-improve_plan::local'),
    );

    const startStepComboboxes = screen.getAllByRole('combobox', {
      name: /start step/i,
    });
    expect(startStepComboboxes).toHaveLength(1);
    expect(screen.queryByTestId('flow-start-step-select')).toBeNull();
    expect(screen.queryByTestId('chat-start-step-select')).toBeNull();
  });
});
