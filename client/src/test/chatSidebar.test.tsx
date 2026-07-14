import { jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import ConversationList, {
  type ConversationListItem,
} from '../components/chat/ConversationList';
import type {
  ConversationBulkResult,
  ConversationFilterState,
} from '../hooks/useConversations';
import { createLogger } from '../logging/logger';
import { setupChatWsHarness } from './support/mockChatWs';

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

type ConversationListProps = Parameters<typeof ConversationList>[0];

const baseConversations: ConversationListItem[] = [
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
];

const logSidebarParityRendered = (params: {
  variant: 'chat' | 'agents';
  filtersVisible: boolean;
  bulkEnabled: boolean;
}) => {
  const log = createLogger('client-test', () => '/test');
  log('info', '0000023 sidebar parity tests rendered', params);
};

const createBaseProps = (
  overrides: Partial<ConversationListProps> = {},
): ConversationListProps => ({
  conversations: baseConversations,
  selectedId: undefined,
  isLoading: false,
  isError: false,
  error: undefined,
  hasMore: false,
  filterState: { active: true, archived: false },
  mongoConnected: true,
  disabled: false,
  onSelect: jest.fn(),
  onFilterChange: jest.fn(),
  onArchive: jest.fn(),
  onRestore: jest.fn(),
  onBulkArchive: async (ids) => makeBulkArchiveResult(ids),
  onBulkRestore: async (ids) => makeBulkArchiveResult(ids),
  onBulkDelete: async (ids) => makeBulkDeleteResult(ids),
  onLoadMore: async () => undefined,
  onRefresh: () => undefined,
  onRetry: () => undefined,
  ...overrides,
});

function rowByTitle(title: string): HTMLElement {
  const titleNode = screen.getByText(title);
  const row = titleNode.closest(
    '[data-testid="conversation-row"]',
  ) as HTMLElement | null;
  if (!row) throw new Error(`Row not found for ${title}`);
  return row;
}

function filterConversations(
  all: ConversationListItem[],
  filterState: ConversationFilterState,
) {
  if (filterState.active && filterState.archived) return all;
  if (filterState.archived) return all.filter((c) => Boolean(c.archived));
  return all.filter((c) => !c.archived);
}

function makeBulkArchiveResult(ids: string[]): ConversationBulkResult {
  return {
    updatedCount: ids.length,
    resolvedConversationIds: ids,
    pendingConversationIds: [],
    outcome: 'full',
  };
}

function makeBulkDeleteResult(ids: string[]): ConversationBulkResult {
  return {
    deletedCount: ids.length,
    resolvedConversationIds: ids,
    pendingConversationIds: [],
    outcome: 'full',
  };
}

describe('ConversationList control gating', () => {
  it('renders a run clue only for legitimate parent and child flow conversations', () => {
    render(
      <ConversationList
        {...createBaseProps({
          conversations: [
            {
              conversationId: 'parent-flow',
              title: 'Flow: daily',
              provider: 'codex',
              model: 'gpt-5',
              lastMessageAt: '2025-01-02T00:00:00Z',
              archived: false,
              flowName: 'daily',
              flags: { flow: { executionId: 'parent01-12345678' } },
            },
            {
              conversationId: 'child-agent',
              title: 'Planner child conversation',
              provider: 'codex',
              model: 'gpt-5',
              lastMessageAt: '2025-01-01T00:00:00Z',
              archived: false,
              flags: { flowChild: { executionId: 'child002-87654321' } },
              agentName: 'planner',
            },
            {
              conversationId: 'ordinary-chat',
              title: 'Ordinary conversation',
              provider: 'lmstudio',
              model: 'm1',
              lastMessageAt: '2025-01-03T00:00:00Z',
              archived: false,
              flags: {
                flow: { executionId: 'staleparent-12345678' },
                flowChild: { executionId: 'stalechild-87654321' },
              },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Run parent01')).toBeInTheDocument();
    expect(screen.getByText('Run child002')).toBeInTheDocument();
    expect(screen.getAllByTestId('conversation-run-chip')).toHaveLength(2);
    expect(
      within(rowByTitle('Ordinary conversation')).queryByTestId(
        'conversation-run-chip',
      ),
    ).toBeNull();
  });

  it('distinguishes a wave parent and repeated target-scoped child flows', () => {
    const onSelect = jest.fn();
    render(
      <ConversationList
        {...createBaseProps({
          onSelect,
          conversations: [
            {
              conversationId: 'wave-parent',
              title: 'Flow: story review',
              provider: 'codex',
              model: 'gpt-5',
              lastMessageAt: '2025-01-03T00:00:00Z',
              archived: false,
              flowName: 'story-review',
              flags: {
                flow: {
                  executionId: 'waveparent-12345678',
                  subflowWaveProgress: {
                    expected: 7,
                    running: 0,
                    completed: 6,
                    failed: 0,
                    stopped: 0,
                    notApplicable: 1,
                  },
                },
              },
            },
            {
              conversationId: 'wave-child-repo-one',
              title: 'Story Review-Artifact Review [repo-one]',
              provider: 'codex',
              model: 'gpt-5',
              lastMessageAt: '2025-01-02T00:00:00Z',
              archived: false,
              flowName: 'artifact-review',
              flags: {
                flow: { executionId: 'childexec-12345678' },
                flowChild: {
                  executionId: 'waveparent-12345678',
                  instanceId: 'target-reviews:0:artifact-review',
                  targetId: 'repo-one',
                  displayName: 'artifact-review [repo-one]',
                },
              },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Wave 7/7')).toBeInTheDocument();
    expect(screen.getAllByText('Run waveparent')).toHaveLength(2);
    expect(screen.getByText('repo-one')).toBeInTheDocument();

    fireEvent.click(rowByTitle('Story Review-Artifact Review [repo-one]'));
    expect(onSelect).toHaveBeenCalledWith('wave-child-repo-one');
  });

  it('renders filters and refresh for agents when handlers are provided', () => {
    render(
      <ConversationList
        {...createBaseProps({
          variant: 'agents',
          onFilterChange: jest.fn(),
          onRefresh: jest.fn(),
        })}
      />,
    );

    expect(
      screen.getByTestId('conversation-filter-active'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('conversation-refresh')).toBeInTheDocument();
  });

  it('hides bulk UI when bulk handlers are not supplied', () => {
    logSidebarParityRendered({
      variant: 'chat',
      filtersVisible: true,
      bulkEnabled: false,
    });

    render(
      <ConversationList
        {...createBaseProps({
          onBulkArchive: undefined,
          onBulkRestore: undefined,
          onBulkDelete: undefined,
        })}
      />,
    );

    expect(screen.queryByTestId('conversation-select-all')).toBeNull();
    expect(screen.queryByTestId('conversation-bulk-archive')).toBeNull();
    expect(screen.queryByTestId('conversation-bulk-restore')).toBeNull();
  });

  it('invokes refresh when the refresh button is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = jest.fn();

    render(
      <ConversationList
        {...createBaseProps({ onRefresh, onFilterChange: jest.fn() })}
      />,
    );

    await user.click(screen.getByTestId('conversation-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onArchive when the archive action is clicked', async () => {
    const user = userEvent.setup();
    const onArchive = jest.fn();

    render(
      <ConversationList
        {...createBaseProps({
          conversations: [baseConversations[0]],
          onArchive,
          onRestore: jest.fn(),
        })}
      />,
    );

    await user.click(screen.getByTestId('conversation-archive'));
    expect(onArchive).toHaveBeenCalledWith('c1');
  });

  it('calls onRestore when the restore action is clicked', async () => {
    const user = userEvent.setup();
    const onRestore = jest.fn();

    render(
      <ConversationList
        {...createBaseProps({
          conversations: [baseConversations[1]],
          onArchive: jest.fn(),
          onRestore,
        })}
      />,
    );

    await user.click(screen.getByTestId('conversation-restore'));
    expect(onRestore).toHaveBeenCalledWith('c2');
  });

  it('freezes sibling sidebar mutations when selectionDisabled is true', () => {
    render(
      <ConversationList
        {...createBaseProps({
          selectionDisabled: true,
          conversations: baseConversations,
        })}
      />,
    );

    expect(screen.getByTestId('conversation-archive')).toBeDisabled();
    expect(screen.getByTestId('conversation-restore')).toBeDisabled();
    expect(screen.getByTestId('conversation-select-all')).toBeDisabled();
    expect(screen.getAllByTestId('conversation-select')).toHaveLength(2);
    for (const checkbox of screen.getAllByTestId('conversation-select')) {
      expect(checkbox).toBeDisabled();
    }
  });

  it('shows the error state and invokes retry', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();

    render(
      <ConversationList
        {...createBaseProps({
          isError: true,
          error: 'Boom',
          onRetry,
        })}
      />,
    );

    expect(screen.getByTestId('conversation-error')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('loads more conversations when pagination is available', async () => {
    const user = userEvent.setup();
    const onLoadMore: () => Promise<void> = jest.fn(async () => undefined);

    render(
      <ConversationList {...createBaseProps({ hasMore: true, onLoadMore })} />,
    );

    await user.click(screen.getByTestId('conversation-load-more'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('disables pagination when there are no more results', () => {
    render(<ConversationList {...createBaseProps({ hasMore: false })} />);

    expect(screen.getByTestId('conversation-load-more')).toBeDisabled();
    expect(screen.getByText('No more')).toBeInTheDocument();
  });
});

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
      const [filterState, setFilterState] = useState<ConversationFilterState>({
        active: true,
        archived: true,
      });

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
          onBulkArchive={async (ids) => makeBulkArchiveResult(ids)}
          onBulkRestore={async (ids) => makeBulkArchiveResult(ids)}
          onBulkDelete={async (ids) => makeBulkDeleteResult(ids)}
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
      const [filterState, setFilterState] = useState<ConversationFilterState>({
        active: true,
        archived: false,
      });

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
            onBulkArchive={async (ids) => makeBulkArchiveResult(ids)}
            onBulkRestore={async (ids) => makeBulkArchiveResult(ids)}
            onBulkDelete={async (ids) => makeBulkDeleteResult(ids)}
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
      const [filterState, setFilterState] = useState<ConversationFilterState>({
        active: true,
        archived: true,
      });

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
          onBulkArchive={async (ids) => makeBulkArchiveResult(ids)}
          onBulkRestore={async (ids) => makeBulkArchiveResult(ids)}
          onBulkDelete={async (ids) => makeBulkDeleteResult(ids)}
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

    await user.click(screen.getByTestId('conversation-filter-active'));
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
    const bulkDelete = jest.fn(async (ids: string[]) =>
      makeBulkDeleteResult(ids),
    );

    function Wrapper() {
      const [filterState, setFilterState] = useState<ConversationFilterState>({
        active: false,
        archived: true,
      });
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
          onBulkArchive={async (ids) => makeBulkArchiveResult(ids)}
          onBulkRestore={async (ids) => makeBulkArchiveResult(ids)}
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

  it('keeps archived bulk-delete confirmation disabled when mutations become unavailable before submit', async () => {
    const user = userEvent.setup();
    const bulkDelete = jest.fn(async (ids: string[]) =>
      makeBulkDeleteResult(ids),
    );

    function Wrapper() {
      const [mongoConnected, setMongoConnected] = useState(true);
      const [filterState, setFilterState] = useState<ConversationFilterState>({
        active: false,
        archived: true,
      });
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
        <>
          <button
            type="button"
            data-testid="disconnect-mongo"
            onClick={() => setMongoConnected(false)}
          >
            Disconnect Mongo
          </button>
          <ConversationList
            conversations={filterConversations(conversations, filterState)}
            selectedId={undefined}
            isLoading={false}
            isError={false}
            error={undefined}
            hasMore={false}
            filterState={filterState}
            mongoConnected={mongoConnected}
            disabled={false}
            onSelect={() => undefined}
            onFilterChange={setFilterState}
            onArchive={() => undefined}
            onRestore={() => undefined}
            onBulkArchive={async (ids) => makeBulkArchiveResult(ids)}
            onBulkRestore={async (ids) => makeBulkArchiveResult(ids)}
            onBulkDelete={bulkDelete}
            onLoadMore={async () => undefined}
            onRefresh={() => undefined}
            onRetry={() => undefined}
          />
        </>
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
      await screen.findByTestId('conversation-delete-confirm'),
    ).toBeEnabled();

    await user.click(screen.getByTestId('disconnect-mongo'));

    await waitFor(() =>
      expect(screen.getByTestId('conversation-delete-confirm')).toBeDisabled(),
    );
    expect(bulkDelete).not.toHaveBeenCalled();
  });

  it('keeps unresolved rows selected after partial bulk archive and excludes confirmed rows from the next request', async () => {
    const user = userEvent.setup();
    const bulkArchive = jest
      .fn<(ids: string[]) => Promise<ConversationBulkResult>>()
      .mockImplementationOnce(async (ids) => ({
        updatedCount: 1,
        resolvedConversationIds: ['c1'],
        pendingConversationIds: ids.filter((id) => id !== 'c1'),
        outcome: 'partial' as const,
      }))
      .mockImplementationOnce(async (ids) => makeBulkArchiveResult(ids));

    function Wrapper() {
      const [conversations, setConversations] = useState<
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
          title: 'Second conversation',
          provider: 'lmstudio',
          model: 'm1',
          lastMessageAt: '2025-01-01T00:00:00Z',
          archived: false,
        },
      ]);
      const [filterState, setFilterState] = useState<ConversationFilterState>({
        active: true,
        archived: true,
      });

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
          onBulkArchive={async (ids) => {
            const result = await bulkArchive(ids);
            setConversations((prev) =>
              prev.map((conversation) =>
                result.resolvedConversationIds.includes(
                  conversation.conversationId,
                )
                  ? { ...conversation, archived: true }
                  : conversation,
              ),
            );
            return result;
          }}
          onBulkRestore={async (ids) => makeBulkArchiveResult(ids)}
          onBulkDelete={async (ids) => makeBulkDeleteResult(ids)}
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
    await user.click(
      within(rowByTitle('Second conversation')).getByTestId(
        'conversation-select',
      ),
    );
    await user.click(screen.getByTestId('conversation-bulk-archive'));

    expect(bulkArchive).toHaveBeenNthCalledWith(1, ['c1', 'c2']);
    expect(
      await screen.findByText('Archived 1 conversations; 1 still pending'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    await user.click(screen.getByTestId('conversation-bulk-archive'));

    expect(bulkArchive).toHaveBeenNthCalledWith(2, ['c2']);
    expect(
      await screen.findByText('Archived 1 conversations'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 selected')).toBeInTheDocument();
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
        filterState={{ active: true, archived: false }}
        mongoConnected={false}
        disabled={false}
        onSelect={() => undefined}
        onFilterChange={() => undefined}
        onArchive={() => undefined}
        onRestore={() => undefined}
        onBulkArchive={async (ids) => makeBulkArchiveResult(ids)}
        onBulkRestore={async (ids) => makeBulkArchiveResult(ids)}
        onBulkDelete={async (ids) => makeBulkDeleteResult(ids)}
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

  it('disables row-level archive and restore actions when mongoConnected is false', () => {
    render(
      <ConversationList
        {...createBaseProps({
          conversations: baseConversations,
          filterState: { active: true, archived: true },
          mongoConnected: false,
        })}
      />,
    );

    expect(screen.getByTestId('conversation-archive')).toBeDisabled();
    expect(screen.getByTestId('conversation-restore')).toBeDisabled();
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
