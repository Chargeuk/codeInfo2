import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUMMARY_WRAPPER_DEBUG_LIFECYCLE_ENV } from './summary-wrapper-protocol.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export const buildServerUnitWrapperEnv = (baseEnv = process.env) => {
  const defaultAgentHome = path.join(rootDir, 'codeinfo_agents');
  const defaultLegacyAgentHome = path.join(rootDir, 'codex_agents');
  return {
    ...baseEnv,
    // Unit and integration suites should resolve repository-backed agents and
    // CODEINFO_ROOT against this checkout, not against the outer Codex harness.
    CODEINFO_AGENT_HOME: defaultAgentHome,
    CODEINFO_CODEX_AGENT_HOME: defaultLegacyAgentHome,
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
  };
};
