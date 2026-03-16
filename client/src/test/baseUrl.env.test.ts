import { getApiBaseUrl } from '../api/baseUrl';

describe('baseUrl env rename', () => {
  const originalRuntimeConfig = (
    globalThis as typeof globalThis & {
      __CODEINFO_CONFIG__?: unknown;
    }
  ).__CODEINFO_CONFIG__;
  const originalEnv = process.env;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { __CODEINFO_CONFIG__?: unknown }
    ).__CODEINFO_CONFIG__ = undefined;
    process.env = { ...originalEnv };
    delete process.env.VITE_CODEINFO_API_URL;
    delete process.env.VITE_API_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
    (
      globalThis as typeof globalThis & { __CODEINFO_CONFIG__?: unknown }
    ).__CODEINFO_CONFIG__ = originalRuntimeConfig;
  });

  it('uses VITE_CODEINFO_API_URL when runtime config is absent', () => {
    process.env.VITE_CODEINFO_API_URL = 'http://renamed.example:5010';

    expect(getApiBaseUrl()).toBe('http://renamed.example:5010');
  });
});
