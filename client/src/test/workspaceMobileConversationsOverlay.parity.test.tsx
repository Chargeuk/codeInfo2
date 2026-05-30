import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import WorkspaceMobileConversationsOverlay from '../components/workspace/WorkspaceMobileConversationsOverlay';

const repoRoot = process.cwd();

function readPageSource(path: string) {
  const candidate = join(repoRoot, path);
  try {
    return readFileSync(candidate, 'utf8');
  } catch {
    // Running inside the client workspace sets cwd to <repo>/client; try the parent repo root as a fallback.
    const alt = join(repoRoot, '..', path);
    return readFileSync(alt, 'utf8');
  }
}

describe('workspace mobile conversations overlay parity', () => {
  it('renders the final full-screen overlay shell with the title treatment and explanatory text', () => {
    render(
      <WorkspaceMobileConversationsOverlay
        open
        onClose={() => undefined}
        list={<div data-testid="mobile-conversation-list" />}
      />,
    );

    const overlay = screen.getByTestId(
      'workspace-mobile-conversations-overlay',
    );
    const drawer = screen.getByTestId('conversation-drawer');
    const paper = drawer.querySelector(
      '.MuiDrawer-paper',
    ) as HTMLElement | null;

    expect(overlay).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Conversations' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Select a conversation to return to the active workspace.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Close conversations')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-conversation-list')).toBeInTheDocument();
    expect(paper).not.toBeNull();
    expect(paper).toHaveStyle({ width: '100vw', maxWidth: '100vw' });

    const header = within(overlay).getByRole('heading', {
      name: 'Conversations',
    });
    expect(header).toBeInTheDocument();
  });

  it('is mounted only from the workspace pages and not from the non-workspace pages', () => {
    expect(readPageSource('client/src/pages/ChatPage.tsx')).toContain(
      'WorkspaceMobileConversationsOverlay',
    );
    expect(readPageSource('client/src/pages/AgentsPage.tsx')).toContain(
      'WorkspaceMobileConversationsOverlay',
    );
    expect(readPageSource('client/src/pages/FlowsPage.tsx')).toContain(
      'WorkspaceMobileConversationsOverlay',
    );
    expect(readPageSource('client/src/pages/HomePage.tsx')).not.toContain(
      'WorkspaceMobileConversationsOverlay',
    );
    expect(readPageSource('client/src/pages/IngestPage.tsx')).not.toContain(
      'WorkspaceMobileConversationsOverlay',
    );
    expect(readPageSource('client/src/pages/LogsPage.tsx')).not.toContain(
      'WorkspaceMobileConversationsOverlay',
    );
  });
});
