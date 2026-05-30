import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NavBar from '../components/NavBar';
import UtilityPageShell from '../components/utility/UtilityPageShell';
import WorkspaceDesktopShell from '../components/workspace/WorkspaceDesktopShell';
import WorkspaceMobileAppMenuOverlay from '../components/workspace/WorkspaceMobileAppMenuOverlay';
import {
  WORKSPACE_DESTINATIONS,
  WORKSPACE_DESTINATION_LABELS,
} from '../components/workspace/workspaceNavigation';

const desktopWidth = 1280;
const mobileWidth = 375;

function setViewportWidth(width: number) {
  act(() => {
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));
  });
}

describe('workspace mobile app menu parity', () => {
  beforeEach(() => {
    setViewportWidth(desktopWidth);
  });

  afterEach(() => {
    setViewportWidth(desktopWidth);
  });

  it('renders the full-screen mobile menu with the final row hierarchy and selected state', () => {
    render(
      <MemoryRouter initialEntries={['/agents']}>
        <WorkspaceMobileAppMenuOverlay open onClose={() => undefined} />
      </MemoryRouter>,
    );

    const overlay = screen.getByTestId('workspace-mobile-app-menu-overlay');
    const links = within(overlay).getAllByRole('link');

    expect(
      within(overlay).getByRole('heading', { name: 'Menu' }),
    ).toBeInTheDocument();
    expect(
      within(overlay).getByRole('button', { name: 'Close menu' }),
    ).toBeInTheDocument();
    expect(
      within(overlay).getByText('Navigate to key areas of CodeInfo.'),
    ).toBeInTheDocument();
    const header = within(overlay).getByTestId(
      'workspace-mobile-app-menu-header',
    );
    expect(header).toHaveStyle({ minHeight: '56px' });
    expect(links).toHaveLength(6);

    WORKSPACE_DESTINATIONS.forEach(({ label, description }, index) => {
      const row = links[index];
      expect(row).toHaveTextContent(label);
      expect(row).toHaveTextContent(description);
      expect(within(row).getAllByRole('img')).toHaveLength(2);
    });

    expect(links[2]).toHaveAttribute('aria-current', 'page');
    expect(within(overlay).queryByText(/account/i)).not.toBeInTheDocument();
    expect(within(overlay).queryByText(/profile/i)).not.toBeInTheDocument();
    expect(within(overlay).queryByText(/settings/i)).not.toBeInTheDocument();
    expect(
      within(overlay).queryByRole('button', { name: /archive/i }),
    ).not.toBeInTheDocument();
    expect(
      within(overlay).queryByRole('button', { name: /refresh/i }),
    ).not.toBeInTheDocument();
    expect(
      within(overlay).queryByRole('button', { name: /active/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps the desktop rail labels-only without mobile app-menu chrome', () => {
    render(
      <MemoryRouter initialEntries={['/agents']}>
        <WorkspaceDesktopShell
          transcript={<div data-testid="desktop-transcript" />}
          composer={<div data-testid="desktop-composer" />}
        />
      </MemoryRouter>,
    );

    const rail = screen.getByTestId('workspace-app-rail');
    const links = within(rail).getAllByRole('link');

    expect(links).toHaveLength(6);
    expect(links.map((link) => link.textContent?.trim())).toEqual(
      WORKSPACE_DESTINATION_LABELS,
    );

    WORKSPACE_DESTINATIONS.forEach(({ description, label }) => {
      expect(within(rail).queryByText(description)).not.toBeInTheDocument();
      expect(within(rail).getByRole('link', { name: label })).toBeVisible();
    });

    expect(
      within(rail).queryByTestId('ChevronRightIcon'),
    ).not.toBeInTheDocument();
  });

  it('opens and closes the mobile menu from the workspace entry point', async () => {
    const user = userEvent.setup();

    setViewportWidth(mobileWidth);

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <NavBar />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(
      screen.getByTestId('workspace-mobile-app-menu-overlay'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    await waitFor(() => {
      expect(
        screen.queryByTestId('workspace-mobile-app-menu-overlay'),
      ).not.toBeInTheDocument();
    });
  });

  it('opens and closes the mobile menu from the utility page entry point', async () => {
    const user = userEvent.setup();

    setViewportWidth(mobileWidth);

    render(
      <MemoryRouter initialEntries={['/ingest']}>
        <UtilityPageShell title="Ingest">
          <div data-testid="utility-shell-body" />
        </UtilityPageShell>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(
      screen.getByTestId('workspace-mobile-app-menu-overlay'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    await waitFor(() => {
      expect(
        screen.queryByTestId('workspace-mobile-app-menu-overlay'),
      ).not.toBeInTheDocument();
    });
  });
});
