import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
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

test('copies host auth when container auth is missing', () => {
  const containerHome = makeTempDir('codex-container-');
  const hostHome = makeTempDir('codex-host-');
  const hostAuth = path.join(hostHome, 'auth.json');
  fs.writeFileSync(hostAuth, '{"token":"host"}');

  ensureCodexAuthFromHost({ containerHome, hostHome, logger });

  const containerAuth = path.join(containerHome, 'auth.json');
  assert.ok(fs.existsSync(containerAuth));
  assert.equal(fs.readFileSync(containerAuth, 'utf8'), '{"token":"host"}');
});

test('does not overwrite existing container auth', () => {
  const containerHome = makeTempDir('codex-container-');
  const hostHome = makeTempDir('codex-host-');
  const containerAuth = path.join(containerHome, 'auth.json');
  const hostAuth = path.join(hostHome, 'auth.json');
  fs.writeFileSync(containerAuth, '{"token":"container"}');
  fs.writeFileSync(hostAuth, '{"token":"host"}');

  ensureCodexAuthFromHost({ containerHome, hostHome, logger });

  assert.equal(fs.readFileSync(containerAuth, 'utf8'), '{"token":"container"}');
});

test('skips when host auth is missing', () => {
  const containerHome = makeTempDir('codex-container-');
  const hostHome = makeTempDir('codex-host-');

  ensureCodexAuthFromHost({ containerHome, hostHome, logger });

  const containerAuth = path.join(containerHome, 'auth.json');
  assert.ok(!fs.existsSync(containerAuth));
});
