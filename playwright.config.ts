import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  use: {
    screenshot: 'on',
    trace: 'on',
    video: 'off',
  },
});
