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

    const providers = screen.getAllByTestId('conversation-provider-chip').map((n) => n.textContent || '');
    const models = screen.getAllByTestId('conversation-model-chip').map((n) => n.textContent || '');
    const sources = screen.getAllByTestId('conversation-source-chip').map((n) => n.textContent || '');

    expect(providers.some((p) => /lm\s*studio/i.test(p))).toBe(true);
    expect(providers.some((p) => /codex/i.test(p))).toBe(true);

    expect(models.some((m) => /llama/i.test(m))).toBe(true);
    expect(models.some((m) => /gpt/i.test(m))).toBe(true);

    expect(sources.some((s) => /REST/i.test(s))).toBe(true);
    expect(sources.some((s) => /MCP/i.test(s))).toBe(true);
  });
});
