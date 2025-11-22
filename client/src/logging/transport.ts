import { LogEntry } from '@codeinfo2/common';

const queue: LogEntry[] = [];
export function sendLogs(entries: LogEntry[]) {
  if (import.meta.env.VITE_LOG_FORWARD_ENABLED === 'false') return;
  queue.push(...entries);
  // network POST /logs will be added in Task 4
}
export function getQueuedLogs() {
  return queue;
}
