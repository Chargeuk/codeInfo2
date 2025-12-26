/* eslint no-console: "warn" */
import { LogEntry, LogLevel } from '@codeinfo2/common';
import { sendLogs } from './transport';

const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];

export function createLogger(
  source = 'client',
  routeProvider: () => string = () => window.location.pathname,
) {
  return (
    level: LogLevel,
    message: string,
    context: Record<string, unknown> = {},
  ) => {
    const resolvedLevel = levels.includes(level) ? level : 'info';
    const entry: LogEntry = {
      level: resolvedLevel,
      message,
      timestamp: new Date().toISOString(),
      source,
      route: routeProvider(),
      userAgent: navigator.userAgent,
      correlationId: crypto.randomUUID?.(),
      context,
    };
    // tee to console for dev ergonomics
    // eslint-disable-next-line no-console
    console[resolvedLevel === 'error' ? 'error' : 'log'](entry);
    sendLogs([entry]);
  };
}

export function installGlobalErrorHooks(log = createLogger('client-global')) {
  let lastError = 0;
  const minGap = 1000;

  window.onerror = (msg, url, line, col, err) => {
    if (Date.now() - lastError < minGap) return;
    lastError = Date.now();
    log('error', 'window.onerror', { msg, url, line, col, error: String(err) });
  };

  window.onunhandledrejection = (event) => {
    if (Date.now() - lastError < minGap) return;
    lastError = Date.now();
    log('error', 'unhandledrejection', { reason: String(event.reason) });
  };
}
