import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildServerUnitWrapperEnv } from './test-summary-server-unit-env.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('server unit summary wrapper uses repo-local agent roots while preserving the other inherited CODEINFO and CODEX env', () => {
  const wrapped = buildServerUnitWrapperEnv({
    CODEINFO_ROOT: '/tmp/harness-root',
    CODEINFO_HOST_INGEST_DIR: '/tmp/ingest-root',
    CODEINFO_COPILOT_HOME: '/tmp/copilot-home',
    CODEINFO_CODEX_HOME: '/tmp/codeinfo-codex-home',
    CODEX_HOME: '/tmp/codex-home',
  });

  assert.equal(wrapped.CODEINFO_ROOT, '/tmp/harness-root');
  assert.equal(wrapped.CODEINFO_HOST_INGEST_DIR, '/tmp/ingest-root');
  assert.equal(wrapped.CODEINFO_COPILOT_HOME, '/tmp/copilot-home');
  assert.equal(wrapped.CODEINFO_CODEX_HOME, '/tmp/codeinfo-codex-home');
  assert.equal(wrapped.CODEX_HOME, '/tmp/codex-home');
  assert.equal(
    wrapped.CODEINFO_AGENT_HOME,
    path.join(repoRoot, 'codeinfo_agents'),
  );
  assert.equal(
    wrapped.CODEINFO_CODEX_AGENT_HOME,
    path.join(repoRoot, 'codex_agents'),
  );
  assert.equal(wrapped.CODEINFO_LOG_FILE_PATH, '../logs/server-test.log');
  assert.equal(wrapped.CODEINFO_CHROMA_URL, '');
  assert.equal(wrapped.CODEINFO_MONGO_URI, '');
  assert.equal(
    wrapped.CODEINFO_PLAYWRIGHT_MCP_URL,
    'http://localhost:8932/mcp',
  );
  assert.equal(wrapped.TS_NODE_DEBUG, 'false');
  assert.equal(wrapped.TS_NODE_LOG_ERROR, 'true');
  assert.equal(wrapped.TS_NODE_FILES, 'true');
  assert.equal(wrapped.TS_NODE_PROJECT, './tsconfig.json');
  assert.match(wrapped.NODE_OPTIONS ?? '', /--max-old-space-size=6144/);
  assert.match(
    wrapped.NODE_OPTIONS ?? '',
    /--import \.\/scripts\/register-ts-node-esm-loader\.mjs/,
  );
});

test('server unit summary wrapper preserves optional inherited CODEINFO and CODEX env when they are provided', () => {
  const wrapped = buildServerUnitWrapperEnv({
    CODEINFO_ROOT: '/tmp/harness-root',
    CODEX_HOME: '/tmp/codex-home',
    CODEX_WORKDIR: '/tmp/codex-workdir',
  });

  assert.equal(wrapped.CODEINFO_ROOT, '/tmp/harness-root');
  assert.equal(wrapped.CODEX_HOME, '/tmp/codex-home');
  assert.equal(wrapped.CODEX_WORKDIR, '/tmp/codex-workdir');
  assert.equal(
    wrapped.CODEINFO_AGENT_HOME,
    path.join(repoRoot, 'codeinfo_agents'),
  );
  assert.equal(
    wrapped.CODEINFO_CODEX_AGENT_HOME,
    path.join(repoRoot, 'codex_agents'),
  );
});
