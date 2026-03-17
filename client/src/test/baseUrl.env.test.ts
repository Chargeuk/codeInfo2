import {
  getApiBaseUrl,
  getClientRuntimeConfigDiagnostics,
  hasInvalidCanonicalRuntimeConfig,
  resetClientRuntimeConfigLogForTests,
} from '../config/runtimeConfig';

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
    resetClientRuntimeConfigLogForTests();
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

  it('surfaces malformed canonical runtime api urls instead of silently treating them as missing', () => {
    (
      globalThis as typeof globalThis & {
        __CODEINFO_CONFIG__?: { apiBaseUrl?: string };
      }
    ).__CODEINFO_CONFIG__ = { apiBaseUrl: '   ' };
    process.env.VITE_CODEINFO_API_URL = 'http://renamed.example:5010';

    expect(getApiBaseUrl()).toBe('http://renamed.example:5010');
    expect(getClientRuntimeConfigDiagnostics()).toEqual([
      {
        field: 'apiBaseUrl',
        source: 'runtime',
        rawValue: '   ',
        reason: 'empty_string',
      },
    ]);
    expect(
      hasInvalidCanonicalRuntimeConfig(getClientRuntimeConfigDiagnostics()),
    ).toBe(true);
  });

  it('surfaces malformed top-level runtime config containers instead of treating them as absent', () => {
    (
      globalThis as typeof globalThis & {
        __CODEINFO_CONFIG__?: unknown;
      }
    ).__CODEINFO_CONFIG__ = 'http://bad-container.example';
    process.env.VITE_CODEINFO_API_URL = 'http://renamed.example:5010';

    expect(getApiBaseUrl()).toBe('http://renamed.example:5010');
    expect(getClientRuntimeConfigDiagnostics()).toEqual([
      {
        container: '__CODEINFO_CONFIG__',
        source: 'runtime',
        rawValue: 'http://bad-container.example',
        reason: 'invalid_container',
      },
    ]);
    expect(
      hasInvalidCanonicalRuntimeConfig(getClientRuntimeConfigDiagnostics()),
    ).toBe(true);
  });

  it('surfaces array-shaped top-level runtime config containers before env fallback wins', () => {
    (
      globalThis as typeof globalThis & {
        __CODEINFO_CONFIG__?: unknown;
      }
    ).__CODEINFO_CONFIG__ = ['http://bad-array.example'];
    process.env.VITE_CODEINFO_API_URL = 'http://renamed.example:5010';

    expect(getApiBaseUrl()).toBe('http://renamed.example:5010');
    expect(getClientRuntimeConfigDiagnostics()).toEqual([
      {
        container: '__CODEINFO_CONFIG__',
        source: 'runtime',
        rawValue: '["http://bad-array.example"]',
        reason: 'invalid_container',
      },
    ]);
    expect(
      hasInvalidCanonicalRuntimeConfig(getClientRuntimeConfigDiagnostics()),
    ).toBe(true);
  });

  it('does not label malformed env fallback values as invalid canonical runtime config', () => {
    process.env.VITE_CODEINFO_API_URL = ' ';

    expect(getApiBaseUrl()).toBe(window.location.origin);
    expect(getClientRuntimeConfigDiagnostics()).toEqual([
      {
        field: 'apiBaseUrl',
        source: 'env',
        rawValue: ' ',
        reason: 'empty_string',
      },
    ]);
    expect(
      hasInvalidCanonicalRuntimeConfig(getClientRuntimeConfigDiagnostics()),
    ).toBe(false);
  });
});
