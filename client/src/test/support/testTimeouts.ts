const parsePositiveInteger = (value: string | undefined): number | null => {
  const normalized = value?.trim();
  if (!normalized || !/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export const resolveClientTestTimeoutMs = (defaultTimeoutMs: number): number =>
  Math.max(
    defaultTimeoutMs,
    parsePositiveInteger(process.env.CODEINFO_CLIENT_TEST_TIMEOUT_MS) ?? 0,
  );
