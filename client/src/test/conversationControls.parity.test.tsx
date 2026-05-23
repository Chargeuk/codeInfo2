import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useState } from 'react';
import ConversationList, {
  type ConversationListItem,
} from '../components/chat/ConversationList';
import {
  useConversations,
  type ConversationFilterState,
} from '../hooks/useConversations';

const mockFetch = jest.fn<typeof fetch>();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

const baseConversations: ConversationListItem[] = [
  {
    conversationId: 'conversation-active',
    title: 'Active conversation',
    provider: 'codex',
    model: 'gpt-5',
    lastMessageAt: '2026-05-23T10:00:00.000Z',
    archived: false,
  },
  {
    conversationId: 'conversation-archived',
    title: 'Archived conversation',
    provider: 'copilot',
    model: 'gpt-4.1',
    lastMessageAt: '2026-05-23T09:30:00.000Z',
    archived: true,
  },
];

function mockConversationResponse() {
  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          items: baseConversations,
          nextCursor: null,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ),
  );
}

function ControlsHarness() {
  const [filterState, setFilterState] = useState<ConversationFilterState>({
    active: true,
    archived: false,
  });

  return (
    <>
      <div data-testid="conversation-filter-state">
        {JSON.stringify(filterState)}
      </div>
      <ConversationList
        conversations={baseConversations}
        selectedId={undefined}
        isLoading={false}
        isError={false}
        hasMore={false}
        filterState={filterState}
        mongoConnected
        onSelect={() => undefined}
        onFilterChange={setFilterState}
        onArchive={() => undefined}
        onRestore={() => undefined}
        onLoadMore={() => undefined}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onBulkArchive={undefined}
        onBulkRestore={undefined}
        onBulkDelete={undefined}
      />
    </>
  );
}

describe('conversation controls parity', () => {
  it('renders the shared controls row with no search control and with refresh on the right', () => {
    render(<ControlsHarness />);

    const row = screen.getByTestId('conversation-filter');
    const buttons = within(row).getAllByRole('button');

    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Active conversations',
      'Archived conversations',
      'Refresh conversations',
    ]);
    expect(screen.getByTestId('conversation-filter-active')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('conversation-filter-archived')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('conversation-refresh')).toBeInTheDocument();
    expect(screen.queryByLabelText(/search/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
  });

  it('keeps the four conversation filter states explicit and falls back safely when both toggles are off', async () => {
    mockConversationResponse();
    const { result } = renderHook(() => useConversations());

    await waitFor(() =>
      expect(result.current.conversations.map((item) => item.title)).toEqual([
        'Active conversation',
      ]),
    );

    await act(async () => {
      result.current.setFilterState({ active: true, archived: true });
    });

    await waitFor(() =>
      expect(result.current.conversations.map((item) => item.title)).toEqual([
        'Active conversation',
        'Archived conversation',
      ]),
    );

    await act(async () => {
      result.current.setFilterState({ active: false, archived: true });
    });

    await waitFor(() =>
      expect(result.current.conversations.map((item) => item.title)).toEqual([
        'Archived conversation',
      ]),
    );

    await act(async () => {
      result.current.setFilterState({ active: false, archived: false });
    });

    await waitFor(() =>
      expect(result.current.conversations.map((item) => item.title)).toEqual([
        'Active conversation',
      ]),
    );
  });

  it('restores the visible fallback state in the rendered controls when the last toggle is turned off', async () => {
    render(<ControlsHarness />);

    const active = screen.getByTestId('conversation-filter-active');
    const archived = screen.getByTestId('conversation-filter-archived');
    const stateProbe = screen.getByTestId('conversation-filter-state');

    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(archived).toHaveAttribute('aria-pressed', 'false');
    expect(stateProbe).toHaveTextContent(
      JSON.stringify({ active: true, archived: false }),
    );

    act(() => {
      fireEvent.click(active);
    });

    await waitFor(() => {
      expect(active).toHaveAttribute('aria-pressed', 'true');
      expect(archived).toHaveAttribute('aria-pressed', 'false');
      expect(stateProbe).toHaveTextContent(
        JSON.stringify({ active: true, archived: false }),
      );
    });

    act(() => {
      fireEvent.click(archived);
    });

    await waitFor(() => {
      expect(active).toHaveAttribute('aria-pressed', 'true');
      expect(archived).toHaveAttribute('aria-pressed', 'true');
      expect(stateProbe).toHaveTextContent(
        JSON.stringify({ active: true, archived: true }),
      );
    });

    act(() => {
      fireEvent.click(active);
    });

    await waitFor(() => {
      expect(active).toHaveAttribute('aria-pressed', 'false');
      expect(archived).toHaveAttribute('aria-pressed', 'true');
      expect(stateProbe).toHaveTextContent(
        JSON.stringify({ active: false, archived: true }),
      );
    });

    act(() => {
      fireEvent.click(archived);
    });

    await waitFor(() => {
      expect(active).toHaveAttribute('aria-pressed', 'true');
      expect(archived).toHaveAttribute('aria-pressed', 'false');
      expect(stateProbe).toHaveTextContent(
        JSON.stringify({ active: true, archived: false }),
      );
    });
  });
});
