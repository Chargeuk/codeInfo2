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

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve({
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: async () => payload,
  } as Response);
}

describe('Agents page - commands list', () => {
  it('refreshes the commands dropdown when switching agents', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return mockJsonResponse({ agents: [{ name: 'a1' }, { name: 'a2' }] });
      }

      if (target.includes('/agents/a1/commands')) {
        return mockJsonResponse({
          commands: [
            { name: 'first_cmd', description: 'First', disabled: false },
          ],
        });
      }

      if (target.includes('/agents/a2/commands')) {
        return mockJsonResponse({
          commands: [
            { name: 'second_cmd', description: 'Second', disabled: false },
          ],
        });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const agentSelect = await screen.findByRole('combobox', {
      name: /agent/i,
    });
    await waitFor(() => expect(agentSelect).toHaveTextContent('a1'));

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);
    await screen.findByTestId('agent-command-option-first_cmd::local');
    expect(
      screen.queryByTestId('agent-command-option-second_cmd::local'),
    ).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(agentSelect);
    const a2Option = await screen.findByRole('option', { name: 'a2' });
    await user.click(a2Option);
    await waitFor(() => expect(agentSelect).toHaveTextContent('a2'));

    await user.click(commandSelect);
    await screen.findByTestId('agent-command-option-second_cmd::local');
    expect(
      screen.queryByTestId('agent-command-option-first_cmd::local'),
    ).toBeNull();
  });

  it('renders invalid commands as disabled/unselectable', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return mockJsonResponse({ agents: [{ name: 'a1' }] });
      }

      if (target.includes('/agents/a1/commands')) {
        return mockJsonResponse({
          commands: [
            { name: 'good', description: 'Good', disabled: false },
            {
              name: 'bad',
              description: 'Invalid command file',
              disabled: true,
            },
          ],
        });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);

    const disabledOption = await screen.findByTestId(
      'agent-command-option-bad::local',
    );
    expect(disabledOption).toHaveAttribute('aria-disabled', 'true');

    const description = screen.getByTestId('agent-command-description');
    expect(description).toHaveTextContent(
      'Select a command to see its description.',
    );

    await waitFor(() =>
      expect(description).toHaveTextContent(
        'Select a command to see its description.',
      ),
    );
    expect(screen.getByTestId('agent-command-execute')).toBeDisabled();
  });

  it('shows command names with underscores replaced by spaces', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return mockJsonResponse({ agents: [{ name: 'a1' }] });
      }

      if (target.includes('/agents/a1/commands')) {
        return mockJsonResponse({
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
        return mockJsonResponse({ items: [] });
      }

      return mockJsonResponse({});
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
    expect(option).toHaveTextContent('improve plan');
    expect(option).not.toHaveTextContent('improve_plan');
  });

  it('renders duplicate command names with source labels and sorted order', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return mockJsonResponse({ agents: [{ name: 'a1' }] });
      }

      if (target.includes('/agents/a1/commands')) {
        return mockJsonResponse({
          commands: [
            {
              name: 'build',
              description: 'Repo B',
              disabled: false,
              sourceId: '/data/repo-b',
              sourceLabel: 'Repo B',
            },
            {
              name: 'build',
              description: 'Repo A',
              disabled: false,
              sourceId: '/data/repo-a',
              sourceLabel: 'Repo A',
            },
            {
              name: 'build',
              description: 'Local',
              disabled: false,
            },
          ],
        });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }

      return mockJsonResponse({});
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);

    await screen.findByTestId('agent-command-option-build::local');
    await screen.findByTestId('agent-command-option-build::/data/repo-a');
    await screen.findByTestId('agent-command-option-build::/data/repo-b');

    const optionLabels = screen
      .getAllByRole('option')
      .map((option) => option.textContent ?? '')
      .filter((label) => label && label !== 'Select a command');

    expect(optionLabels).toEqual([
      'build',
      'build - [Repo A]',
      'build - [Repo B]',
    ]);
  });

  it('shows the selected command Description and never renders raw JSON', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return mockJsonResponse({ agents: [{ name: 'a1' }] });
      }

      if (target.includes('/agents/a1/commands')) {
        return mockJsonResponse({
          commands: [
            {
              name: 'improve_plan',
              description: 'Improves a plan step-by-step.',
              disabled: false,
            },
          ],
        });
      }

      if (target.includes('/conversations')) {
        return mockJsonResponse({ items: [] });
      }

      return mockJsonResponse({});
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

    await waitFor(() =>
      expect(screen.getByTestId('agent-command-description')).toHaveTextContent(
        'Improves a plan step-by-step.',
      ),
    );
    expect(screen.queryByText(/\{"Description":/)).toBeNull();
  });
});
