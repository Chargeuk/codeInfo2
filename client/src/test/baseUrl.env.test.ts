import {
  getApiBaseUrl,
  getClientRuntimeConfigDiagnostics,
  hasInvalidCanonicalRuntimeConfig,
  resetClientRuntimeConfigLogForTests,
} from '../config/runtimeConfig';
import { resolveBrowserHostApiBaseUrl } from '../config/apiBaseUrl';

describe('baseUrl env rename', () => {
  const legacyClientEnv = (...parts: string[]) => ['VITE', ...parts].join('_');
  const legacyClientApiUrlEnvName = legacyClientEnv('API', 'URL');
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
    delete process.env[legacyClientApiUrlEnvName];
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

  it('surfaces object-like non-record runtime config containers before env fallback wins', () => {
    (
      globalThis as typeof globalThis & {
        __CODEINFO_CONFIG__?: unknown;
      }
    ).__CODEINFO_CONFIG__ = new URL('http://bad-object.example');
    process.env.VITE_CODEINFO_API_URL = 'http://renamed.example:5010';

    expect(getApiBaseUrl()).toBe('http://renamed.example:5010');
    expect(getClientRuntimeConfigDiagnostics()).toEqual([
      {
        container: '__CODEINFO_CONFIG__',
        source: 'runtime',
        rawValue: '"http://bad-object.example/"',
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

  it('derives the api base url from the browser host when requested by the env directive', () => {
    process.env.VITE_CODEINFO_API_URL = 'USE_BROWSER_HOST:5510';

    expect(getApiBaseUrl()).toBe('http://localhost:5510');
    expect(getClientRuntimeConfigDiagnostics()).toEqual([]);
  });

  it('lets runtime config directives override env api base urls', () => {
    (
      globalThis as typeof globalThis & {
        __CODEINFO_CONFIG__?: { apiBaseUrl?: string };
      }
    ).__CODEINFO_CONFIG__ = { apiBaseUrl: 'USE_BROWSER_HOST:5511' };
    process.env.VITE_CODEINFO_API_URL = 'http://renamed.example:5010';

    expect(getApiBaseUrl()).toBe('http://localhost:5511');
    expect(getClientRuntimeConfigDiagnostics()).toEqual([]);
  });

  it('falls back to the browser origin when the env directive port is malformed', () => {
    process.env.VITE_CODEINFO_API_URL = 'USE_BROWSER_HOST:not-a-port';

    expect(getApiBaseUrl()).toBe(window.location.origin);
    expect(getClientRuntimeConfigDiagnostics()).toEqual([
      {
        field: 'apiBaseUrl',
        source: 'env',
        rawValue: 'USE_BROWSER_HOST:not-a-port',
        reason: 'invalid_browser_host_directive',
      },
    ]);
  });
});

describe('browser-host api directive helper', () => {
  it('derives the browser host url with the requested port', () => {
    expect(
      resolveBrowserHostApiBaseUrl(
        'USE_BROWSER_HOST:5510',
        'http://dastapleton-everest.nord:5501',
      ),
    ).toEqual({
      value: 'http://dastapleton-everest.nord:5510',
      mode: 'browser_host',
      directivePort: '5510',
    });
  });

  it('reports malformed browser host directives', () => {
    expect(
      resolveBrowserHostApiBaseUrl(
        'USE_BROWSER_HOST:abc',
        'http://dastapleton-everest.nord:5501',
      ),
    ).toEqual({
      value: undefined,
      mode: 'fallback',
      directivePort: 'abc',
      diagnosticReason: 'invalid_browser_host_directive',
    });
  });
});
});
