import { jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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

function mockJsonResponse(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function setupActionModeFetch(params?: {
  agents?: Array<{ name: string }>;
  commandsByAgent?: Record<
    string,
    Array<{
      name: string;
      description: string;
      disabled?: boolean;
      stepCount: number;
    }>
  >;
  promptsByAgent?: Record<
    string,
    Array<{ relativePath: string; fullPath: string }>
  >;
}) {
  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const target = typeof url === 'string' ? url : url.toString();

    if (target.includes('/health')) {
      return mockJsonResponse({ mongoConnected: true });
    }

    if (target.includes('/chat/providers')) {
      return mockJsonResponse({
        providers: [
          {
            id: 'codex',
            label: 'OpenAI Codex',
            available: true,
            toolsAvailable: true,
          },
        ],
      });
    }

    if (target.includes('/chat/models')) {
      return mockJsonResponse({
        models: [
          {
            key: 'mock-model',
            displayName: 'Mock Model',
            type: 'gguf',
          },
        ],
        available: true,
        toolsAvailable: true,
      });
    }

    if (target.includes('/prompts')) {
      const match = target.match(/\/agents\/([^/]+)\/prompts(?:\?|$)/);
      const agentName = match?.[1] ?? 'coding_agent';
      return mockJsonResponse({
        prompts: params?.promptsByAgent?.[agentName] ?? [],
      });
    }

    if (target.includes('/commands')) {
      const match = target.match(/\/agents\/([^/]+)\/commands(?:\?|$)/);
      const agentName = match?.[1] ?? 'coding_agent';
      return mockJsonResponse({
        commands: params?.commandsByAgent?.[agentName] ?? [],
      });
    }

    if (target.includes('/agents/') && !target.includes('/commands')) {
      const match = target.match(/\/agents\/([^/]+)(?:\?|$)/);
      const agentName = match?.[1] ?? 'coding_agent';
      return mockJsonResponse({
        agent: {
          name: agentName,
          description: `${agentName} description`,
          disabled: false,
          warnings: [],
          fallbackCandidates: [],
        },
      });
    }

    if (target.includes('/agents') && !target.includes('/commands')) {
      return mockJsonResponse({
        agents: params?.agents ?? [{ name: 'coding_agent' }],
      });
    }

    if (target.includes('/conversations')) {
      return mockJsonResponse({ items: [] });
    }

    return mockJsonResponse({});
  });
}

async function mountAgentsPage() {
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

  await screen.findByTestId('agent-select-trigger');
}

async function openCommandMenuAndChoose(optionName: string) {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('agent-command-trigger'));
  await user.click(
    await screen.findByRole('option', {
      name: new RegExp(optionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    }),
  );
}

async function commitWorkingFolder(value: string) {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('agent-working-path-trigger'));
  const field = await screen.findByTestId('agent-working-folder');
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
  await user.keyboard('{Escape}');
}

describe('Agents page - action mode', () => {
  it('resets invalid command and step selections when the agent changes', async () => {
    const user = userEvent.setup();
    setupActionModeFetch({
      agents: [{ name: 'coding_agent' }, { name: 'review_agent' }],
      commandsByAgent: {
        coding_agent: [
          {
            name: 'build',
            description: 'Build',
            disabled: false,
            stepCount: 3,
          },
        ],
        review_agent: [],
      },
      promptsByAgent: {
        coding_agent: [
          {
            relativePath: 'coding/start.md',
            fullPath: '/workspace/coding/start.md',
          },
        ],
        review_agent: [],
      },
    });
    await mountAgentsPage();

    await commitWorkingFolder('/workspace/coding');
    await openCommandMenuAndChoose('Build');
    expect(screen.getByTestId('agent-command-trigger')).toHaveTextContent(
      /Build/i,
    );
    await user.click(screen.getByTestId('agent-step-trigger'));
    const stepPopover = await screen.findByTestId('agent-step-popover');
    await user.click(within(stepPopover).getByText('Step 2'));
    expect(screen.getByTestId('agent-step-trigger')).toHaveTextContent(
      'Step 2',
    );

    await user.click(screen.getByTestId('agent-select-trigger'));
    const agentPopover = await screen.findByTestId('agent-selector-popover');
    await user.click(within(agentPopover).getByText('review_agent'));

    await waitFor(() =>
      expect(screen.getByTestId('agent-command-trigger')).toHaveTextContent(
        'Write instruction',
      ),
    );
    expect(screen.getByTestId('agent-step-trigger')).toBeDisabled();
    expect(screen.getByTestId('agent-step-trigger')).toHaveTextContent(
      'Not used',
    );
    expect(screen.getByTestId('agent-input')).toBeEnabled();
  });

  it('clears step state when switching from command mode to prompt mode', async () => {
    const user = userEvent.setup();
    setupActionModeFetch({
      commandsByAgent: {
        coding_agent: [
          {
            name: 'build',
            description: 'Build',
            disabled: false,
            stepCount: 3,
          },
        ],
      },
      promptsByAgent: {
        coding_agent: [
          {
            relativePath: 'workflows/prompts/review.md',
            fullPath: '/workflows/prompts/review.md',
          },
        ],
      },
    });
    await mountAgentsPage();

    await commitWorkingFolder('/workspace');
    await openCommandMenuAndChoose('Build');
    await user.click(screen.getByTestId('agent-step-trigger'));
    const stepPopover = await screen.findByTestId('agent-step-popover');
    await user.click(within(stepPopover).getByText('Step 2'));
    expect(screen.getByTestId('agent-step-trigger')).toHaveTextContent(
      'Step 2',
    );

    await user.click(screen.getByTestId('agent-command-trigger'));
    const commandPopover = await screen.findByTestId('agent-command-popover');
    await user.click(
      within(commandPopover).getByText('workflows/prompts/review.md'),
    );

    expect(screen.getByTestId('agent-command-trigger')).toHaveTextContent(
      'workflows/prompts/review.md',
    );
    expect(screen.getByTestId('agent-input')).toBeDisabled();
    expect(screen.getByTestId('agent-step-trigger')).toBeDisabled();
    expect(screen.getByTestId('agent-step-trigger')).toHaveTextContent(
      'Not used',
    );
  });
});
