import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export async function ensureCodexFlagsPanelExpanded() {
  const summaryButton = await screen.findByRole('button', {
    name: /codex flags/i,
  });

  if (summaryButton.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(summaryButton);
  }

  await waitFor(() => {
    if (summaryButton.getAttribute('aria-expanded') !== 'true') {
      throw new Error('Expected Codex flags panel to be expanded');
    }
  });
}
