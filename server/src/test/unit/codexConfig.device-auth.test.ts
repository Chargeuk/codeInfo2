import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureCodexAuthFileStore } from '../../config/codexConfig.js';

async function withTempConfig(
  contents: string,
  fn: (configPath: string) => Promise<void>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-config-'));
  const configPath = path.join(dir, 'config.toml');
  await fs.writeFile(configPath, contents, 'utf8');
  try {
    await fn(configPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('writes file-store setting when missing', async () => {
  await withTempConfig('model = "gpt-5.1-codex"\n', async (configPath) => {
    const result = await ensureCodexAuthFileStore(configPath);
    const updated = await fs.readFile(configPath, 'utf8');
    assert.match(updated, /cli_auth_credentials_store\s*=\s*"file"/);
    assert.equal(result.changed, true);
  });
});

test('leaves existing file-store setting unchanged', async () => {
  const contents =
    'model = "gpt-5.1-codex"\ncli_auth_credentials_store = "file"\n';
  await withTempConfig(contents, async (configPath) => {
    const result = await ensureCodexAuthFileStore(configPath);
    const updated = await fs.readFile(configPath, 'utf8');
    assert.equal(updated, contents);
    assert.equal(result.changed, false);
  });
});
