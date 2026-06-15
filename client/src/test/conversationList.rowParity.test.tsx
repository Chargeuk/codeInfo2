import { jest } from '@jest/globals';
import { act, render, screen, within } from '@testing-library/react';

const noopLogger = jest.fn();

await jest.unstable_mockModule('../logging/logger', async () => ({
  createLogger: jest.fn(() => noopLogger),
}));

const { default: ConversationList } = await import(
  '../components/chat/ConversationList'
);
const {
  formatConversationRowTimestamp,
  getConversationModelPresentation,
  getConversationProviderPresentation,
} = await import('../components/chat/conversationRowFormatting');

describe('Conversation row parity', () => {
  beforeEach(() => {
    noopLogger.mockReset();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-23T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the shared row hierarchy with provider icon, two-line title, model/source chips, timestamp, and archive action', () => {
    render(
      <ConversationList
        conversations={[
          {
            conversationId: 'row-1',
            title: 'Rework flow rerun semantics',
            provider: 'codex',
            model: 'gpt-4.1',
            source: 'MCP',
            lastMessageAt: '2026-03-23T10:15:00.000Z',
            previewUserText: 'Update step gating and retry behavior.',
          },
          {
            conversationId: 'row-2',
            title: 'Copilot provider fallback rules',
            provider: '',
            model: 'codex-preview',
            source: 'REST',
            lastMessageAt: '2026-03-23T09:30:00.000Z',
            previewAssistantSummary:
              'Verify Copilot availability and health across environments.',
            archived: true,
          },
          {
            conversationId: 'row-3',
            title: 'Runtime fallback coverage',
            provider: '',
            model: 'mystery-model',
            source: 'REST',
            lastMessageAt: '2026-03-20T09:00:00.000Z',
            archived: false,
          },
        ]}
        selectedId="row-1"
        isLoading={false}
        isError={false}
        hasMore={false}
        filterState={{ active: true, archived: false }}
        onSelect={() => {}}
        onFilterChange={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        onLoadMore={() => {}}
        onRefresh={() => {}}
        onRetry={() => {}}
      />,
    );

    const rows = screen.getAllByTestId('conversation-row');
    expect(rows).toHaveLength(3);

    const firstRow = within(rows[0]);
    expect(firstRow.getByTestId('conversation-provider-icon')).toBeVisible();
    expect(firstRow.getByTestId('conversation-title')).toHaveTextContent(
      'Rework flow rerun semantics',
    );
    expect(firstRow.queryByTestId('conversation-preview')).toBeNull();
    expect(firstRow.queryByTestId('conversation-provider-chip')).toBeNull();
    expect(firstRow.getByTestId('conversation-model-chip')).toHaveTextContent(
      'gpt-4.1',
    );
    expect(firstRow.getByTestId('conversation-source-chip')).toHaveTextContent(
      'MCP',
    );
    expect(firstRow.getByTestId('conversation-updated')).toHaveTextContent(
      '2 hours ago',
    );
    expect(window.getComputedStyle(rows[0]).backgroundColor).toBe(
      'rgb(231, 237, 245)',
    );
    expect(screen.getAllByTestId('conversation-archive')[0]).toBeVisible();

    const archivedRow = within(rows[1]);
    expect(archivedRow.queryByTestId('conversation-preview')).toBeNull();
    expect(
      archivedRow.getByTestId('conversation-provider-icon'),
    ).toHaveAttribute('aria-label', 'Codex provider icon');
    expect(screen.getAllByTestId('conversation-restore')[0]).toBeVisible();
    expect(archivedRow.queryByTestId('conversation-provider-chip')).toBeNull();

    const runtimeRow = within(rows[2]);
    expect(
      runtimeRow.getByTestId('conversation-provider-icon'),
    ).toHaveAttribute('aria-label', 'Runtime provider icon');
    expect(runtimeRow.queryByTestId('conversation-preview')).toBeNull();
  });

  it('falls back through provider helpers without source-control branding', () => {
    expect(getConversationProviderPresentation('codex').label).toBe('Codex');
    expect(getConversationProviderPresentation('copilot').label).toBe(
      'Copilot',
    );
    expect(getConversationProviderPresentation('lmstudio').label).toBe(
      'LM Studio',
    );
    expect(
      getConversationProviderPresentation(undefined, 'codex-mini').label,
    ).toBe('Codex');
    expect(getConversationProviderPresentation(undefined).label).toBe(
      'Runtime',
    );
  });

  it('maps common OpenRouter and local model families onto model icons by model identity, not only prefix position', () => {
    expect(
      getConversationModelPresentation('codex', 'gpt-5.3-codex').label,
    ).toBe('Codex');
    expect(
      getConversationModelPresentation('copilot', 'anthropic/claude-3.7-sonnet')
        .label,
    ).toBe('Claude');
    expect(
      getConversationModelPresentation('copilot', 'google/gemini-2.5-pro')
        .label,
    ).toBe('Gemini');
    expect(
      getConversationModelPresentation('copilot', 'unsloth/gemma-3-27b').label,
    ).toBe('Gemma');
    expect(
      getConversationModelPresentation('copilot', 'meta-llama/llama-3.3-70b')
        .label,
    ).toBe('Meta');
    expect(
      getConversationModelPresentation('copilot', 'deepseek/deepseek-r1').label,
    ).toBe('DeepSeek');
    expect(
      getConversationModelPresentation('copilot', 'notdeepseekmodel').label,
    ).toBe('Copilot');
    expect(
      getConversationModelPresentation('copilot', 'qwen/qwen3-32b').label,
    ).toBe('Qwen');
    expect(
      getConversationModelPresentation('copilot', 'x-ai/grok-4').label,
    ).toBe('Grok');
    expect(
      getConversationModelPresentation('copilot', 'cohere/command-a').label,
    ).toBe('Cohere');
    expect(
      getConversationModelPresentation('copilot', 'amazon/nova-pro').label,
    ).toBe('Nova');
  });

  it('formats recent timestamps relatively and older timestamps with exact local date and time', () => {
    const recent = formatConversationRowTimestamp('2026-03-23T10:15:00.000Z');
    const older = formatConversationRowTimestamp('2026-03-21T08:00:00.000Z');

    expect(recent).toBe('2 hours ago');
    expect(older).toBe(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date('2026-03-21T08:00:00.000Z')),
    );
  });

  it('refreshes visible relative timestamps on the shared interval', async () => {
    render(
      <ConversationList
        conversations={[
          {
            conversationId: 'row-refresh',
            title: 'Fresh timestamp',
            provider: 'codex',
            model: 'gpt-4.1',
            source: 'REST',
            lastMessageAt: '2026-03-23T11:59:01.000Z',
            archived: false,
          },
        ]}
        selectedId="row-refresh"
        isLoading={false}
        isError={false}
        hasMore={false}
        filterState={{ active: true, archived: false }}
        onSelect={() => {}}
        onFilterChange={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        onLoadMore={() => {}}
        onRefresh={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByTestId('conversation-updated')).toHaveTextContent(
      'just now',
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(screen.getByTestId('conversation-updated')).toHaveTextContent(
      '1 minute ago',
    );
  });
});
