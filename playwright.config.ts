import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
});
