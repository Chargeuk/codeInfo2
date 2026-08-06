const TEST_TIMEOUT_ENV = 'CODEINFO_TEST_TIMEOUT_MS';

export function resolveConfiguredE2eTimeoutMs(defaultTimeoutMs: number) {
  const configured = Number.parseInt(process.env[TEST_TIMEOUT_ENV] ?? '', 10);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.max(defaultTimeoutMs, configured)
    : defaultTimeoutMs;
}
