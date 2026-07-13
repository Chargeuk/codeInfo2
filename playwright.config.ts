import { availableParallelism } from 'node:os';
import { defineConfig } from '@playwright/test';

const parsePositiveInteger = (value: string | undefined) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
};

const resolvePlaywrightWorkers = () => {
  const availableCores = Math.max(1, availableParallelism());
  const explicitWorkers = parsePositiveInteger(process.env.PLAYWRIGHT_WORKERS);
  if (explicitWorkers !== null) {
    return Math.min(availableCores, explicitWorkers);
  }

  const requestedWorkers = Math.max(2, Math.floor(availableCores / 2));
  return Math.min(availableCores, requestedWorkers);
};

export default defineConfig({
  testDir: 'e2e',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'playwright-output',
  workers: resolvePlaywrightWorkers(),
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001',
    screenshot: 'on',
    trace: 'on',
    video: 'off',
  },
});
