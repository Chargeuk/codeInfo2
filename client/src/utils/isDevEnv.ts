export const isDevEnv = (): boolean => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    return true;
  }
  if (typeof window !== 'undefined') {
    return Boolean(
      (window as { __CODEINFO_TEST__?: boolean }).__CODEINFO_TEST__,
    );
  }
  if (typeof globalThis !== 'undefined') {
    return Boolean(
      (globalThis as { __CODEINFO_TEST__?: boolean }).__CODEINFO_TEST__,
    );
  }
  return false;
};
