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
  filterState: { active: true, archived: false },
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
  it('shows provider icons plus REST default and MCP source labels without a redundant provider chip', () => {
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

    const providerIcons = screen
      .getAllByTestId('conversation-provider-icon')
      .map((n) => n.getAttribute('aria-label') || '');
    const models = screen
      .getAllByTestId('conversation-model-chip')
      .map((n) => n.textContent || '');
    const sources = screen
      .getAllByTestId('conversation-source-chip')
      .map((n) => n.textContent || '');

    expect(providerIcons.some((p) => /lm\s*studio/i.test(p))).toBe(true);
    expect(providerIcons.some((p) => /codex/i.test(p))).toBe(true);
    expect(screen.queryByTestId('conversation-provider-chip')).toBeNull();

    expect(models.some((m) => /llama/i.test(m))).toBe(true);
    expect(models.some((m) => /gpt/i.test(m))).toBe(true);

    expect(sources.some((s) => /REST/i.test(s))).toBe(true);
    expect(sources.some((s) => /MCP/i.test(s))).toBe(true);
  });
});
