import { EventEmitter } from 'node:events';
import { LogEntry, LogLevel } from '@codeinfo2/common';
import { baseLogger, resolveLogConfig } from './logger.js';

export type Filters = {
  level?: LogLevel[];
  source?: string[];
  text?: string;
  since?: number;
  until?: number;
  sinceSequence?: number;
};

const { bufferMax: maxEntries } = resolveLogConfig();
const store: LogEntry[] = [];
let sequence = 0;
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

function matchesFilters(entry: LogEntry, filters: Filters) {
  if (filters.level && !filters.level.includes(entry.level)) return false;
  if (filters.source && !filters.source.includes(entry.source)) return false;
  if (
    filters.text &&
    !`${entry.message} ${JSON.stringify(entry.context ?? {})}`
      .toLowerCase()
      .includes(filters.text.toLowerCase())
  )
    return false;
  if (filters.since && new Date(entry.timestamp).getTime() < filters.since)
    return false;
  if (filters.until && new Date(entry.timestamp).getTime() > filters.until)
    return false;
  if (
    typeof filters.sinceSequence === 'number' &&
    typeof entry.sequence === 'number' &&
    entry.sequence <= filters.sinceSequence
  )
    return false;
  return true;
}

export function append(entry: LogEntry): LogEntry {
  const enriched = { ...entry, sequence: ++sequence };
  store.push(enriched);
  if (store.length > maxEntries) store.shift();

  if (enriched.source === 'client') {
    const ctx = enriched.context ?? {};
    const clientId =
      typeof ctx.clientId === 'string' && ctx.clientId.trim()
        ? ctx.clientId
        : undefined;
    const payload = {
      source: enriched.source,
      clientId,
      sequence: enriched.sequence,
      entryLevel: enriched.level,
      message: enriched.message,
      timestamp: enriched.timestamp,
      requestId: enriched.requestId,
      correlationId: enriched.correlationId,
      route: enriched.route,
      userAgent: enriched.userAgent,
      tags: enriched.tags,
      context: ctx,
    };

    if (enriched.level === 'error') {
      baseLogger.error(payload, 'CLIENT_LOG');
    } else if (enriched.level === 'warn') {
      baseLogger.warn(payload, 'CLIENT_LOG');
    } else if (enriched.level === 'debug') {
      baseLogger.debug(payload, 'CLIENT_LOG');
    } else {
      baseLogger.info(payload, 'CLIENT_LOG');
    }
  }

  emitter.emit('append', enriched);
  return enriched;
}

export function query(filters: Filters, limit = 200) {
  return store.filter((entry) => matchesFilters(entry, filters)).slice(-limit);
}

export function lastSequence() {
  return sequence;
}

export function subscribe(handler: (entry: LogEntry) => void) {
  emitter.on('append', handler);
  return () => emitter.off('append', handler);
}

export function entryMatches(entry: LogEntry, filters: Filters) {
  return matchesFilters(entry, filters);
}

export function resetStore() {
  store.length = 0;
  sequence = 0;
  emitter.removeAllListeners();
  emitter.setMaxListeners(0);
}
