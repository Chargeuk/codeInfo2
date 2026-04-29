import { screen, waitFor, within } from '@testing-library/react';
import { createTestUser, type TestUserEvent } from './userEvent';

export async function ensureCodexFlagsPanelExpanded(
  user: TestUserEvent = createTestUser(),
) {
  await waitFor(
    () => {
      expect(screen.getByTestId('agent-flags-panel')).toBeInTheDocument();
    },
    { timeout: 5000 },
  );
  const panel = screen.getByTestId('agent-flags-panel');
  const summaryButton = within(panel).getByRole('button');

  if (summaryButton.getAttribute('aria-expanded') !== 'true') {
    await user.click(summaryButton);
  }

  await waitFor(() => {
    if (summaryButton.getAttribute('aria-expanded') !== 'true') {
      throw new Error('Expected Agent Flags panel to be expanded');
    }
  });
}
