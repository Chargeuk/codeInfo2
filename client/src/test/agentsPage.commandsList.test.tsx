import { jest } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
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
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
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
            {
              name: 'first_cmd',
              description: 'First',
              disabled: false,
              stepCount: 1,
            },
          ],
        });
      }

      if (target.includes('/agents/a2/commands')) {
        return mockJsonResponse({
          commands: [
            {
              name: 'second_cmd',
              description: 'Second',
              disabled: false,
              stepCount: 1,
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
            {
              name: 'good',
              description: 'Good',
              disabled: false,
              stepCount: 1,
            },
            {
              name: 'bad',
              description: 'Invalid command file',
              disabled: true,
              stepCount: 1,
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

    expect(screen.queryByTestId('agent-command-description')).toBeNull();
    expect(
      screen.queryByText('Select a command to see its description.'),
    ).toBeNull();
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
              stepCount: 1,
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
              stepCount: 1,
              sourceId: '/data/repo-b',
              sourceLabel: 'Repo B',
            },
            {
              name: 'build',
              description: 'Repo A',
              disabled: false,
              stepCount: 1,
              sourceId: '/data/repo-a',
              sourceLabel: 'Repo A',
            },
            {
              name: 'build',
              description: 'Local',
              disabled: false,
              stepCount: 1,
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

  it('does not render the legacy inline command description area', async () => {
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
              stepCount: 1,
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

    await screen.findByRole('combobox', { name: /command/i });
    expect(screen.queryByTestId('agent-command-description')).toBeNull();
  });

  it('does not render legacy placeholder copy for command descriptions', async () => {
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
              stepCount: 1,
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

    await screen.findByRole('combobox', { name: /command/i });
    expect(
      screen.queryByText('Select a command to see its description.'),
    ).toBeNull();
  });

  it('keeps command listing and selection functional after inline removal', async () => {
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
              stepCount: 1,
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
      expect(commandSelect).toHaveTextContent('improve plan'),
    );
    expect(screen.getByTestId('agent-command-info')).toBeEnabled();
    expect(screen.queryByTestId('agent-command-description')).toBeNull();
  });

  it('keeps execute-command enable-disable behavior unchanged', async () => {
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
              stepCount: 1,
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

    const executeButton = await screen.findByTestId('agent-command-execute');
    expect(executeButton).toBeDisabled();

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);
    const option = await screen.findByTestId(
      'agent-command-option-improve_plan::local',
    );
    await user.click(option);

    await waitFor(() => expect(executeButton).toBeEnabled());
  });

  it('keeps Execute Command mapped to command-run endpoint (not instruction endpoint)', async () => {
    const user = userEvent.setup();
    const commandRunUrls: string[] = [];
    const instructionRunUrls: string[] = [];

    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();

      if (target.includes('/health')) {
        return mockJsonResponse({ mongoConnected: true });
      }

      if (
        target.includes('/agents') &&
        !target.includes('/commands') &&
        !target.includes('/run')
      ) {
        return mockJsonResponse({ agents: [{ name: 'a1' }] });
      }

      if (target.includes('/agents/a1/commands/run')) {
        commandRunUrls.push(target);
        return mockJsonResponse(
          {
            status: 'started',
            agentName: 'a1',
            commandName: 'improve_plan',
            conversationId: 'c1',
            modelId: 'gpt-5.3-codex',
          },
          { status: 202 },
        );
      }

      if (target.includes('/agents/a1/commands')) {
        return mockJsonResponse({
          commands: [
            {
              name: 'improve_plan',
              description: 'Improves a plan step-by-step.',
              disabled: false,
              stepCount: 1,
            },
          ],
        });
      }

      if (target.includes('/agents/a1/run')) {
        instructionRunUrls.push(target);
        return mockJsonResponse({ status: 'started' }, { status: 202 });
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
    await user.click(
      await screen.findByTestId('agent-command-option-improve_plan::local'),
    );

    const executeButton = await screen.findByTestId('agent-command-execute');
    await waitFor(() => expect(executeButton).toBeEnabled());
    await user.click(executeButton);

    await waitFor(() => expect(commandRunUrls).toHaveLength(1));
    expect(instructionRunUrls).toHaveLength(0);
  });

  it('renders a Start step control immediately after the command selector', async () => {
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
              description: 'Build',
              disabled: false,
              stepCount: 3,
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

    const commandRow = await screen.findByTestId('agent-command-row');
    const commandSelect = within(commandRow).getByRole('combobox', {
      name: /command/i,
    });
    const startStepSelect = within(commandRow).getByRole('combobox', {
      name: /start step/i,
    });

    expect(commandSelect.compareDocumentPosition(startStepSelect)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('keeps Start step disabled until a command is selected', async () => {
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
              description: 'Build',
              disabled: false,
              stepCount: 3,
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

    const startStepSelect = await screen.findByRole('combobox', {
      name: /start step/i,
    });
    expect(startStepSelect).toHaveAttribute('aria-disabled', 'true');

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);
    await user.click(
      await screen.findByTestId('agent-command-option-build::local'),
    );

    await waitFor(() =>
      expect(startStepSelect).not.toHaveAttribute('aria-disabled', 'true'),
    );
  });

  it('renders Step 1..N options and defaults to Step 1 for selected commands', async () => {
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
              description: 'Build',
              disabled: false,
              stepCount: 3,
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
    const startStepSelect = await screen.findByRole('combobox', {
      name: /start step/i,
    });

    await user.click(commandSelect);
    await user.click(
      await screen.findByTestId('agent-command-option-build::local'),
    );
    await waitFor(() => expect(startStepSelect).toHaveTextContent('Step 1'));

    await user.click(startStepSelect);
    expect(await screen.findByRole('option', { name: 'Step 1' })).toBeVisible();
    expect(await screen.findByRole('option', { name: 'Step 2' })).toBeVisible();
    expect(await screen.findByRole('option', { name: 'Step 3' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Step 4' })).toBeNull();
  });

  it('resets Start step back to Step 1 when command changes', async () => {
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
              description: 'Build',
              disabled: false,
              stepCount: 3,
            },
            {
              name: 'deploy',
              description: 'Deploy',
              disabled: false,
              stepCount: 2,
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
    const startStepSelect = await screen.findByRole('combobox', {
      name: /start step/i,
    });

    await user.click(commandSelect);
    await user.click(
      await screen.findByTestId('agent-command-option-build::local'),
    );
    await user.click(startStepSelect);
    await user.click(await screen.findByRole('option', { name: 'Step 3' }));
    await waitFor(() => expect(startStepSelect).toHaveTextContent('Step 3'));

    await user.click(commandSelect);
    await user.click(
      await screen.findByTestId('agent-command-option-deploy::local'),
    );
    await waitFor(() => expect(startStepSelect).toHaveTextContent('Step 1'));
  });

  it('keeps Start step visible, selected to Step 1, and disabled for single-step commands', async () => {
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
              name: 'single',
              description: 'Single step',
              disabled: false,
              stepCount: 1,
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
    const startStepSelect = await screen.findByRole('combobox', {
      name: /start step/i,
    });

    await user.click(commandSelect);
    await user.click(
      await screen.findByTestId('agent-command-option-single::local'),
    );

    await waitFor(() => expect(startStepSelect).toHaveTextContent('Step 1'));
    expect(startStepSelect).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps disabled command entries blocked with Start step disabled and no execute request', async () => {
    const user = userEvent.setup();
    const runCalls: RequestInit[] = [];
    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) {
          return mockJsonResponse({ mongoConnected: true });
        }
        if (
          target.includes('/agents') &&
          !target.includes('/commands') &&
          !target.includes('/run')
        ) {
          return mockJsonResponse({ agents: [{ name: 'a1' }] });
        }
        if (target.includes('/agents/a1/commands/run')) {
          runCalls.push(init ?? {});
          return mockJsonResponse(
            {
              status: 'started',
              agentName: 'a1',
              commandName: 'bad',
              conversationId: 'c1',
              modelId: 'gpt-5.3-codex',
            },
            { status: 202 },
          );
        }
        if (target.includes('/agents/a1/commands')) {
          return mockJsonResponse({
            commands: [
              {
                name: 'bad',
                description: 'Invalid command file',
                disabled: true,
                stepCount: 1,
              },
            ],
          });
        }
        if (target.includes('/conversations')) {
          return mockJsonResponse({ items: [] });
        }
        return mockJsonResponse({});
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const startStepSelect = await screen.findByRole('combobox', {
      name: /start step/i,
    });
    const executeButton = await screen.findByTestId('agent-command-execute');

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await user.click(commandSelect);
    const disabledOption = await screen.findByTestId(
      'agent-command-option-bad::local',
    );
    expect(disabledOption).toHaveAttribute('aria-disabled', 'true');

    expect(startStepSelect).toHaveAttribute('aria-disabled', 'true');
    expect(executeButton).toBeDisabled();
    expect(runCalls).toHaveLength(0);
  });
});
