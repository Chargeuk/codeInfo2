import { SUMMARY_WRAPPER_DEBUG_LIFECYCLE_ENV } from './summary-wrapper-protocol.mjs';

export const buildServerUnitWrapperEnv = (baseEnv = process.env) => ({
  ...baseEnv,
  CODEINFO_LOG_FILE_PATH: '../logs/server-test.log',
  CODEINFO_CHROMA_URL: '',
  CODEINFO_MONGO_URI: '',
  CODEINFO_PLAYWRIGHT_MCP_URL: 'http://localhost:8932/mcp',
  [SUMMARY_WRAPPER_DEBUG_LIFECYCLE_ENV]:
    baseEnv[SUMMARY_WRAPPER_DEBUG_LIFECYCLE_ENV],
  TS_NODE_DEBUG: 'false',
  TS_NODE_LOG_ERROR: 'true',
  TS_NODE_FILES: 'true',
  TS_NODE_PROJECT: './tsconfig.json',
  NODE_OPTIONS:
    '--max-old-space-size=6144 --import ./scripts/register-ts-node-esm-loader.mjs --trace-uncaught --disable-warning=DEP0180',
});
