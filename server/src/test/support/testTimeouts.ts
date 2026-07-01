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
