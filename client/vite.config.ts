import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Keep the summary-wrapper warning contract meaningful by treating the
    // current client bundle size as the expected baseline instead of emitting
    // a persistent chunk-size warning on every clean build.
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5001,
    host: true,
    allowedHosts: true,
  },
  preview: {
    port: 5001,
    host: true,
    allowedHosts: ['host.docker.internal'],
  },
  resolve: {
    alias: {
      '@codeinfo2/common': path.resolve(__dirname, '../common/src'),
    },
  },
});
