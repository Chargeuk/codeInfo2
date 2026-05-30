import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
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

type AgentResponse = {
  name: string;
  description?: string;
  warnings?: string[];
};

type AgentDetailsResponse = {
  name: string;
  description?: string;
  disabled?: boolean;
  warnings?: Array<{
    code: string;
    message: string;
    providerId?: string;
    fallbackProviderId?: string;
  }>;
  disabledReason?: {
    code: string;
    message: string;
    providerId?: string;
  };
  fallbackCandidates?: Array<{
    providerId: string;
    available: boolean;
    reason?: string;
  }>;
};

type CommandResponse = {
  name: string;
  description?: string;
  disabled?: boolean;
  stepCount?: number;
  sourceId?: string;
  sourceLabel?: string;
};

function mockAgentsFetch(params: {
  agents?: AgentResponse[];
  agentsStatus?: number;
  agentDetails?: AgentDetailsResponse;
  commands?: CommandResponse[];
}) {
  const agentsStatus = params.agentsStatus ?? 200;
  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const target = typeof url === 'string' ? url : url.toString();
    if (target.includes('/health')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ mongoConnected: true }),
      } as Response);
    }
    if (
      target.includes('/agents/coding_agent') &&
      !target.includes('/commands')
    ) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          agent: params.agentDetails ?? {
            name: 'coding_agent',
            description: params.agents?.[0]?.description,
            disabled: false,
            warnings: [],
            fallbackCandidates: [],
          },
        }),
      } as Response);
    }
    if (target.includes('/agents') && !target.includes('/commands')) {
      return Promise.resolve({
        ok: agentsStatus >= 200 && agentsStatus < 300,
        status: agentsStatus,
        json: async () => ({ agents: params.agents ?? [] }),
      } as Response);
    }
    if (target.includes('/agents/coding_agent/commands')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ commands: params.commands ?? [] }),
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
}

describe('Agents page - description', () => {
  it('renders the selected agent description as Markdown in the popover', async () => {
    mockAgentsFetch({
      agents: [{ name: 'coding_agent', description: '# Hello' }],
    });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const infoButton = await screen.findByTestId('agent-info');
    await user.click(infoButton);

    const description = await screen.findByTestId('agent-description');
    await waitFor(() => expect(description).toHaveTextContent('Hello'));
  });

  it('opens the shared info popover even when warning-bearing metadata is present', async () => {
    mockAgentsFetch({
      agents: [{ name: 'coding_agent', description: '# Hello' }],
      agentDetails: {
        name: 'coding_agent',
        description: '# Hello',
        disabled: false,
        warnings: [{ code: 'duplicate_root', message: 'Warn 1' }],
        fallbackCandidates: [],
      },
    });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const infoButton = await screen.findByTestId('agent-info');
    await user.click(infoButton);

    expect(
      await screen.findByTestId('agent-command-info-popover'),
    ).toBeInTheDocument();
  });

  it('renders the empty-state message when no metadata is available', async () => {
    mockAgentsFetch({ agents: [{ name: 'coding_agent' }] });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const infoButton = await screen.findByTestId('agent-info');
    await user.click(infoButton);

    expect(
      await screen.findByText(
        'No description or warnings are available for this agent yet.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the shared info control available when agents fail to load', async () => {
    mockAgentsFetch({ agentsStatus: 500 });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agents-error');
    expect(screen.getByTestId('agent-info')).toBeInTheDocument();
  });

  it('does not render inline warnings or description when the popover is closed', async () => {
    mockAgentsFetch({
      agents: [{ name: 'coding_agent', description: '# Hello' }],
      agentDetails: {
        name: 'coding_agent',
        description: '# Hello',
        disabled: false,
        warnings: [{ code: 'duplicate_root', message: 'W' }],
        fallbackCandidates: [],
      },
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agent-info');
    expect(screen.queryByTestId('agent-description')).toBeNull();
    expect(screen.queryByTestId('agent-warnings')).toBeNull();
  });

  it('keeps invalid-provider metadata hidden until the shared info popover opens', async () => {
    mockAgentsFetch({
      agents: [{ name: 'coding_agent', description: '# Hello' }],
      agentDetails: {
        name: 'coding_agent',
        description: '# Hello',
        disabled: false,
        warnings: [
          {
            code: 'invalid_provider',
            message:
              'Agent config requested unsupported provider "not-a-provider".',
            providerId: 'not-a-provider',
          },
        ],
        fallbackCandidates: [],
      },
    });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agent-info');
    expect(
      screen.queryByText(/unsupported provider "not-a-provider"/i),
    ).toBeNull();

    await user.click(screen.getByTestId('agent-info'));
    expect(
      await screen.findByTestId('agent-command-info-popover'),
    ).toBeInTheDocument();
  });
});

describe('Agents page - command info popover', () => {
  const selectSmokeCommand = async (
    user: ReturnType<typeof userEvent.setup>,
  ) => {
    const commandSelect = await screen.findByTestId('agent-command-trigger');
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);
    const option = await screen.findByTestId(
      'agent-command-option-smoke::local',
    );
    await user.click(option);
    await waitFor(() => expect(screen.getByTestId('agent-info')).toBeEnabled());
  };

  it('renders command-info control between command select and execute button', async () => {
    mockAgentsFetch({ agents: [{ name: 'coding_agent' }] });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const infoButton = await screen.findByTestId('agent-info');
    const commandTrigger = await screen.findByTestId('agent-command-trigger');
    const stepTrigger = await screen.findByTestId('agent-step-trigger');

    expect(infoButton).toBeInTheDocument();
    expect(commandTrigger).toBeInTheDocument();
    expect(stepTrigger).toBeInTheDocument();
  });

  it('keeps the shared info control enabled when no command is selected', async () => {
    mockAgentsFetch({
      agents: [{ name: 'coding_agent' }],
      commands: [
        { name: 'smoke', description: 'Smoke test command', stepCount: 1 },
      ],
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const infoButton = await screen.findByTestId('agent-info');
    expect(infoButton).toBeEnabled();
  });

  it('opens the shared info popover with selected command description', async () => {
    mockAgentsFetch({
      agents: [{ name: 'coding_agent' }],
      commands: [
        { name: 'smoke', description: 'Smoke test command', stepCount: 1 },
      ],
    });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await selectSmokeCommand(user);

    const infoButton = await screen.findByTestId('agent-info');
    await user.click(infoButton);

    expect(
      await screen.findByTestId('agent-command-info-popover'),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('command-info-text')).toHaveTextContent(
      'Smoke test command',
    );
  });

  it('opens the shared info popover even when command remains unselected', async () => {
    mockAgentsFetch({
      agents: [{ name: 'coding_agent' }],
      commands: [
        { name: 'smoke', description: 'Smoke test command', stepCount: 1 },
      ],
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const infoButton = await screen.findByTestId('agent-info');
    fireEvent.click(infoButton);

    expect(
      await screen.findByTestId('agent-command-info-popover'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('command-info-text')).toBeNull();
  });

  it('closes the shared info popover after open', async () => {
    mockAgentsFetch({
      agents: [{ name: 'coding_agent' }],
      commands: [
        { name: 'smoke', description: 'Smoke test command', stepCount: 1 },
      ],
    });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await selectSmokeCommand(user);

    const infoButton = await screen.findByTestId('agent-info');
    await user.click(infoButton);
    await screen.findByTestId('agent-command-info-popover');

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByTestId('agent-command-info-popover')).toBeNull(),
    );
  });
});
