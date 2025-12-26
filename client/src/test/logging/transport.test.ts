import { LogEntry } from '@codeinfo2/common';
import { jest } from '@jest/globals';
import { flushQueue, sendLogs, _getQueue } from '../../logging/transport';

const baseEntry: LogEntry = {
  level: 'info',
  message: 'hello',
  timestamp: '2025-01-01T00:00:00.000Z',
  source: 'client',
};

beforeEach(() => {
  process.env.MODE = 'development';
  process.env.VITE_API_URL = 'http://localhost:5010';
  process.env.VITE_LOG_MAX_BYTES = '32768';
  _getQueue().length = 0;
  jest.clearAllMocks();
  jest.useRealTimers();
  global.fetch = jest.fn();
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
});

afterEach(() => {
  delete process.env.MODE;
  delete process.env.VITE_API_URL;
  delete process.env.VITE_LOG_MAX_BYTES;
});

describe('transport', () => {
  it('posts queued entries and clears the queue', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

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
    process.env.VITE_LOG_MAX_BYTES = '10';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    sendLogs([{ ...baseEntry, message: 'a'.repeat(50) }]);
    await flushQueue();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(_getQueue().length).toBe(0);
  });

  it('retries with backoff when the request fails', async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true });

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
});
