import { availableParallelism } from 'node:os';
import { defineConfig } from '@playwright/test';

const resolvePlaywrightWorkers = () => {
  const explicitWorkers = Number.parseInt(
    process.env.PLAYWRIGHT_WORKERS ?? '',
    10,
  );
  if (Number.isFinite(explicitWorkers) && explicitWorkers >= 1) {
    return explicitWorkers;
  }

  const availableCores = Math.max(1, availableParallelism());
  const requestedWorkers = Math.max(2, Math.floor(availableCores / 2));
  return Math.min(availableCores, requestedWorkers);
};

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'playwright-output',
  workers: resolvePlaywrightWorkers(),
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001',
    screenshot: 'on',
    trace: 'on',
    video: 'off',
  },
});
