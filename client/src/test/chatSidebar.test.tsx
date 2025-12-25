import { jest } from '@jest/globals';
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  waitForElementToBeRemoved,
} from '@testing-library/react';
import { useMemo, useState } from 'react';
import ConversationList, {
  type ConversationArchivedFilter,
  type ConversationListItem,
} from '../components/chat/ConversationList';

function Wrapper(params?: {
  bulkArchiveReject?: boolean;
  bulkDeleteSpy?: (ids: string[]) => void;
}) {
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
      conversationId: 'c3',
      title: 'Second conversation',
      provider: 'lmstudio',
      model: 'm1',
      lastMessageAt: '2025-01-03T00:00:00Z',
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
  const [archivedFilter, setArchivedFilter] =
    useState<ConversationArchivedFilter>('active');
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const conversations = useMemo(() => {
    if (archivedFilter === 'all') return allConversations;
    if (archivedFilter === 'archived') {
      return allConversations.filter((c) => c.archived);
    }
    return allConversations.filter((c) => !c.archived);
  }, [allConversations, archivedFilter]);

  const loadMore = async () => {
    setLoading(true);
    setAllConversations((prev) => [
      ...prev,
      {
        conversationId: 'c4',
        title: 'Third conversation',
        provider: 'lmstudio',
        model: 'm1',
        lastMessageAt: '2025-01-03T00:00:00Z',
        archived: false,
      },
    ]);
    setHasMore(false);
    setLoading(false);
  };

  const archive = async (id: string) => {
    setAllConversations((prev) =>
      prev.map((c) => (c.conversationId === id ? { ...c, archived: true } : c)),
    );
  };

  const restore = async (id: string) => {
    setAllConversations((prev) =>
      prev.map((c) =>
        c.conversationId === id ? { ...c, archived: false } : c,
      ),
    );
  };

  const bulkArchive = async (ids: string[]) => {
    if (params?.bulkArchiveReject) {
      throw new Error('Server rejected bulk archive');
    }
    setAllConversations((prev) =>
      prev.map((c) =>
        ids.includes(c.conversationId) ? { ...c, archived: true } : c,
      ),
    );
  };

  const bulkRestore = async (ids: string[]) => {
    setAllConversations((prev) =>
      prev.map((c) =>
        ids.includes(c.conversationId) ? { ...c, archived: false } : c,
      ),
    );
  };

  const bulkDelete = async (ids: string[]) => {
    params?.bulkDeleteSpy?.(ids);
    setAllConversations((prev) =>
      prev.filter((c) => !ids.includes(c.conversationId)),
    );
  };

  return (
    <ConversationList
      conversations={conversations}
      selectedId={selectedId}
      isLoading={loading}
      isError={false}
      error={undefined}
      hasMore={hasMore}
      archivedFilter={archivedFilter}
      disabled={false}
      onSelect={setSelectedId}
      onArchivedFilterChange={setArchivedFilter}
      onArchive={archive}
      onRestore={restore}
      onBulkArchive={bulkArchive}
      onBulkRestore={bulkRestore}
      onBulkDelete={bulkDelete}
      onLoadMore={loadMore}
      onRefresh={() => undefined}
      onRetry={() => undefined}
    />
  );
}

test('conversation list renders and loads more', async () => {
  render(<Wrapper />);

  expect(await screen.findByText('First conversation')).toBeInTheDocument();
  expect(await screen.findByText('Second conversation')).toBeInTheDocument();
  expect(screen.queryByText('Archived conversation')).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId('conversation-load-more'));
  expect(await screen.findByText('Third conversation')).toBeInTheDocument();
});

test('changing filter clears selection', async () => {
  render(<Wrapper />);

  expect(await screen.findByText('First conversation')).toBeInTheDocument();
  const firstCheckboxInput = screen
    .getAllByTestId('conversation-select')[0]
    .querySelector('input');
  if (!firstCheckboxInput) throw new Error('Checkbox input not found');
  fireEvent.click(firstCheckboxInput);
  expect(screen.getByText('1 selected')).toBeInTheDocument();

  const filter = screen.getByTestId('conversation-filter');
  fireEvent.click(within(filter).getByText('Archived'));
  expect(screen.getByText('0 selected')).toBeInTheDocument();
});

