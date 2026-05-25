import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

test('server unit summary wrapper uses repo-local agent roots while preserving the other inherited CODEINFO and CODEX env', () => {
  const inheritedKeys = [
    'CODEINFO_ROOT',
    'CODEINFO_HOST_INGEST_DIR',
    'CODEINFO_COPILOT_HOME',
    'CODEINFO_CODEX_HOME',
    'CODEX_HOME',
    'CODEX_WORKDIR',
  ];

  for (const key of inheritedKeys) {
    assert.ok(
      typeof process.env[key] === 'string' && process.env[key].length > 0,
      `${key} should be inherited by the wrapper`,
    );
  }

  assert.equal(
    process.env.CODEINFO_AGENT_HOME,
    path.resolve(process.cwd(), '../codeinfo_agents'),
  );
  assert.equal(
    process.env.CODEINFO_CODEX_AGENT_HOME,
    path.resolve(process.cwd(), '../codex_agents'),
  );
  assert.equal(process.env.CODEINFO_LOG_FILE_PATH, '../logs/server-test.log');
  assert.equal(process.env.CODEINFO_CHROMA_URL, '');
  assert.equal(process.env.CODEINFO_MONGO_URI, '');
  assert.equal(
    process.env.CODEINFO_PLAYWRIGHT_MCP_URL,
    'http://localhost:8932/mcp',
  );
  assert.equal(process.env.TS_NODE_DEBUG, 'false');
  assert.equal(process.env.TS_NODE_LOG_ERROR, 'true');
  assert.equal(process.env.TS_NODE_FILES, 'true');
  assert.equal(process.env.TS_NODE_PROJECT, './tsconfig.json');
  assert.match(
    process.env.NODE_OPTIONS ?? '',
    /--max-old-space-size=6144/,
  );
  assert.match(
    process.env.NODE_OPTIONS ?? '',
    /--import \.\/scripts\/register-ts-node-esm-loader\.mjs/,
  );
});
