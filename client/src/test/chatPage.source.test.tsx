import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import ConversationList, {
  type ConversationListItem,
} from '../components/chat/ConversationList';

const baseProps: ComponentProps<typeof ConversationList> = {
  conversations: [],
  selectedId: undefined,
  isLoading: false,
  isError: false,
  error: undefined,
  hasMore: false,
  filterState: 'active',
  mongoConnected: true,
  disabled: false,
  onSelect: () => undefined,
  onFilterChange: () => undefined,
  onArchive: () => undefined,
  onRestore: () => undefined,
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

    expect(screen.getAllByTestId('conversation-provider-chip')[0]).toHaveTextContent(/lmstudio/i);
    expect(screen.getAllByTestId('conversation-model-chip')[0]).toHaveTextContent(/llama/i);
    expect(screen.getAllByTestId('conversation-source-chip')[0]).toHaveTextContent(/REST/i);
    expect(screen.getAllByTestId('conversation-provider-chip')[1]).toHaveTextContent(/codex/i);
    expect(screen.getAllByTestId('conversation-model-chip')[1]).toHaveTextContent(/gpt/i);
    expect(screen.getAllByTestId('conversation-source-chip')[1]).toHaveTextContent(/MCP/i);
  });
});
