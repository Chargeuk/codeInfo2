import { jest } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { createLogger } from '../logging/logger';

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

const routes = [
  {
    path: '/',
    element: <App />,
    children: [{ path: 'agents', element: <AgentsPage /> }],
  },
];

const baseConversations = [
  {
    conversationId: 'c1',
    title: 'Active conversation',
    provider: 'codex',
    model: 'gpt-5.6-terra',
    lastMessageAt: '2025-01-02T00:00:00.000Z',
    archived: false,
    agentName: 'a1',
  },
  {
    conversationId: 'c2',
    title: 'Archived conversation',
    provider: 'codex',
    model: 'gpt-5.6-terra',
    lastMessageAt: '2025-01-01T00:00:00.000Z',
    archived: true,
    agentName: 'a1',
  },
];

const logSidebarParityRendered = (params: {
  variant: 'chat' | 'agents';
  filtersVisible: boolean;
  bulkEnabled: boolean;
}) => {
  const log = createLogger('client-test', () => '/test');
  log('info', '0000023 sidebar parity tests rendered', params);
};

function mockJsonResponse(payload: unknown, init?: { status?: number }) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function mockAgentsFetch(params?: {
  mongoConnected?: boolean;
  conversations?: typeof baseConversations;
}) {
  const mongoConnected = params?.mongoConnected ?? true;
  const conversations = params?.conversations ?? baseConversations;

  mockFetch.mockImplementation((url: RequestInfo | URL) => {
    const target = typeof url === 'string' ? url : url.toString();

    if (target.includes('/health')) {
      return mockJsonResponse({ mongoConnected });
    }

    if (target.includes('/agents') && !target.includes('/commands')) {
      return mockJsonResponse({ agents: [{ name: 'a1' }] });
    }

    if (target.includes('/agents/a1/commands')) {
      return mockJsonResponse({ commands: [] });
    }

    if (target.includes('/conversations/bulk/')) {
      if (target.includes('/delete')) {
        return mockJsonResponse({ status: 'ok', deletedCount: 1 });
      }
      return mockJsonResponse({ status: 'ok', updatedCount: 1 });
    }

    if (target.includes('/conversations/') && target.includes('/archive')) {
      return mockJsonResponse({ status: 'ok' });
    }

    if (target.includes('/conversations/') && target.includes('/restore')) {
      return mockJsonResponse({ status: 'ok' });
    }

    if (target.includes('/conversations') && target.includes('agentName=')) {
      return mockJsonResponse({ items: conversations, nextCursor: null });
    }

    if (target.includes('/conversations/')) {
      return mockJsonResponse({ items: [] });
    }

    return mockJsonResponse({});
  });
}

