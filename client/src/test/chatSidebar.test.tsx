import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import ConversationList, {
  type ConversationListItem,
} from '../components/chat/ConversationList';
import type { ConversationFilterState } from '../hooks/useConversations';

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
  ]);
  const [filterState, setFilterState] =
    useState<ConversationFilterState>('active');
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const conversations = allConversations.filter((c) => {
    if (filterState === 'all') return true;
    if (filterState === 'archived') return Boolean(c.archived);
    return !c.archived;
  });

  const loadMore = async () => {
    setLoading(true);
    setAllConversations((prev) => [
      ...prev,
      {
        conversationId: 'c2',
        title: 'Second conversation',
        provider: 'lmstudio',
        model: 'm1',
        lastMessageAt: '2025-01-01T00:00:00Z',
        archived: false,
      },
    ]);
    setHasMore(false);
    setLoading(false);
  };

  const archive = (id: string) => {
    setAllConversations((prev) =>
      prev.map((c) => (c.conversationId === id ? { ...c, archived: true } : c)),
    );
  };

  const restore = (id: string) => {
    setAllConversations((prev) =>
      prev.map((c) =>
        c.conversationId === id ? { ...c, archived: false } : c,
      ),
    );
  };

  return (
    <ConversationList
      conversations={conversations}
      selectedId={selected}
      isLoading={loading}
      isError={false}
      error={undefined}
      hasMore={hasMore}
      filterState={filterState}
      disabled={false}
      onSelect={setSelected}
      onFilterChange={setFilterState}
      onArchive={archive}
      onRestore={restore}
      onLoadMore={loadMore}
      onRefresh={() => undefined}
      onRetry={() => undefined}
    />
  );
}

test('conversation list renders, loads more, and archives/restores', async () => {
  render(<Wrapper />);

  expect(await screen.findByText('First conversation')).toBeInTheDocument();

  fireEvent.click(screen.getByTestId('conversation-load-more'));
  expect(await screen.findByText('Second conversation')).toBeInTheDocument();

  fireEvent.click(screen.getAllByTestId('conversation-archive')[0]);

  fireEvent.click(screen.getByTestId('conversation-filter-all'));
  expect(
    await screen.findByTestId('conversation-archived-chip'),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByTestId('conversation-filter-active'));
  expect(screen.queryByText('First conversation')).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId('conversation-filter-archived'));
  fireEvent.click(screen.getByTestId('conversation-restore'));
  fireEvent.click(screen.getByTestId('conversation-filter-active'));
  expect(await screen.findByText('First conversation')).toBeInTheDocument();
});
