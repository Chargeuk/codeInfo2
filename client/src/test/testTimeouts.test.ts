import { resolveClientTestTimeoutMs } from './support/testTimeouts';

const originalTimeout = process.env.CODEINFO_CLIENT_TEST_TIMEOUT_MS;

afterEach(() => {
  if (originalTimeout === undefined) {
    delete process.env.CODEINFO_CLIENT_TEST_TIMEOUT_MS;
  } else {
    process.env.CODEINFO_CLIENT_TEST_TIMEOUT_MS = originalTimeout;
  }
});

it('preserves the test-specific timeout when no larger configured value exists', () => {
  delete process.env.CODEINFO_CLIENT_TEST_TIMEOUT_MS;
  expect(resolveClientTestTimeoutMs(15_000)).toBe(15_000);
});

it('raises a test-specific timeout to the configured stress budget', () => {
  process.env.CODEINFO_CLIENT_TEST_TIMEOUT_MS = '60000';
  expect(resolveClientTestTimeoutMs(15_000)).toBe(60_000);
});

it('ignores invalid configured timeout values', () => {
  process.env.CODEINFO_CLIENT_TEST_TIMEOUT_MS = 'not-a-timeout';
  expect(resolveClientTestTimeoutMs(30_000)).toBe(30_000);
});
