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

function okJson(payload: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response);
}

describe('Agents page - command execute refresh + turns hydration', () => {
  it('clicking Execute calls the command run endpoint with the selected commandName', async () => {
    const runBodies: Record<string, unknown>[] = [];

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) return okJson({ mongoConnected: true });
        if (target.includes('/agents') && !target.includes('/commands')) {
          return okJson({ agents: [{ name: 'a1' }] });
        }
        if (target.includes('/agents/a1/commands/run')) {
          if (init?.body) {
            runBodies.push(JSON.parse(init.body.toString()));
          }
          return okJson({
            agentName: 'a1',
            commandName: 'improve_plan',
            conversationId: 'c1',
            modelId: 'gpt-5.1-codex-max',
          });
        }
        if (target.includes('/agents/a1/commands')) {
          return okJson({
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
          return okJson({ items: [] });
        }
        if (target.includes('/conversations/c1/turns')) {
          return okJson({ items: [] });
        }
        return okJson({});
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

    const execute = await screen.findByTestId('agent-command-execute');
    await waitFor(() => expect(execute).toBeEnabled());
    await act(async () => {
      await userEvent.click(execute);
    });

    await waitFor(() => expect(runBodies.length).toBe(1));
    expect(runBodies[0]).toMatchObject({ commandName: 'improve_plan' });
  });

  it('successful execute refreshes conversations and hydrates turns for the new conversation', async () => {
    let agentConversationsFetchCount = 0;

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) return okJson({ mongoConnected: true });

        if (target.includes('/agents') && !target.includes('/commands')) {
          return okJson({ agents: [{ name: 'a1' }] });
        }

        if (target.includes('/agents/a1/commands/run')) {
          expect(init?.method).toBe('POST');
          return okJson({
            agentName: 'a1',
            commandName: 'improve_plan',
            conversationId: 'c2',
            modelId: 'gpt-5.1-codex-max',
          });
        }

        if (target.includes('/agents/a1/commands')) {
          return okJson({
            commands: [
              {
                name: 'improve_plan',
                description: 'd',
                disabled: false,
              },
            ],
          });
        }

        if (target.includes('/conversations') && !target.includes('/turns')) {
          const hasAgentParam = target.includes('agentName=a1');
          if (!hasAgentParam) {
            return okJson({ items: [] });
          }
          agentConversationsFetchCount += 1;
          return okJson({
            items:
              agentConversationsFetchCount >= 2
                ? [
                    {
                      conversationId: 'c2',
                      title: 'New',
                      provider: 'codex',
                      model: 'gpt-5.1-codex-max',
                      lastMessageAt: '2025-01-01T00:00:00.000Z',
                    },
                  ]
                : [],
          });
        }

        if (target.includes('/conversations/c2/turns')) {
          return okJson({
            items: [
              {
                conversationId: 'c2',
                role: 'assistant',
                content: 'Hydrated answer',
                model: 'gpt-5.1-codex-max',
                provider: 'codex',
                status: 'ok',
                createdAt: '2025-01-01T00:00:02.000Z',
              },
              {
                conversationId: 'c2',
                role: 'user',
                content: 'Hydrated question',
                model: 'gpt-5.1-codex-max',
                provider: 'codex',
                status: 'ok',
                createdAt: '2025-01-01T00:00:01.000Z',
              },
            ],
          });
        }

        return okJson({});
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

    const execute = await screen.findByTestId('agent-command-execute');
    await waitFor(() => expect(execute).toBeEnabled());
    await act(async () => {
      await userEvent.click(execute);
    });

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([callUrl]) =>
          (typeof callUrl === 'string' ? callUrl : callUrl.toString()).includes(
            '/conversations/c2/turns',
          ),
        ),
      ).toBe(true),
    );

    await screen.findByText('Hydrated question');
    await screen.findByText('Hydrated answer');
  });
});