test('select-all checkbox supports checked and indeterminate', async () => {
  render(<Wrapper />);

  expect(await screen.findByText('First conversation')).toBeInTheDocument();
  const selectAll = screen
    .getByTestId('conversation-select-all')
    .querySelector('input');
  if (!selectAll) throw new Error('Select-all input not found');

  fireEvent.click(selectAll);
  expect(screen.getByText('2 selected')).toBeInTheDocument();
  expect((selectAll as HTMLInputElement).checked).toBe(true);

  const firstCheckboxInput = screen
    .getAllByTestId('conversation-select')[0]
    .querySelector('input');
  if (!firstCheckboxInput) throw new Error('Checkbox input not found');
  fireEvent.click(firstCheckboxInput);
  expect(screen.getByText('1 selected')).toBeInTheDocument();
  expect((selectAll as HTMLInputElement).checked).toBe(false);
  expect(
    (selectAll as HTMLInputElement).getAttribute('data-indeterminate'),
  ).toBe('true');
});

test('bulk archive success updates list and shows snackbar', async () => {
  render(<Wrapper />);

  expect(await screen.findByText('First conversation')).toBeInTheDocument();
  const firstRowTitle = screen.getByText('First conversation');
  const firstRow = firstRowTitle.closest('[data-testid="conversation-row"]');
  if (!firstRow) throw new Error('Conversation row not found');
  const firstCheckboxInput = within(firstRow)
    .getByTestId('conversation-select')
    .querySelector('input');
  if (!firstCheckboxInput) throw new Error('Checkbox input not found');
  fireEvent.click(firstCheckboxInput);
  fireEvent.click(screen.getByTestId('conversation-bulk-archive'));

  expect(
    await screen.findByText(/Archived 1 conversation/),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText('First conversation')).not.toBeInTheDocument(),
  );
});

test('bulk action rejection leaves UI unchanged and retains selection', async () => {
  render(<Wrapper bulkArchiveReject />);

  expect(await screen.findByText('First conversation')).toBeInTheDocument();
  const firstRowTitle = screen.getByText('First conversation');
  const firstRow = firstRowTitle.closest('[data-testid="conversation-row"]');
  if (!firstRow) throw new Error('Conversation row not found');
  const firstCheckboxInput = within(firstRow)
    .getByTestId('conversation-select')
    .querySelector('input');
  if (!firstCheckboxInput) throw new Error('Checkbox input not found');
  fireEvent.click(firstCheckboxInput);
  fireEvent.click(screen.getByTestId('conversation-bulk-archive'));

  expect(
    await screen.findByText('Server rejected bulk archive'),
  ).toBeInTheDocument();
  expect(screen.getByText('1 selected')).toBeInTheDocument();
  expect(screen.getByText('First conversation')).toBeInTheDocument();
});

test('permanent delete requires explicit confirmation', async () => {
  const bulkDeleteSpy = jest.fn();
  render(<Wrapper bulkDeleteSpy={bulkDeleteSpy} />);

  const filter = screen.getByTestId('conversation-filter');
  fireEvent.click(within(filter).getByText('Archived'));
  expect(await screen.findByText('Archived conversation')).toBeInTheDocument();

  const archivedCheckboxInput = screen
    .getByTestId('conversation-select')
    .querySelector('input');
  if (!archivedCheckboxInput) throw new Error('Checkbox input not found');
  fireEvent.click(archivedCheckboxInput);
  fireEvent.click(screen.getByTestId('conversation-bulk-delete'));

  expect(screen.getByTestId('conversation-delete-dialog')).toBeInTheDocument();
  expect(bulkDeleteSpy).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText('Cancel'));
  await waitForElementToBeRemoved(() =>
    screen.queryByTestId('conversation-delete-dialog'),
  );
  expect(bulkDeleteSpy).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId('conversation-bulk-delete'));
  fireEvent.click(screen.getByTestId('conversation-delete-confirm'));
  expect(bulkDeleteSpy).toHaveBeenCalledWith(['c2']);
});
