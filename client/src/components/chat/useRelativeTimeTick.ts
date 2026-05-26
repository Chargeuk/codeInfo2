import { useSyncExternalStore } from 'react';

const DEFAULT_RELATIVE_TIME_REFRESH_MS = 30_000;
const MIN_RELATIVE_TIME_REFRESH_MS = 1_000;

type Env = Record<string, string | undefined>;

const listeners = new Set<() => void>();
let intervalId: number | null = null;
let snapshotNowMs = Date.now();

const readEnv = (): Env => {
  const metaEnv =
    typeof import.meta !== 'undefined'
      ? (((import.meta as unknown as { env?: Env }).env ?? {}) as Env)
      : {};
  const processEnv = typeof process !== 'undefined' ? (process.env as Env) : {};
  return { ...processEnv, ...metaEnv };
};

export const getRelativeTimeRefreshIntervalMs = () => {
  const rawValue = readEnv().VITE_CODEINFO_RELATIVE_TIME_REFRESH_MS?.trim();
  if (!rawValue) {
    return DEFAULT_RELATIVE_TIME_REFRESH_MS;
  }

  const parsed = Number(rawValue);
  if (
    Number.isFinite(parsed) &&
    parsed >= MIN_RELATIVE_TIME_REFRESH_MS &&
    Number.isInteger(parsed)
  ) {
    return parsed;
  }

  return DEFAULT_RELATIVE_TIME_REFRESH_MS;
};

const emit = () => {
  snapshotNowMs = Date.now();
  listeners.forEach((listener) => listener());
};

const stopTimer = () => {
  if (intervalId == null || typeof window === 'undefined') {
    return;
  }
  window.clearInterval(intervalId);
  intervalId = null;
};

const ensureTimer = () => {
  if (intervalId != null || typeof window === 'undefined') {
    return;
  }

  snapshotNowMs = Date.now();
  intervalId = window.setInterval(emit, getRelativeTimeRefreshIntervalMs());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  ensureTimer();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTimer();
    }
  };
};

const getSnapshot = () => snapshotNowMs;

export const useRelativeTimeTick = () =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
