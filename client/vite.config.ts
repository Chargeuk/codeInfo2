import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
