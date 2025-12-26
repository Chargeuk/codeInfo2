import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import ConversationList, {
  type ConversationListItem,
} from '../components/chat/ConversationList';

function Wrapper() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([
    {
      conversationId: 'c1',
      title: 'First conversation',
      provider: 'lmstudio',
      model: 'm1',
      lastMessageAt: '2025-01-02T00:00:00Z',
      archived: false,
    },
  ]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const loadMore = async () => {
    setLoading(true);
    setConversations((prev) => [
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
    setConversations((prev) =>
      prev.map((c) => (c.conversationId === id ? { ...c, archived: true } : c)),
    );
  };

  const restore = (id: string) => {
    setConversations((prev) =>
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
      includeArchived={includeArchived}
      disabled={false}
      onSelect={setSelected}
      onToggleArchived={setIncludeArchived}
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
  expect(
    await screen.findByTestId('conversation-archived-chip'),
  ).toBeInTheDocument();

  const toggle = screen.getByTestId('conversation-archived-toggle');
  fireEvent.click(toggle);
  fireEvent.click(screen.getByTestId('conversation-restore'));
  expect(
    screen.queryByTestId('conversation-archived-chip'),
  ).not.toBeInTheDocument();
});
