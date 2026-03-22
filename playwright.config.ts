import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://host.docker.internal:6001',
    screenshot: 'on',
    trace: 'on',
    video: 'off',
  },
});
