import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'playwright-output',
  // Start conservatively with two workers to reduce wall-clock time without
  // turning shared-state issues into a large blast radius on the first pass.
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001',
    screenshot: 'on',
    trace: 'on',
    video: 'off',
  },
});
