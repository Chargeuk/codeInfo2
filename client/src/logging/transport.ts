import { LogEntry } from '@codeinfo2/common';
import { getApiBaseUrl } from '../api/baseUrl';

const queue: LogEntry[] = [];
const MAX_BATCH = 10;
const BACKOFF = [500, 1000, 2000, 4000];
let backoffIndex = 0;
let inFlight = false;

type Env = { [key: string]: string | undefined };
function getEnv(): Env {
  // import.meta is available in ESM; env may be undefined outside Vite so we guard it.
  const metaEnv = ((import.meta as unknown as { env?: Env }).env ?? {}) as Env;
  const processEnv =
    typeof process !== 'undefined' ? (process.env as unknown as Env) : {};
  return { ...metaEnv, ...processEnv };
}

export async function flushQueue() {
  if (inFlight || queue.length === 0) return;
  const env = getEnv();
  if (env.MODE === 'test') {
    queue.length = 0;
    return;
  }
  if (env.VITE_LOG_FORWARD_ENABLED === 'false') {
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
  const env = getEnv();
  const maxBytes = Number(env.VITE_LOG_MAX_BYTES || 32768);
  entries.forEach((e) => {
    if (JSON.stringify(e).length <= maxBytes) queue.push(e);
  });
  void flushQueue();
}

export function _getQueue() {
  return queue;
}
