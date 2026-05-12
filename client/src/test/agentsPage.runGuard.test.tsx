import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
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
const {
  default: AgentsPage,
  isExecutePromptEnabled,
  reconcileAgentDetailsCache,
} = await import('../pages/AgentsPage');
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

describe('Agents page run guards', () => {
  it('drops cached disabled agent details after a later agents list refresh marks the agent enabled', () => {
    const previousCache = {
      coding_agent: {
        name: 'coding_agent',
        description: '# Coding agent',
        disabled: true,
        warnings: [
          {
            code: 'provider_unavailable',
            message: 'No usable provider remains',
          },
        ],
        fallbackCandidates: [],
        disabledReason: {
          code: 'provider_unavailable',
          message: 'No usable provider remains',
        },
      },
    };

    const nextCache = reconcileAgentDetailsCache(previousCache, [
      { name: 'coding_agent', disabled: false },
    ]);

    expect(nextCache).toEqual({});
    expect(nextCache).not.toBe(previousCache);
  });

  it('blocks direct agent submission once selected-agent details mark the target disabled', async () => {
    const user = userEvent.setup();
    let runRequests = 0;

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
            agent: {
              name: 'coding_agent',
              description: '# Coding agent',
              disabled: true,
              warnings: [
                {
                  code: 'invalid_provider',
                  message:
                    'Agent config requested unsupported provider "not-a-provider".',
                },
              ],
              disabledReason: {
                code: 'provider_unavailable',
                message: 'No usable provider remains',
              },
              fallbackCandidates: [],
            },
          }),
        } as Response);
      }

      if (target.includes('/agents') && !target.includes('/commands')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ agents: [{ name: 'coding_agent' }] }),
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

      if (target.includes('/agents/coding_agent/run')) {
        runRequests += 1;
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            status: 'started',
            agentName: 'coding_agent',
            conversationId: 'c1',
            inflightId: 'i1',
            modelId: 'gpt-5',
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

    const folder = await screen.findByRole('textbox', {
      name: 'working_folder',
    });
    await user.type(folder, '/tmp/stale');
    await user.type(await screen.findByTestId('agent-input'), 'Do work');

    await act(async () => {
      await user.click(screen.getByTestId('agent-info'));
    });

    await screen.findByTestId('agent-disabled');
    await waitFor(() => expect(folder).toHaveValue(''));
    await waitFor(() =>
      expect(screen.getByTestId('agent-send')).toBeDisabled(),
    );

    expect(runRequests).toBe(0);
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).includes('/run')),
    ).toBe(false);
  });

  it('includes selectedAgentDisabled in execute-prompt gating', () => {
    expect(
      isExecutePromptEnabled({
        selectedPromptEntry: {
          relativePath: 'persona/start.md',
          fullPath: '/tmp/disabled/.github/prompts/persona/start.md',
        },
        selectedAgentName: 'coding_agent',
        selectedAgentDisabled: true,
        startPending: false,
        persistenceUnavailable: false,
      }),
    ).toBe(false);
  });
});
