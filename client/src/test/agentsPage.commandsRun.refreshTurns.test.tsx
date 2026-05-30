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

function okJson(payload: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response);
}

async function selectAgent(name = 'a1') {
  const agentSelect = await screen.findByTestId('agent-select-trigger');
  await userEvent.click(agentSelect);
  const agentPopover = await screen.findByTestId('agent-selector-popover');
  await userEvent.click(within(agentPopover).getByText(name));
  await waitFor(() => expect(agentSelect).toHaveTextContent(name));
}

describe('Agents page - command execute refresh + turns hydration', () => {
  it('clicking Execute calls the command run endpoint with the selected commandName', async () => {
    const user = userEvent.setup();
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
                stepCount: 1,
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
    await user.click(commandSelect);
    const option = await screen.findByTestId(
      'agent-command-option-improve_plan::local',
    );
    await user.click(option);

    const execute = await screen.findByTestId('agent-send');
    await waitFor(() => expect(execute).toBeEnabled());
    await user.click(execute);

    await waitFor(() => expect(runBodies.length).toBe(1));
    expect(runBodies[0]).toMatchObject({ commandName: 'improve_plan' });
    expect(runBodies[0]).not.toHaveProperty('sourceId');
    expect(typeof runBodies[0].conversationId).toBe('string');
    expect((runBodies[0].conversationId as string).length).toBeGreaterThan(0);
  });

  it('includes sourceId when executing an ingested command', async () => {
    const user = userEvent.setup();
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
            commandName: 'build',
            conversationId: 'c-ingest',
            modelId: 'gpt-5.1-codex-max',
          });
        }
        if (target.includes('/agents/a1/commands')) {
          return okJson({
            commands: [
              {
                name: 'build',
                description: 'd',
                disabled: false,
                stepCount: 1,
                sourceId: '/data/repo-a',
                sourceLabel: 'Repo A',
              },
            ],
          });
        }
        if (target.includes('/conversations')) {
          return okJson({ items: [] });
        }
        if (target.includes('/conversations/c-ingest/turns')) {
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
    await user.click(commandSelect);
    const option = await screen.findByTestId(
      'agent-command-option-build::/data/repo-a',
    );
    await user.click(option);

    const execute = await screen.findByTestId('agent-send');
    await waitFor(() => expect(execute).toBeEnabled());
    await user.click(execute);

    await waitFor(() => expect(runBodies.length).toBe(1));
    expect(runBodies[0]).toMatchObject({
      commandName: 'build',
      sourceId: '/data/repo-a',
    });
  });

  it('successful execute refreshes conversations and hydrates turns for the new conversation', async () => {
    const user = userEvent.setup();
    let agentConversationsFetchCount = 0;
    let lastConversationId: string | null = null;

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) return okJson({ mongoConnected: true });

        if (target.includes('/agents') && !target.includes('/commands')) {
          return okJson({ agents: [{ name: 'a1' }] });
        }

        if (target.includes('/agents/a1/commands/run')) {
          expect(init?.method).toBe('POST');
          if (init?.body) {
            const parsed = JSON.parse(init.body.toString()) as Record<
              string,
              unknown
            >;
            lastConversationId =
              typeof parsed.conversationId === 'string'
                ? parsed.conversationId
                : null;
          }
          return okJson({
            agentName: 'a1',
            commandName: 'improve_plan',
            conversationId: lastConversationId ?? 'c2',
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
                stepCount: 1,
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
                      conversationId: lastConversationId ?? 'c2',
                      title: 'New',
                      provider: 'codex',
                      model: 'gpt-5.1-codex-max',
                      lastMessageAt: '2025-01-01T00:00:00.000Z',
                    },
                  ]
                : [],
          });
        }

        if (target.includes('/conversations/') && target.includes('/turns')) {
          const match = target.match(/\/conversations\/([^/]+)\/turns/);
          const conversationId = match?.[1]
            ? decodeURIComponent(match[1])
            : null;
          if (!lastConversationId && conversationId) {
            lastConversationId = conversationId;
          }
          if (!conversationId || conversationId !== lastConversationId) {
            return okJson({ items: [] });
          }
          return okJson({
            items: [
              {
                conversationId: lastConversationId,
                role: 'assistant',
                content: 'Hydrated answer',
                model: 'gpt-5.1-codex-max',
                provider: 'codex',
                status: 'ok',
                createdAt: '2025-01-01T00:00:02.000Z',
              },
              {
                conversationId: lastConversationId,
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
    await user.click(commandSelect);
    const option = await screen.findByTestId(
      'agent-command-option-improve_plan::local',
    );
    await user.click(option);

    const execute = await screen.findByTestId('agent-send');
    await waitFor(() => expect(execute).toBeEnabled());
    await user.click(execute);

    await waitFor(() => expect(lastConversationId).toBeTruthy());

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([callUrl]) =>
          (typeof callUrl === 'string' ? callUrl : callUrl.toString()).includes(
            `/conversations/${String(lastConversationId)}/turns`,
          ),
        ),
      ).toBe(true),
    );

    await screen.findByText('Hydrated question');
    await screen.findByText('Hydrated answer');
  });

  it('keeps the accepted agent conversation selected when the follow-up refresh fails', async () => {
    const user = userEvent.setup();
    let agentConversationsFetchCount = 0;
    const acceptedConversationId = 'c-accepted-1';
    const now = '2025-01-01T00:00:00.000Z';

    mockFetch.mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();

        if (target.includes('/health')) return okJson({ mongoConnected: true });
        if (target.includes('/agents') && !target.includes('/commands')) {
          return okJson({ agents: [{ name: 'a1' }] });
        }
        if (target.includes('/agents/a1/commands/run')) {
          if (init?.body) {
            const parsed = JSON.parse(init.body.toString()) as Record<
              string,
              unknown
            >;
            expect(parsed.conversationId).toBeDefined();
          }
          return okJson({
            status: 'started',
            agentName: 'a1',
            commandName: 'improve_plan',
            conversationId: acceptedConversationId,
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
                stepCount: 1,
              },
            ],
          });
        }
        if (target.includes('/conversations/') && target.includes('/turns')) {
          const match = target.match(/\/conversations\/([^/]+)\/turns/);
          const conversationId = match?.[1]
            ? decodeURIComponent(match[1])
            : null;
          if (conversationId === 'c1') {
            return okJson({
              items: [
                {
                  conversationId: 'c1',
                  role: 'assistant',
                  content: 'Original agent answer',
                  model: 'gpt-5.1-codex-max',
                  provider: 'codex',
                  status: 'ok',
                  createdAt: now,
                },
              ],
            });
          }
          if (conversationId !== acceptedConversationId) {
            return okJson({ items: [] });
          }
          return okJson({
            items: [
              {
                conversationId: acceptedConversationId,
                role: 'assistant',
                content: 'Accepted agent answer',
                model: 'gpt-5.1-codex-max',
                provider: 'codex',
                status: 'ok',
                createdAt: now,
              },
            ],
          });
        }
        if (target.includes('/conversations') && !target.includes('/turns')) {
          agentConversationsFetchCount += 1;
          if (agentConversationsFetchCount >= 2) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  error: 'conversation refresh failed',
                }),
                {
                  status: 500,
                  headers: { 'content-type': 'application/json' },
                },
              ),
            );
          }
          return okJson({
            items: [
              {
                conversationId: 'c1',
                title: 'Initial',
                provider: 'codex',
                model: 'gpt-5.1-codex-max',
                lastMessageAt: now,
                agentName: 'a1',
              },
            ],
          });
        }
        return okJson({});
      },
    );

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await selectAgent('a1');

    const commandSelect = await screen.findByRole('combobox', {
      name: /command/i,
    });
    await waitFor(() => expect(commandSelect).toBeEnabled());
    await user.click(commandSelect);
    const option = await screen.findByTestId(
      'agent-command-option-improve_plan::local',
    );
    await user.click(option);

    const execute = await screen.findByTestId('agent-send');
    await waitFor(() => expect(execute).toBeEnabled());
    await user.click(execute);

    await waitFor(() =>
      expect(screen.queryByTestId('agents-run-error')).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText('Accepted agent answer'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('conversation-error')).toBeInTheDocument(),
    );
  });
});
