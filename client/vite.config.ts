import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import {
  describePreviewAllowedHosts,
  resolvePreviewAllowedHosts,
} from './src/config/previewAllowedHosts';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const previewAllowedHosts = resolvePreviewAllowedHosts(
    env.VITE_CODEINFO_PREVIEW_ALLOWED_HOSTS,
  );

  console.info('DEV_0000053_VITE_PREVIEW_ALLOWED_HOSTS', {
    configuredValue: env.VITE_CODEINFO_PREVIEW_ALLOWED_HOSTS ?? '',
    resolvedMode: describePreviewAllowedHosts(previewAllowedHosts),
  });

  return {
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
      allowedHosts: previewAllowedHosts,
    },
    resolve: {
      alias: {
        '@codeinfo2/common': path.resolve(__dirname, '../common/src'),
      },
    },
  };
});
