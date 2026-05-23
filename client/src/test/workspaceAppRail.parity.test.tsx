import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WorkspaceDesktopShell from '../components/workspace/WorkspaceDesktopShell';
import WorkspaceMobileAppMenuOverlay from '../components/workspace/WorkspaceMobileAppMenuOverlay';
import UtilityPageShell from '../components/utility/UtilityPageShell';
import {
  WORKSPACE_DESTINATIONS,
  WORKSPACE_DESTINATION_LABELS,
} from '../components/workspace/workspaceNavigation';

describe('workspace app rail parity', () => {
  it('renders the desktop rail in the final order with labels only', () => {
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

    expect(within(rail).getByRole('link', { name: 'Agents' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders the same desktop rail inside the utility shell', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <UtilityPageShell title="Home">
          <div data-testid="utility-shell-body" />
        </UtilityPageShell>
      </MemoryRouter>,
    );

    const utilityShell = screen.getByTestId('utility-page-shell');
    const rail = within(utilityShell).getByTestId('workspace-app-rail');

    expect(within(rail).getAllByRole('link')).toHaveLength(6);
    expect(
      within(rail).getByRole('link', { name: WORKSPACE_DESTINATION_LABELS[0] }),
    ).toBeVisible();
    expect(screen.getByTestId('utility-shell-body')).toBeInTheDocument();
  });

  it('keeps the mobile app menu descriptions while suppressing desktop secondary text', () => {
    render(
      <MemoryRouter initialEntries={['/agents']}>
        <WorkspaceMobileAppMenuOverlay open onClose={() => {}} />
      </MemoryRouter>,
    );

    const mobileMenu = screen.getByTestId('workspace-mobile-app-menu-overlay');
    const mobileLinks = within(mobileMenu).getAllByRole('link');

    expect(mobileLinks).toHaveLength(6);

    WORKSPACE_DESTINATIONS.forEach(({ description, label }) => {
      expect(within(mobileMenu).getByText(description)).toBeInTheDocument();
      expect(
        mobileLinks.some((link) => link.textContent?.includes(label)),
      ).toBe(true);
    });
  });
});
