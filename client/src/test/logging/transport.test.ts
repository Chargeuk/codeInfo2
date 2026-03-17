import { LogEntry } from '@codeinfo2/common';
import { jest } from '@jest/globals';
import {
  getClientRuntimeConfigDiagnostics,
  hasInvalidCanonicalRuntimeConfig,
  resetClientRuntimeConfigLogForTests,
} from '../../config/runtimeConfig';
import { flushQueue, sendLogs, _getQueue } from '../../logging/transport';
import { getFetchMock, mockJsonResponse } from '../support/fetchMock';

const baseEntry: LogEntry = {
  level: 'info',
  message: 'hello',
  timestamp: '2025-01-01T00:00:00.000Z',
  source: 'client',
};

const originalRuntimeConfig = (
  globalThis as typeof globalThis & {
    __CODEINFO_CONFIG__?: unknown;
  }
).__CODEINFO_CONFIG__;
const legacyClientEnv = (...parts: string[]) => ['VITE', ...parts].join('_');
const legacyClientApiUrlEnvName = legacyClientEnv('API', 'URL');
const legacyClientLogForwardEnvName = legacyClientEnv(
  'LOG',
  'FORWARD',
  'ENABLED',
);
const legacyClientLogMaxBytesEnvName = legacyClientEnv('LOG', 'MAX', 'BYTES');
const legacyClientLogLevelEnvName = legacyClientEnv('LOG', 'LEVEL');
const legacyClientLogStreamEnvName = legacyClientEnv('LOG', 'STREAM', 'ENABLED');

beforeEach(() => {
  process.env.MODE = 'development';
  process.env.VITE_CODEINFO_API_URL = 'http://localhost:5010';
  process.env.VITE_CODEINFO_LOG_MAX_BYTES = '32768';
  process.env.VITE_CODEINFO_LOG_FORWARD_ENABLED = 'true';
  (
    globalThis as typeof globalThis & { __CODEINFO_CONFIG__?: unknown }
  ).__CODEINFO_CONFIG__ = undefined;
  _getQueue().length = 0;
  resetClientRuntimeConfigLogForTests();
  jest.clearAllMocks();
  jest.useRealTimers();
  global.fetch = getFetchMock();
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
});

afterEach(() => {
  delete process.env.MODE;
  delete process.env.VITE_CODEINFO_API_URL;
  delete process.env.VITE_CODEINFO_LOG_MAX_BYTES;
  delete process.env.VITE_CODEINFO_LOG_FORWARD_ENABLED;
  delete process.env[legacyClientApiUrlEnvName];
  delete process.env[legacyClientLogForwardEnvName];
  delete process.env[legacyClientLogMaxBytesEnvName];
  delete process.env[legacyClientLogLevelEnvName];
  delete process.env[legacyClientLogStreamEnvName];
  (
    globalThis as typeof globalThis & { __CODEINFO_CONFIG__?: unknown }
  ).__CODEINFO_CONFIG__ = originalRuntimeConfig;
});

describe('transport', () => {
  it('posts queued entries and clears the queue', async () => {
    getFetchMock().mockResolvedValue(mockJsonResponse({}, { status: 200 }));

    sendLogs([baseEntry]);
    await flushQueue();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5010/logs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(_getQueue().length).toBe(0);
  });

  it('drops entries that exceed max bytes', async () => {
    process.env.VITE_CODEINFO_LOG_MAX_BYTES = '10';
    getFetchMock().mockResolvedValue(mockJsonResponse({}, { status: 200 }));

    sendLogs([{ ...baseEntry, message: 'a'.repeat(50) }]);
    await flushQueue();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(_getQueue().length).toBe(0);
  });

  it('retries with backoff when the request fails', async () => {
    jest.useFakeTimers();
    getFetchMock()
      .mockResolvedValueOnce(mockJsonResponse({}, { status: 500 }))
      .mockResolvedValueOnce(mockJsonResponse({}, { status: 200 }));

    sendLogs([baseEntry]);
    await flushQueue();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(_getQueue().length).toBe(1);

    await jest.runOnlyPendingTimersAsync();

    // Allow the scheduled flush to run and resolve its fetch call
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(_getQueue().length).toBe(0);
    jest.useRealTimers();
  });

  it('clears queue when MODE is test', async () => {
    process.env.MODE = 'test';
    sendLogs([baseEntry]);
    await flushQueue();

    expect(_getQueue().length).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ignores pre-cutover client log env names after the cutover', async () => {
    process.env[legacyClientLogForwardEnvName] = 'false';
    process.env[legacyClientLogMaxBytesEnvName] = '10';
    getFetchMock().mockResolvedValue(mockJsonResponse({}, { status: 200 }));

    sendLogs([{ ...baseEntry, message: 'a'.repeat(50) }]);
    await flushQueue();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5010/logs',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(_getQueue().length).toBe(0);
  });

  it('does not treat documentation-only pre-cutover log names as runtime inputs', async () => {
    process.env[legacyClientLogLevelEnvName] = 'debug';
    process.env[legacyClientLogStreamEnvName] = 'false';
    getFetchMock().mockResolvedValue(mockJsonResponse({}, { status: 200 }));

    sendLogs([baseEntry]);
    await flushQueue();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5010/logs',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(_getQueue().length).toBe(0);
  });

  it('surfaces malformed canonical log config before falling back to defaults', async () => {
    process.env.VITE_CODEINFO_LOG_FORWARD_ENABLED = 'maybe';
    process.env.VITE_CODEINFO_LOG_MAX_BYTES = 'zero';
    getFetchMock().mockResolvedValue(mockJsonResponse({}, { status: 200 }));

    sendLogs([baseEntry]);
    await flushQueue();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5010/logs',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(getClientRuntimeConfigDiagnostics()).toEqual([
      {
        field: 'logForwardEnabled',
        source: 'env',
        rawValue: 'maybe',
        reason: 'invalid_boolean',
      },
      {
        field: 'logMaxBytes',
        source: 'env',
        rawValue: 'zero',
        reason: 'invalid_number',
      },
    ]);
    expect(
      hasInvalidCanonicalRuntimeConfig(getClientRuntimeConfigDiagnostics()),
    ).toBe(false);
    expect(_getQueue().length).toBe(0);
  });

  it('surfaces malformed top-level runtime config containers before log env fallback wins', async () => {
    (
      globalThis as typeof globalThis & { __CODEINFO_CONFIG__?: unknown }
    ).__CODEINFO_CONFIG__ = ['bad-container'];
    getFetchMock().mockResolvedValue(mockJsonResponse({}, { status: 200 }));

    sendLogs([baseEntry]);
    await flushQueue();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5010/logs',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(getClientRuntimeConfigDiagnostics()).toEqual([
      {
        container: '__CODEINFO_CONFIG__',
        source: 'runtime',
        rawValue: '["bad-container"]',
        reason: 'invalid_container',
      },
    ]);
    expect(
      hasInvalidCanonicalRuntimeConfig(getClientRuntimeConfigDiagnostics()),
    ).toBe(true);
    expect(_getQueue().length).toBe(0);
  });
});
