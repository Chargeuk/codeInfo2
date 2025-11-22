import { LogEntry, LogLevel } from '@codeinfo2/common';
import { resolveLogConfig } from './logger.js';

type Filters = {
  level?: LogLevel[];
  source?: string[];
  text?: string;
  since?: number;
  until?: number;
};

const { bufferMax: maxEntries } = resolveLogConfig();
const store: LogEntry[] = [];
let sequence = 0;

export function append(entry: LogEntry): LogEntry {
  const enriched = { ...entry, sequence: ++sequence };
  store.push(enriched);
  if (store.length > maxEntries) store.shift();
  // TODO: forward appended logs to baseLogger destination when file wiring is added.
  return enriched;
}

export function query(filters: Filters, limit = 200) {
  return store
    .filter((e) => !filters.level || filters.level.includes(e.level))
    .filter((e) => !filters.source || filters.source.includes(e.source))
    .filter(
      (e) =>
        !filters.text ||
        `${e.message} ${JSON.stringify(e.context ?? {})}`
          .toLowerCase()
          .includes(filters.text.toLowerCase()),
    )
    .filter(
      (e) => !filters.since || new Date(e.timestamp).getTime() >= filters.since,
    )
    .filter(
      (e) => !filters.until || new Date(e.timestamp).getTime() <= filters.until,
    )
    .slice(-limit);
}

export function lastSequence() {
  return sequence;
}
