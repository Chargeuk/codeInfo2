import { jest } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import ConversationList, {
  type ConversationListItem,
} from '../components/chat/ConversationList';
import type { ConversationFilterState } from '../hooks/useConversations';
import { setupChatWsHarness } from './support/mockChatWs';

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
const { default: ChatPage } = await import('../pages/ChatPage');
const { default: HomePage } = await import('../pages/HomePage');

const chatRoutes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'chat', element: <ChatPage /> },
    ],
  },
];

function rowByTitle(title: string) {
  const titleNode = screen.getByText(title);
  const row = titleNode.closest('[data-testid="conversation-row"]');
  if (!row) throw new Error(`Row not found for ${title}`);
  return row;
}

function filterConversations(
  all: ConversationListItem[],
  filterState: ConversationFilterState,
) {
  return all.filter((c) => {
    if (filterState === 'all') return true;
    if (filterState === 'archived') return Boolean(c.archived);
    return !c.archived;
  });
}

describe('Chat sidebar bulk selection (ConversationList)', () => {
  it('clears selection when the user changes the filter', async () => {
    const user = userEvent.setup();

    function Wrapper() {
      const [allConversations, setAllConversations] = useState<
        ConversationListItem[]
      >([
        {
          conversationId: 'c1',
          title: 'First conversation',
          provider: 'lmstudio',
          model: 'm1',
          lastMessageAt: '2025-01-02T00:00:00Z',
          archived: false,
        },
        {
          conversationId: 'c2',
          title: 'Archived conversation',
          provider: 'lmstudio',
          model: 'm1',
          lastMessageAt: '2025-01-01T00:00:00Z',
          archived: true,
        },
      ]);
      const [filterState, setFilterState] =
        useState<ConversationFilterState>('all');

      return (
        <ConversationList
          conversations={filterConversations(allConversations, filterState)}
          selectedId={undefined}
          isLoading={false}
          isError={false}
          error={undefined}
          hasMore={false}
          filterState={filterState}
          mongoConnected={true}
          disabled={false}
          onSelect={() => undefined}
          onFilterChange={setFilterState}
          onArchive={() => undefined}
          onRestore={() => undefined}
          onBulkArchive={async (ids) => ({ updatedCount: ids.length })}
          onBulkRestore={async (ids) => ({ updatedCount: ids.length })}
          onBulkDelete={async (ids) => ({ deletedCount: ids.length })}
          onLoadMore={async () => {
            setAllConversations((prev) => [...prev]);
          }}
          onRefresh={() => undefined}
          onRetry={() => undefined}
        />
      );
    }

    render(<Wrapper />);

    const row = rowByTitle('First conversation');
    await user.click(within(row).getByTestId('conversation-select'));

    expect(screen.getByText('1 selected')).toBeInTheDocument();

    await user.click(screen.getByTestId('conversation-filter-archived'));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('keeps selection stable when the list reorders due to updates', async () => {
    const user = userEvent.setup();

    function Wrapper() {
      const [allConversations, setAllConversations] = useState<
        ConversationListItem[]
      >([
        {
          conversationId: 'c1',
          title: 'First conversation',
          provider: 'lmstudio',
          model: 'm1',
          lastMessageAt: '2025-01-01T00:00:00Z',
          archived: false,
        },
        {
          conversationId: 'c2',
          title: 'Second conversation',
          provider: 'lmstudio',
          model: 'm1',
          lastMessageAt: '2025-01-02T00:00:00Z',
          archived: false,
        },
      ]);
      const [filterState, setFilterState] =
        useState<ConversationFilterState>('active');

      return (
        <>
          <button
            type="button"
            data-testid="reorder"
            onClick={() => {
              setAllConversations((prev) =>
                prev.map((c) =>
                  c.conversationId === 'c1'
                    ? { ...c, lastMessageAt: '2025-01-03T00:00:00Z' }
                    : c,
                ),
              );
            }}
          >
            Reorder
          </button>
          <ConversationList
            conversations={filterConversations(allConversations, filterState)}
            selectedId={undefined}
            isLoading={false}
            isError={false}
            error={undefined}
            hasMore={false}
            filterState={filterState}
            mongoConnected={true}
            disabled={false}
            onSelect={() => undefined}
            onFilterChange={setFilterState}
            onArchive={() => undefined}
            onRestore={() => undefined}
            onBulkArchive={async (ids) => ({ updatedCount: ids.length })}
            onBulkRestore={async (ids) => ({ updatedCount: ids.length })}
            onBulkDelete={async (ids) => ({ deletedCount: ids.length })}
            onLoadMore={async () => undefined}
            onRefresh={() => undefined}
            onRetry={() => undefined}
          />
        </>
      );
    }

    render(<Wrapper />);

    const row = rowByTitle('First conversation');
    const checkbox = within(row).getByTestId('conversation-select');
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(screen.getByTestId('reorder'));

    expect(
      within(rowByTitle('First conversation')).getByTestId(
        'conversation-select',
      ),
    ).toBeChecked();
  });

  it('shows the correct bulk buttons per filter state and select-all reflects indeterminate', async () => {
    const user = userEvent.setup();

    function Wrapper() {
      const [allConversations] = useState<ConversationListItem[]>([
        {
          conversationId: 'c1',
          title: 'First conversation',
          provider: 'lmstudio',
          model: 'm1',
          lastMessageAt: '2025-01-02T00:00:00Z',
          archived: false,
        },
        {
          conversationId: 'c2',
          title: 'Archived conversation',
          provider: 'lmstudio',
          model: 'm1',
          lastMessageAt: '2025-01-01T00:00:00Z',
          archived: true,
        },
      ]);
      const [filterState, setFilterState] =
        useState<ConversationFilterState>('all');

      return (
        <ConversationList
          conversations={filterConversations(allConversations, filterState)}
          selectedId={undefined}
          isLoading={false}
          isError={false}
          error={undefined}
          hasMore={false}
          filterState={filterState}
          mongoConnected={true}
          disabled={false}
          onSelect={() => undefined}
          onFilterChange={setFilterState}
          onArchive={() => undefined}
          onRestore={() => undefined}
          onBulkArchive={async (ids) => ({ updatedCount: ids.length })}
          onBulkRestore={async (ids) => ({ updatedCount: ids.length })}
          onBulkDelete={async (ids) => ({ deletedCount: ids.length })}
          onLoadMore={async () => undefined}
          onRefresh={() => undefined}
          onRetry={() => undefined}
        />
      );
    }

    render(<Wrapper />);

    await user.click(
      within(rowByTitle('First conversation')).getByTestId(
        'conversation-select',
      ),
    );

    const selectAll = screen.getByTestId('conversation-select-all');
    expect(selectAll).toHaveAttribute('data-indeterminate', 'true');

    expect(screen.getByTestId('conversation-bulk-archive')).toBeEnabled();
    expect(screen.queryByTestId('conversation-bulk-delete')).toBeNull();

    await user.click(screen.getByTestId('conversation-filter-archived'));
    await waitFor(() =>
      expect(
        screen.getByTestId('conversation-bulk-restore'),
      ).toBeInTheDocument(),
    );

    await user.click(
      within(rowByTitle('Archived conversation')).getByTestId(
        'conversation-select',
      ),
    );
    expect(screen.getByTestId('conversation-bulk-restore')).toBeEnabled();
    expect(screen.getByTestId('conversation-bulk-delete')).toBeEnabled();
  });

  it('requires confirmation before permanently deleting conversations', async () => {
    const user = userEvent.setup();
    const bulkDelete = jest.fn(async (ids: string[]) => ({
      deletedCount: ids.length,
    }));

    function Wrapper() {
      const [filterState, setFilterState] =
        useState<ConversationFilterState>('archived');
      const conversations: ConversationListItem[] = [
        {
          conversationId: 'c1',
          title: 'Archived conversation',
          provider: 'lmstudio',
          model: 'm1',
          lastMessageAt: '2025-01-01T00:00:00Z',
          archived: true,
        },
      ];

      return (
        <ConversationList
          conversations={filterConversations(conversations, filterState)}
          selectedId={undefined}
          isLoading={false}
          isError={false}
          error={undefined}
          hasMore={false}
          filterState={filterState}
          mongoConnected={true}
          disabled={false}
          onSelect={() => undefined}
          onFilterChange={setFilterState}
          onArchive={() => undefined}
          onRestore={() => undefined}
          onBulkArchive={async (ids) => ({ updatedCount: ids.length })}
          onBulkRestore={async (ids) => ({ updatedCount: ids.length })}
          onBulkDelete={bulkDelete}
          onLoadMore={async () => undefined}
          onRefresh={() => undefined}
          onRetry={() => undefined}
        />
      );
    }

    render(<Wrapper />);

    await user.click(
      within(rowByTitle('Archived conversation')).getByTestId(
        'conversation-select',
      ),
    );
    await user.click(screen.getByTestId('conversation-bulk-delete'));

    expect(
      await screen.findByText(/permanently delete conversations\?/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(bulkDelete).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('conversation-bulk-delete'));
    await user.click(screen.getByTestId('conversation-delete-confirm'));
    await waitFor(() => expect(bulkDelete).toHaveBeenCalledTimes(1));
  });

  it('disables bulk actions when mongoConnected is false and explains why', async () => {
    render(
      <ConversationList
        conversations={[
          {
            conversationId: 'c1',
            title: 'First conversation',
            provider: 'lmstudio',
            model: 'm1',
            lastMessageAt: '2025-01-02T00:00:00Z',
            archived: false,
          },
        ]}
        selectedId={undefined}
        isLoading={false}
        isError={false}
        error={undefined}
        hasMore={false}
        filterState="active"
        mongoConnected={false}
        disabled={false}
        onSelect={() => undefined}
        onFilterChange={() => undefined}
        onArchive={() => undefined}
        onRestore={() => undefined}
        onBulkArchive={async (ids) => ({ updatedCount: ids.length })}
        onBulkRestore={async (ids) => ({ updatedCount: ids.length })}
        onBulkDelete={async (ids) => ({ deletedCount: ids.length })}
        onLoadMore={async () => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(
      screen.getByText(/bulk actions disabled \(mongo disconnected\)/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('conversation-select-all')).toBeDisabled();
    expect(screen.getByTestId('conversation-select')).toBeDisabled();
  });
});

describe('Chat sidebar WS upserts (ChatPage)', () => {
  it('ignores conversation_upsert events for agent conversations', async () => {
    const harness = setupChatWsHarness({
      mockFetch,
      conversations: { items: [], nextCursor: null },
    });

    const router = createMemoryRouter(chatRoutes, {
      initialEntries: ['/chat'],
    });
    render(<RouterProvider router={router} />);

    await screen.findByTestId('conversation-empty');

    harness.emitSidebarUpsert({
      conversationId: 'agent-1',
      title: 'Agent conversation',
      provider: 'codex',
      model: 'gpt-5.2',
      source: 'REST',
      lastMessageAt: '2025-01-01T00:00:00.000Z',
      archived: false,
      agentName: 'coding_agent',
    });

    expect(screen.queryByText('Agent conversation')).toBeNull();
  });
});
