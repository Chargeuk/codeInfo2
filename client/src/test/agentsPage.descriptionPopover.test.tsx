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

type AgentResponse = {
  name: string;
  description?: string;
  warnings?: string[];
};

function mockAgentsFetch(params: {
  agents?: AgentResponse[];
  agentsStatus?: number;
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

  it('renders warnings inside the popover when present', async () => {
    mockAgentsFetch({
      agents: [
        { name: 'coding_agent', description: '# Hello', warnings: ['Warn 1'] },
      ],
    });
    const user = userEvent.setup();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    const infoButton = await screen.findByTestId('agent-info');
    await user.click(infoButton);

    await waitFor(() => expect(screen.getByText('Warn 1')).toBeInTheDocument());
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

  it('hides the info icon when agents fail to load', async () => {
    mockAgentsFetch({ agentsStatus: 500 });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agents-error');
    expect(screen.queryByTestId('agent-info')).toBeNull();
  });

  it('does not render inline warnings or description when the popover is closed', async () => {
    mockAgentsFetch({
      agents: [
        { name: 'coding_agent', description: '# Hello', warnings: ['W'] },
      ],
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agent-info');
    expect(screen.queryByTestId('agent-description')).toBeNull();
    expect(screen.queryByTestId('agent-warnings')).toBeNull();
  });
});
