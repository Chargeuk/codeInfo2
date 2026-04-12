#!/usr/bin/env node

const parseDelay = (rawValue, fallbackMs) => {
  if (!rawValue) return fallbackMs;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 100 ? parsed : fallbackMs;
};

const delayMs = parseDelay(
  process.env.CODEINFO_DEBUG_ACTIVE_RESOURCES_DELAY_MS,
  15_000,
);
const intervalMs = parseDelay(
  process.env.CODEINFO_DEBUG_ACTIVE_RESOURCES_INTERVAL_MS,
  15_000,
);
const label =
  process.env.CODEINFO_DEBUG_ACTIVE_RESOURCES_LABEL ?? 'active-resources';

const summarizeResources = () => {
  const resources = process.getActiveResourcesInfo?.() ?? [];
  const counts = new Map();
  for (const resource of resources) {
    counts.set(resource, (counts.get(resource) ?? 0) + 1);
  }

  return {
    total: resources.length,
    resources,
    counts: Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
};

const emitSnapshot = (reason) => {
  const snapshot = summarizeResources();
  console.error(
    `[${label}] ${JSON.stringify({
      timestamp: new Date().toISOString(),
      reason,
      ...snapshot,
    })}`,
  );
};

const interval = setInterval(() => emitSnapshot('interval'), intervalMs);
interval.unref?.();

const timer = setTimeout(() => emitSnapshot('initial_delay'), delayMs);
timer.unref?.();

process.on('SIGINT', () => {
  emitSnapshot('sigint');
});

process.on('SIGTERM', () => {
  emitSnapshot('sigterm');
});
