import { screen, waitFor } from '@testing-library/react';
import { createTestUser, type TestUserEvent } from './userEvent';

export async function ensureCodexFlagsPanelExpanded(
  user: TestUserEvent = createTestUser(),
) {
  const summaryButton = await screen.findByRole('button', {
    name: /agent flags/i,
  });

  if (summaryButton.getAttribute('aria-expanded') !== 'true') {
    await user.click(summaryButton);
  }

  await waitFor(() => {
    if (summaryButton.getAttribute('aria-expanded') !== 'true') {
      throw new Error('Expected Agent Flags panel to be expanded');
    }
  });
}
