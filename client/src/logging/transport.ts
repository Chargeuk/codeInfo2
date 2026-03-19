import { LogEntry } from '@codeinfo2/common';
import {
  getApiBaseUrl,
  getLogForwardEnabled,
  getLogMaxBytes,
  hasBlockingApiBaseUrlConfigIssue,
} from '../config/runtimeConfig';

const queue: LogEntry[] = [];
const MAX_BATCH = 10;
const BACKOFF = [500, 1000, 2000, 4000];
let backoffIndex = 0;
let inFlight = false;

export async function flushQueue() {
  if (inFlight || queue.length === 0) return;
  const env =
    typeof process !== 'undefined'
      ? ((process.env as unknown as { MODE?: string }) ?? {})
      : {};
  if (env.MODE === 'test') {
    queue.length = 0;
    return;
  }
  if (!getLogForwardEnabled()) {
    queue.length = 0;
    return;
  }
  if (hasBlockingApiBaseUrlConfigIssue()) {
    queue.length = 0;
    return;
  }
  if (!navigator.onLine) return;

  const batch = queue.splice(0, MAX_BATCH);
  inFlight = true;
  try {
    const res = await fetch(new URL('/logs', getApiBaseUrl()).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    backoffIndex = 0;
  } catch {
    queue.unshift(...batch);
    const delay = BACKOFF[Math.min(backoffIndex++, BACKOFF.length - 1)];
    setTimeout(flushQueue, delay);
  } finally {
    inFlight = false;
    if (queue.length > 0 && backoffIndex === 0) {
      void flushQueue();
    }
  }
}

export function sendLogs(entries: LogEntry[]) {
  const maxBytes = getLogMaxBytes();
  entries.forEach((e) => {
    if (JSON.stringify(e).length <= maxBytes) queue.push(e);
  });
  void flushQueue();
}

export function _getQueue() {
  return queue;
}
