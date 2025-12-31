/* eslint no-console: "warn" */
import { LogEntry, LogLevel } from '@codeinfo2/common';
import { sendLogs } from './transport';

const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
const CLIENT_ID_STORAGE_KEY = 'codeinfo2.clientId';
let inMemoryClientId: string | null = null;

function generateClientId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export function resolveStableClientId(params?: {
  storage?: Storage | null;
}): string {
  if (inMemoryClientId) return inMemoryClientId;

  const storage =
    params?.storage ??
    (typeof window !== 'undefined' ? (window.localStorage ?? null) : null);

  if (storage) {
    try {
      const existing = storage.getItem(CLIENT_ID_STORAGE_KEY);
      if (existing && existing.trim()) {
        inMemoryClientId = existing;
        return existing;
      }

      const next = generateClientId();
      storage.setItem(CLIENT_ID_STORAGE_KEY, next);
      inMemoryClientId = next;
      return next;
    } catch {
      // localStorage can throw (blocked/quota/private-mode). Fall back to in-memory.
    }
  }

  inMemoryClientId = generateClientId();
  return inMemoryClientId;
}

export function createLogger(
  source = 'client',
  routeProvider: () => string = () => window.location.pathname,
) {
  const clientId = resolveStableClientId();
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
      context: { ...context, clientId },
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

export function _resetClientIdForTests() {
  inMemoryClientId = null;
}
