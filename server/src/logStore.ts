import { EventEmitter } from 'node:events';
import { LogEntry, LogLevel } from '@codeinfo2/common';
import { resolveLogConfig } from './logger.js';

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
  // TODO: forward appended logs to baseLogger destination when file wiring is added.
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
