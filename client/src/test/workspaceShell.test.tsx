import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import ConversationList, {
  type ConversationListItem,
} from '../components/chat/ConversationList';
import WorkspaceDesktopShell from '../components/workspace/WorkspaceDesktopShell';
import WorkspaceMobileAppMenuOverlay from '../components/workspace/WorkspaceMobileAppMenuOverlay';
import WorkspaceMobileConversationsOverlay from '../components/workspace/WorkspaceMobileConversationsOverlay';
import { type ConversationFilterState } from '../hooks/useConversations';

const workspaceDestinationNames = [
  'Home',
  'Chat',
  'Agents',
  'Flows',
  'Ingest',
  'Logs',
];

const conversationFixtures: ConversationListItem[] = [
  {
    conversationId: 'conversation-active',
    title: 'Workspace shell discovery',
    provider: 'Codex',
    model: 'gpt-5',
    source: 'REST',
    lastMessageAt: '2026-05-18T10:00:00.000Z',
    archived: false,
  },
  {
    conversationId: 'conversation-archived',
    title: 'Archived follow-up',
    provider: 'Copilot',
    model: 'gpt-4.1',
    source: 'MCP',
    lastMessageAt: '2026-05-18T10:10:00.000Z',
    archived: true,
  },
];

function WorkspaceStateHarness() {
  const [conversationPaneOpen, setConversationPaneOpen] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState(
    conversationFixtures[0].conversationId,
  );
  const [filterState, setFilterState] = useState<ConversationFilterState>({
    active: true,
    archived: false,
  });
  const [draft, setDraft] = useState('Initial shell draft');

  return (
    <MemoryRouter initialEntries={['/chat']}>
      <button
        type="button"
        onClick={() => setConversationPaneOpen((current) => !current)}
      >
        Toggle shell
      </button>
      <div data-testid="selected-conversation">{selectedConversationId}</div>
      <WorkspaceDesktopShell
        conversationPaneOpen={conversationPaneOpen}
        onToggleConversationPane={() =>
          setConversationPaneOpen((current) => !current)
        }
        conversationPane={
          <ConversationList
            conversations={conversationFixtures}
            selectedId={selectedConversationId}
            isLoading={false}
            isError={false}
            hasMore={false}
            filterState={filterState}
            mongoConnected
            onSelect={setSelectedConversationId}
            onFilterChange={setFilterState}
            onArchive={() => {}}
            onRestore={() => {}}
            onLoadMore={() => {}}
            onRefresh={() => {}}
            onRetry={() => {}}
            showHeaderTitle={false}
          />
        }
        transcript={<div data-testid="transcript-slot" />}
        composer={
          <label htmlFor="workspace-draft">
            Draft
            <input
              id="workspace-draft"
              aria-label="Draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
        }
      />
    </MemoryRouter>
  );
}

describe('workspace shell primitives', () => {
  it('exposes the desktop shell structure with the shared app rail and conversation pane', () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <WorkspaceDesktopShell
          conversationPane={<div data-testid="desktop-conversations-slot" />}
          transcript={<div data-testid="desktop-transcript-slot" />}
          composer={<div data-testid="desktop-composer-slot" />}
          conversationPaneOpen
          onToggleConversationPane={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('workspace-desktop-shell')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-app-rail')).toBeInTheDocument();
    expect(
      screen.getByTestId('workspace-conversation-pane'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('desktop-transcript-slot')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-composer-slot')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-drawer-toggle')).toHaveAttribute(
      'aria-controls',
      'workspace-conversation-pane',
    );

    workspaceDestinationNames.forEach((destinationName) => {
      expect(
        screen.getByRole('link', { name: destinationName }),
      ).toBeInTheDocument();
    });
  });

  it('exposes the left and right mobile overlays with the shared destination model', () => {
    render(
      <MemoryRouter initialEntries={['/agents']}>
        <WorkspaceMobileConversationsOverlay
          open
          onClose={() => {}}
          list={<div data-testid="mobile-conversations-list" />}
        />
        <WorkspaceMobileAppMenuOverlay open onClose={() => {}} />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId('workspace-mobile-conversations-overlay'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('workspace-mobile-app-menu-overlay'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('mobile-conversations-list')).toBeInTheDocument();

    const mobileMenu = screen.getByTestId('workspace-mobile-app-menu-overlay');
    const mobileLinks = within(mobileMenu).getAllByRole('link');
    workspaceDestinationNames.forEach((destinationName) => {
      expect(
        mobileLinks.some((link) => link.textContent?.includes(destinationName)),
      ).toBe(true);
    });
  });

  it('keeps the selected conversation, filter, and draft state when the shell opens and closes', async () => {
    const user = userEvent.setup();

    render(<WorkspaceStateHarness />);

    expect(screen.getByTestId('selected-conversation')).toHaveTextContent(
      'conversation-active',
    );
    expect(screen.getByLabelText('Draft')).toHaveValue('Initial shell draft');
    expect(screen.getByTestId('conversation-filter-active')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByTestId('conversation-filter-archived'));
    await user.click(
      screen.getByRole('button', { name: /Archived follow-up/i }),
    );
    await user.type(screen.getByLabelText('Draft'), ' updated');
    await user.click(screen.getByRole('button', { name: /Toggle shell/i }));
    await user.click(screen.getByRole('button', { name: /Toggle shell/i }));

    expect(screen.getByTestId('selected-conversation')).toHaveTextContent(
      'conversation-archived',
    );
    expect(screen.getByLabelText('Draft')).toHaveValue(
      'Initial shell draft updated',
    );
    expect(screen.getByTestId('conversation-filter-archived')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
