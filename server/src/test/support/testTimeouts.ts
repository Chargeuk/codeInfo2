const TEST_TIMEOUT_ENV = 'CODEINFO_TEST_TIMEOUT_MS';

function parsePositiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function resolveConfiguredTestTimeoutMs(timeoutMs: number): number {
  const configuredRaw = process.env[TEST_TIMEOUT_ENV]?.trim();
  if (!configuredRaw) {
    return timeoutMs;
  }

  const configured = parsePositiveInteger(configuredRaw);
  if (configured === null) {
    return timeoutMs;
  }

  return Math.max(timeoutMs, configured);
}

export function resolveConfiguredPollAttempts(
  defaultAttempts: number,
  intervalMs: number,
): number {
  return Math.ceil(
    resolveConfiguredTestTimeoutMs(defaultAttempts * intervalMs) / intervalMs,
  );
}

export async function waitForTestCondition(
  predicate: () => boolean | Promise<boolean>,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    description: string;
  },
): Promise<void> {
  const timeoutMs = resolveConfiguredTestTimeoutMs(options.timeoutMs ?? 2000);
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timed out waiting for ${options.description} after ${timeoutMs}ms`,
  );
}
