import { screen, waitFor, within } from '@testing-library/react';
import { resolveClientTestTimeoutMs } from './testTimeouts';
import { createTestUser, type TestUserEvent } from './userEvent';

export async function ensureCodexFlagsPanelExpanded(
  user: TestUserEvent = createTestUser(),
) {
  await waitFor(
    () => {
      expect(screen.getByTestId('agent-flags-panel')).toBeInTheDocument();
    },
    { timeout: resolveClientTestTimeoutMs(5_000) },
  );
  const getSummaryButton = () =>
    within(screen.getByTestId('agent-flags-panel')).getByRole('button');
  const summaryButton = getSummaryButton();

  if (summaryButton.getAttribute('aria-expanded') !== 'true') {
    await user.click(summaryButton);
  }

  await waitFor(
    () => {
      if (getSummaryButton().getAttribute('aria-expanded') !== 'true') {
        throw new Error('Expected Agent Flags panel to be expanded');
      }
    },
    { timeout: resolveClientTestTimeoutMs(5_000) },
  );
}
