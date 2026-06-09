import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, mock } from 'node:test';
import pino from 'pino';
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

test('keeps shared runtime auth when /app/codex already has auth material', () => {
  const containerHome = makeTempDir('codex-container-');
  const sharedAuth = path.join(containerHome, 'auth.json');
  fs.writeFileSync(sharedAuth, '{"token":"shared"}');

  ensureCodexAuthFromHost({
    containerHome,
    hostHome: containerHome,
    logger,
  });

  assert.equal(fs.readFileSync(sharedAuth, 'utf8'), '{"token":"shared"}');
});

test('keeps runtime auth when /host/codex is absent', () => {
  const containerHome = makeTempDir('codex-container-');
  const containerAuth = path.join(containerHome, 'auth.json');
  fs.writeFileSync(containerAuth, '{"token":"container"}');

  ensureCodexAuthFromHost({
    containerHome,
    hostHome: path.join(containerHome, 'missing-host-mount'),
    logger,
  });

  assert.equal(fs.readFileSync(containerAuth, 'utf8'), '{"token":"container"}');
});

test('returns quietly when auth is missing everywhere', () => {
  const containerHome = makeTempDir('codex-container-');

  ensureCodexAuthFromHost({
    containerHome,
    hostHome: path.join(containerHome, 'missing-host-mount'),
    logger,
  });

  const containerAuth = path.join(containerHome, 'auth.json');
  assert.ok(!fs.existsSync(containerAuth));
});

test('copies host auth into the runtime home when split setup has no runtime auth yet', () => {
  const containerHome = makeTempDir('codex-container-');
  const hostHome = makeTempDir('codex-host-');
  fs.writeFileSync(path.join(hostHome, 'auth.json'), '{"token":"host"}');

  ensureCodexAuthFromHost({ containerHome, hostHome, logger });

  assert.equal(
    fs.readFileSync(path.join(containerHome, 'auth.json'), 'utf8'),
    '{"token":"host"}',
  );
});

test('keeps the runtime auth when split setup already has a local auth file', () => {
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

test('does not copy when /host/codex is a duplicate runtime mount alias', () => {
  const containerHome = makeTempDir('codex-container-');
  const hostAliasParent = makeTempDir('codex-host-alias-');
  const hostHome = path.join(hostAliasParent, 'host-codex');
  fs.symlinkSync(containerHome, hostHome);
  const containerAuth = path.join(containerHome, 'auth.json');
  fs.writeFileSync(containerAuth, '{"token":"container"}');
  const copyCalls: Array<{ from: string; to: string }> = [];
  mock.method(
    fs,
    'copyFileSync',
    (source: fs.PathLike, target: fs.PathLike) => {
      copyCalls.push({ from: String(source), to: String(target) });
    },
  );

  try {
    ensureCodexAuthFromHost({ containerHome, hostHome, logger });

    assert.equal(copyCalls.length, 0);
    assert.equal(
      fs.readFileSync(containerAuth, 'utf8'),
      '{"token":"container"}',
    );
  } finally {
    mock.restoreAll();
  }
});
