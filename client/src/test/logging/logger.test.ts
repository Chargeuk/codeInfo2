import { jest } from '@jest/globals';
import { createLogger, installGlobalErrorHooks } from '../../logging';
import { _getQueue } from '../../logging/transport';

describe('createLogger', () => {
  afterEach(() => {
    _getQueue().length = 0;
    jest.clearAllMocks();
  });

  it('forwards enriched log entries with route and source', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    const log = createLogger('client-test', () => '/route');
    const before = Date.now();

    log('warn', 'hello', { foo: 'bar' });

    expect(_getQueue().length).toBe(1);
    const entry = _getQueue()[0];
    expect(entry).toMatchObject({
      level: 'warn',
      message: 'hello',
      source: 'client-test',
      route: '/route',
      context: { foo: 'bar' },
    });
    expect(Date.parse(entry.timestamp)).toBeGreaterThanOrEqual(before);
  });
});

describe('installGlobalErrorHooks', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('throttles repeated window errors', () => {
    jest.useFakeTimers();
    const logSpy = jest.fn();
    const log: ReturnType<typeof createLogger> = ((level, message, context) =>
      logSpy(level, message, context)) as ReturnType<typeof createLogger>;
    installGlobalErrorHooks(log);

    window.onerror?.('boom', '/x', 1, 1, new Error('x'));
    window.onerror?.('boom2', '/x', 1, 1, new Error('y'));

    expect(logSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1001);
    window.onunhandledrejection?.({ reason: 'nope' } as PromiseRejectionEvent);

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenLastCalledWith('error', 'unhandledrejection', {
      reason: 'nope',
    });
  });
});
