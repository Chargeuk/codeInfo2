import { resolveConfiguredTestTimeoutMs } from './testTimeouts.js';

export async function waitForCondition(
  predicate: () => boolean,
  message: string,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + resolveConfiguredTestTimeoutMs(timeoutMs);
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
