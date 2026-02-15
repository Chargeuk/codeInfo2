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

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: (() => {
      const headers = new Headers();
      headers.append('content-type', 'application/json');
      return headers;
    })(),
    json: async () => payload,
  } as Response);
}

describe('Agents page - run conflict handling', () => {
  it('shows RUN_IN_PROGRESS conflict message when executing a command', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return jsonResponse({ mongoConnected: true });
      }
      if (
        target.includes('/agents') &&
        !target.includes('/commands') &&
        !target.includes('/run')
      ) {
        return jsonResponse({ agents: [{ name: 'a1' }] });
      }
      if (target.includes('/agents/a1/commands/run')) {
        return jsonResponse(
          { error: 'conflict', code: 'RUN_IN_PROGRESS', message: 'busy' },
          409,
        );
      }
      if (target.includes('/agents/a1/commands')) {
        return jsonResponse({
          commands: [
            {
              name: 'improve_plan',
              description: 'd',
              disabled: false,
            },
          ],
        });
      }
      if (target.includes('/conversations')) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);
    const option = await screen.findByTestId(
      'agent-command-option-improve_plan::local',
    );
    await user.click(option);

    const execute = await screen.findByTestId('agent-command-execute');
    await waitFor(() => expect(execute).toBeEnabled());
    await user.click(execute);

    const banner = await screen.findByTestId('agents-run-error');
    expect(banner).toHaveTextContent(
      /This conversation already has a run in progress in another tab\/window/i,
    );
  });

  it('shows RUN_IN_PROGRESS conflict message when sending a normal instruction', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) {
          return jsonResponse({ mongoConnected: true });
        }
        if (
          target.includes('/agents') &&
          !target.includes('/commands') &&
          !target.includes('/run')
        ) {
          return jsonResponse({ agents: [{ name: 'a1' }] });
        }
        if (target.includes('/agents/a1/commands')) {
          return jsonResponse({ commands: [] });
        }
        if (target.includes('/agents/a1/run')) {
          expect(init?.method).toBe('POST');
          return jsonResponse(
            { error: 'conflict', code: 'RUN_IN_PROGRESS', message: 'busy' },
            409,
          );
        }
        if (target.includes('/conversations')) {
          return jsonResponse({ items: [] });
        }
        return jsonResponse({});
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const agentSelect = await screen.findByRole('combobox', { name: /agent/i });
    await waitFor(() => expect(agentSelect).toHaveTextContent('a1'));

    const input = await screen.findByTestId('agent-input');
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, 'Do work');

    await waitFor(() => expect(screen.getByTestId('agent-send')).toBeEnabled());
    await user.click(screen.getByTestId('agent-send'));

    const banner = await screen.findByTestId('agents-run-error');
    expect(banner).toHaveTextContent(
      /This conversation already has a run in progress in another tab\/window/i,
    );
  });
});
