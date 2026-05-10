import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, mock } from 'node:test';
import pino from 'pino';
import { refreshCodexDetection } from '../../providers/codexDetection.js';
import { ensureCodexAuthFromHost } from '../../utils/codexAuthCopy.js';

const logger = pino({ level: 'silent' });
const tmpDirs: string[] = [];

afterEach(() => {
  tmpDirs.forEach((dir) => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });
  tmpDirs.length = 0;
});

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

test('shared-home startup keeps one writable auth authority across repeated calls', () => {
  const containerHome = makeTempDir('codex-container-');
  const sharedAuth = path.join(containerHome, 'auth.json');
  fs.writeFileSync(sharedAuth, '{"token":"shared"}');

  ensureCodexAuthFromHost({
    containerHome,
    hostHome: containerHome,
    logger,
  });
  ensureCodexAuthFromHost({
    containerHome,
    hostHome: containerHome,
    logger,
  });

  assert.equal(fs.readFileSync(sharedAuth, 'utf8'), '{"token":"shared"}');
});

test('shared-home refresh detection stays available when auth lives in the runtime home', () => {
  const containerHome = makeTempDir('codex-container-');
  const configPath = path.join(containerHome, 'config.toml');

  fs.writeFileSync(configPath, 'model = "gpt-5.3-codex"\n');
  fs.writeFileSync(path.join(containerHome, 'auth.json'), '{"token":"shared"}');

  ensureCodexAuthFromHost({
    containerHome,
    hostHome: containerHome,
    logger,
  });

  const after = refreshCodexDetection({
    codexHome: containerHome,
    resolveCliPath: () => '/usr/local/bin/codex',
  });
  assert.equal(after.available, true);
  assert.equal(after.authPresent, true);
  assert.equal(after.configPresent, true);
});

test('shared-home auth validation does not execute destructive delete operations', () => {
  const containerHome = makeTempDir('codex-container-');
  fs.writeFileSync(path.join(containerHome, 'auth.json'), '{"token":"shared"}');
  const unlinkCalls: string[] = [];
  const rmCalls: string[] = [];
  mock.method(fs, 'unlinkSync', (targetPath: fs.PathLike) => {
    unlinkCalls.push(String(targetPath));
  });
  mock.method(fs, 'rmSync', (targetPath: fs.PathLike) => {
    rmCalls.push(String(targetPath));
  });

  try {
    ensureCodexAuthFromHost({
      containerHome,
      hostHome: containerHome,
      logger,
    });
    assert.equal(unlinkCalls.length, 0);
    assert.equal(rmCalls.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test('shared-home auth validation does not execute rename or move operations', () => {
  const containerHome = makeTempDir('codex-container-');
  fs.writeFileSync(path.join(containerHome, 'auth.json'), '{"token":"shared"}');
  const renameCalls: Array<{ from: string; to: string }> = [];
  mock.method(
    fs,
    'renameSync',
    (oldPath: fs.PathLike, newPath: fs.PathLike) => {
      renameCalls.push({ from: String(oldPath), to: String(newPath) });
    },
  );

  try {
    ensureCodexAuthFromHost({
      containerHome,
      hostHome: containerHome,
      logger,
    });
    assert.equal(renameCalls.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test('split host auth seeds the runtime home before detection runs', () => {
  const containerHome = makeTempDir('codex-container-');
  const hostHome = makeTempDir('codex-host-');
  const configPath = path.join(containerHome, 'config.toml');

  fs.writeFileSync(configPath, 'model = "gpt-5.3-codex"\n');
  fs.writeFileSync(path.join(hostHome, 'auth.json'), '{"token":"host"}');

  ensureCodexAuthFromHost({ containerHome, hostHome, logger });

  assert.equal(
    fs.readFileSync(path.join(containerHome, 'auth.json'), 'utf8'),
    '{"token":"host"}',
  );

  const after = refreshCodexDetection({
    codexHome: containerHome,
    resolveCliPath: () => '/usr/local/bin/codex',
  });
  assert.equal(after.available, true);
  assert.equal(after.authPresent, true);
  assert.equal(after.configPresent, true);
});

test('split host and runtime auth preserves the runtime copy when both are present', () => {
  const containerHome = makeTempDir('codex-container-');
  const hostHome = makeTempDir('codex-host-');
  fs.writeFileSync(
    path.join(containerHome, 'auth.json'),
    '{"token":"container"}',
  );
  fs.writeFileSync(path.join(hostHome, 'auth.json'), '{"token":"host"}');

  ensureCodexAuthFromHost({ containerHome, hostHome, logger });

  assert.equal(
    fs.readFileSync(path.join(containerHome, 'auth.json'), 'utf8'),
    '{"token":"container"}',
  );
});
