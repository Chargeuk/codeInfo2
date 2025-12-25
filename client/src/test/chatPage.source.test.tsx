import { render, screen } from '@testing-library/react';
import ConversationList, {
  type ConversationListItem,
} from '../components/chat/ConversationList';

const baseProps = {
  selectedId: undefined,
  isLoading: false,
  isError: false,
  error: undefined,
  hasMore: false,
  archivedFilter: 'active' as const,
  disabled: false,
  onSelect: () => undefined,
  onArchivedFilterChange: () => undefined,
  onArchive: () => undefined,
  onRestore: () => undefined,
  onBulkArchive: async () => undefined,
  onBulkRestore: async () => undefined,
  onBulkDelete: async () => undefined,
  onLoadMore: async () => undefined,
  onRefresh: () => undefined,
  onRetry: () => undefined,
};

describe('ConversationList source badges', () => {
  it('shows REST default and MCP source labels', () => {
    const conversations: ConversationListItem[] = [
      {
        conversationId: 'c1',
        title: 'REST convo',
        provider: 'lmstudio',
        model: 'llama',
        lastMessageAt: '2025-01-01T00:00:00.000Z',
      },
      {
        conversationId: 'c2',
        title: 'MCP convo',
        provider: 'codex',
        model: 'gpt',
        source: 'MCP',
        lastMessageAt: '2025-01-02T00:00:00.000Z',
      },
    ];

    render(<ConversationList {...baseProps} conversations={conversations} />);

    expect(screen.getByText(/lmstudio · llama · REST/i)).toBeInTheDocument();
    expect(screen.getByText(/codex · gpt · MCP/i)).toBeInTheDocument();
  });
});
