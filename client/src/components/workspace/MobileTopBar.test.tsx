import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkspaceMobileTopBar from './WorkspaceMobileTopBar';

describe('WorkspaceMobileTopBar', () => {
  it('renders the utility-page variant without a conversations button', () => {
    render(
      <WorkspaceMobileTopBar
        title="Home"
        showConversationsButton={false}
        onConversationsClick={() => {}}
        onMenuClick={() => {}}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /^Open conversations$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Open menu$/i })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /^Conversations$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Menu$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible();
  });

  it('renders the workspace-page variant with compact icon actions', async () => {
    const user = userEvent.setup();
    const onConversationsClick = jest.fn();
    const onNewClick = jest.fn();
    const onMenuClick = jest.fn();

    render(
      <WorkspaceMobileTopBar
        title="Chat"
        showConversationsButton
        onConversationsClick={onConversationsClick}
        onNewClick={onNewClick}
        newButtonLabel="New chat"
        onMenuClick={onMenuClick}
      />,
    );

    expect(
      screen.getByRole('button', { name: /^Open conversations$/i }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /^New chat$/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Open menu$/i })).toBeVisible();
    expect(screen.getByTestId('workspace-mobile-new-action-slot')).toHaveStyle({
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
    });
    expect(
      screen.queryByRole('button', { name: /^Conversations$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Menu$/i }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /^Open conversations$/i }),
    );
    await user.click(screen.getByRole('button', { name: /^New chat$/i }));
    await user.click(screen.getByRole('button', { name: /^Open menu$/i }));

    expect(onConversationsClick).toHaveBeenCalledTimes(1);
    expect(onNewClick).toHaveBeenCalledTimes(1);
    expect(onMenuClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeVisible();
  });
});
