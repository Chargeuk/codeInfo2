import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { ensureCodexAuthFileStore } from '../../config/codexConfig.js';
import { refreshCodexDetection } from '../../providers/codexDetection.js';
import { getCodexDetection } from '../../providers/codexRegistry.js';

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

test('refreshCodexDetection updates shared-home availability after auth appears', async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const configPath = path.join(codexHome, 'config.toml');
  const authPath = path.join(codexHome, 'auth.json');
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];
  mock.method(console, 'info', (...args: unknown[]) => {
    infoLogs.push(args.map(String).join(' '));
  });
  mock.method(console, 'error', (...args: unknown[]) => {
    errorLogs.push(args.map(String).join(' '));
  });
  try {
    await fs.writeFile(configPath, 'model = "gpt-5.3-codex"\n', 'utf8');

    const before = refreshCodexDetection({
      codexHome,
      resolveCliPath: () => '/usr/local/bin/codex',
    });
    assert.equal(before.available, false);
    assert.equal(getCodexDetection().available, false);

    await fs.writeFile(authPath, '{"token":"seeded"}', 'utf8');

    const after = refreshCodexDetection({
      codexHome,
      resolveCliPath: () => '/usr/local/bin/codex',
    });
    assert.equal(after.available, true);
    assert.equal(getCodexDetection().available, true);
    assert(
      errorLogs.some((line) =>
        line.includes(
          '[DEV-0000037][T08] event=shared_home_detection_completed result=error',
        ),
      ),
    );
    assert(
      infoLogs.some((line) =>
        line.includes(
          '[DEV-0000037][T08] event=shared_home_detection_completed result=success',
        ),
      ),
    );
  } finally {
    mock.restoreAll();
    await fs.rm(codexHome, { recursive: true, force: true });
  }
});