describe('AgentsPage sidebar actions', () => {
  it('renders filter tabs and toggles selection', async () => {
    const user = userEvent.setup();
    mockAgentsFetch();
    logSidebarParityRendered({
      variant: 'agents',
      filtersVisible: true,
      bulkEnabled: true,
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agents-page');

    const activeButton = screen.getByTestId('conversation-filter-active');
    expect(activeButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('conversation-filter-archived'));
    await waitFor(() =>
      expect(
        screen.getByTestId('conversation-filter-archived'),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('enables bulk archive/restore based on selection', async () => {
    const user = userEvent.setup();
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Active conversation');

    await user.click(screen.getAllByTestId('conversation-select')[0]);
    expect(screen.getByTestId('conversation-bulk-archive')).toBeEnabled();
    expect(screen.getByTestId('conversation-bulk-restore')).toBeDisabled();

    await user.click(screen.getByTestId('conversation-filter-archived'));
    await user.click(screen.getByTestId('conversation-filter-active'));
    await screen.findByText('Archived conversation');
    await user.click(
      screen
        .getAllByTestId('conversation-select')
        .find((checkbox) =>
          checkbox
            .closest('[data-testid="conversation-row"]')
            ?.textContent?.includes('Archived conversation'),
        )!,
    );
    expect(screen.getByTestId('conversation-bulk-restore')).toBeEnabled();
  });

  it('shows bulk delete only for archived filter', async () => {
    const user = userEvent.setup();
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Active conversation');

    expect(screen.queryByTestId('conversation-bulk-delete')).toBeNull();

    await user.click(screen.getByTestId('conversation-filter-archived'));
    await user.click(screen.getByTestId('conversation-filter-active'));
    await waitFor(() =>
      expect(
        screen.getByTestId('conversation-bulk-delete'),
      ).toBeInTheDocument(),
    );
  });

  it('renders archive and restore row actions for active and archived rows', async () => {
    const user = userEvent.setup();
    mockAgentsFetch();

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByText('Active conversation');

    await user.click(
      screen.getByRole('button', { name: 'Conversation actions' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'Archive conversation' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByTestId('conversation-filter-archived'));
    await user.click(screen.getByTestId('conversation-filter-active'));
    await screen.findByText('Archived conversation');
    await user.click(
      screen.getByRole('button', { name: 'Conversation actions' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'Restore conversation' }),
    ).toBeInTheDocument();
  });

  it('disables controls when persistence is unavailable', async () => {
    mockAgentsFetch({ mongoConnected: false });

    const router = createMemoryRouter(routes, { initialEntries: ['/agents'] });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('agents-page');
    await waitFor(() => {
      expect(screen.getByTestId('conversation-filter-active')).toBeDisabled();
      expect(screen.getByTestId('conversation-refresh')).toBeDisabled();
    });
  });
});

describe('estimated fork history notice', () => {
  it.each(['conversation', 'agent', 'new chat'])(
    'does not follow navigation to another %s',
    async (navigation) => {
      const user = userEvent.setup();
      mockAgentsFetch();
      const ordinaryFetch = mockFetch.getMockImplementation()!;
      let created = false;
      mockFetch.mockImplementation((url, options) => {
        const target = typeof url === 'string' ? url : url.toString();
        if (target.includes('/fork-options'))
          return mockJsonResponse({
            sourceTitle: 'Active conversation',
            sourceAgentName: 'a1',
            sourceTurnId: 'answer',
            estimated: true,
            agents: [{ name: 'a1', sameAgent: true }],
          });
        if (target.endsWith('/fork')) {
          created = true;
          return mockJsonResponse({
            conversationId: 'estimated-fork',
            agentName: 'a1',
            model: 'gpt-5.6-terra',
            estimated: true,
          });
        }
        if (/\/agents$/.test(target))
          return mockJsonResponse({ agents: [{ name: 'a1' }, { name: 'a2' }] });
        if (/\/agents\/a[12]$/.test(target))
          return mockJsonResponse({
            agent: {
              name: target.endsWith('a2') ? 'a2' : 'a1',
              disabled: false,
              warnings: [],
            },
          });
        if (target.includes('/conversations') && target.includes('agentName='))
          return mockJsonResponse({
            items:
              new URL(target).searchParams.get('agentName') === 'a1'
                ? [
                    baseConversations[0],
                    ...(created
                      ? [
                          {
                            ...baseConversations[0],
                            conversationId: 'estimated-fork',
                            title: 'Estimated fork',
                          },
                        ]
                      : []),
                  ]
                : [],
            nextCursor: null,
          });
        return ordinaryFetch(url, options);
      });
      const router = createMemoryRouter(routes, {
        initialEntries: ['/agents'],
      });
      render(<RouterProvider router={router} />);
      await screen.findByText('Active conversation');
      const conversationActions = () => {
        const row = screen
          .getByText('Active conversation')
          .closest('[data-testid="conversation-row"]') as HTMLElement;
        return within(row).getByRole('button', {
          name: /^Conversation actions$/,
        });
      };
      // Row text can arrive before health/agent loading enables its actions.
      // Requery after list readiness so the click cannot target a replaced row.
      await waitFor(() => {
        expect(screen.queryByTestId('conversation-loading')).toBeNull();
        expect(conversationActions()).toBeEnabled();
      });
      // The open modal hides background roles; retain the enabled trigger
      // rather than querying it through the accessibility tree after opening.
      const actions = conversationActions();
      await user.click(actions);
      const menu = await screen.findByRole('menu');
      await waitFor(() => {
        expect(actions).toHaveAttribute('aria-expanded', 'true');
        expect(menu).toBeVisible();
      });
      await user.click(
        within(menu).getByRole('menuitem', { name: 'Fork conversation...' }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Fork conversation',
      });
      await waitFor(() => expect(menu).not.toBeInTheDocument());
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Create fork' }),
        ).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: 'Create fork' }));
      const notice =
        'This fork used an estimated match to older provider history.';
      // Wait for modal teardown before navigating the restored page controls.
      await waitFor(() => {
        expect(dialog).not.toBeInTheDocument();
        expect(screen.getByText(notice)).toBeVisible();
      });
      if (navigation === 'conversation') {
        await user.click(await screen.findByText('Active conversation'));
      } else if (navigation === 'agent') {
        await user.click(screen.getByTestId('agent-select-trigger'));
        await user.click(
          await within(screen.getByTestId('agent-selector-popover')).findByText(
            'a2',
          ),
        );
      } else {
        await user.click(screen.getByTestId('agent-new-conversation-trigger'));
      }
      await waitFor(() => expect(screen.queryByText(notice)).toBeNull());
    },
  );
});
