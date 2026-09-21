import { waitFor } from '@testing-library/react';

export async function waitForInteractiveCombobox(
  combobox: HTMLElement,
): Promise<void> {
  await waitFor(() =>
    expect(combobox).not.toHaveAttribute('aria-disabled', 'true'),
  );
}
