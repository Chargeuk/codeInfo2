import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
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

test('startup copy copies once and does not overwrite on subsequent calls', () => {
  const containerHome = makeTempDir('codex-container-');
  const hostHome = makeTempDir('codex-host-');
  const hostAuth = path.join(hostHome, 'auth.json');
  fs.writeFileSync(hostAuth, '{"token":"host"}');

  ensureCodexAuthFromHost({ containerHome, hostHome, logger });
  const containerAuthPath = path.join(containerHome, 'auth.json');
  assert.equal(fs.readFileSync(containerAuthPath, 'utf8'), '{"token":"host"}');

  // change host auth and rerun; container should stay the same
  fs.writeFileSync(hostAuth, '{"token":"new-host"}');
  ensureCodexAuthFromHost({ containerHome, hostHome, logger });

  assert.equal(fs.readFileSync(containerAuthPath, 'utf8'), '{"token":"host"}');
});

test('shared-home refresh detection transitions to available after host auth copy', () => {
  const containerHome = makeTempDir('codex-container-');
  const hostHome = makeTempDir('codex-host-');
  const configPath = path.join(containerHome, 'config.toml');
  const hostAuth = path.join(hostHome, 'auth.json');

  fs.writeFileSync(configPath, 'model = "gpt-5.3-codex"\n');
  fs.writeFileSync(hostAuth, '{"token":"host"}');

  const before = refreshCodexDetection({
    codexHome: containerHome,
    resolveCliPath: () => '/usr/local/bin/codex',
  });
  assert.equal(before.available, false);

  ensureCodexAuthFromHost({ containerHome, hostHome, logger });

  const after = refreshCodexDetection({
    codexHome: containerHome,
    resolveCliPath: () => '/usr/local/bin/codex',
  });
  assert.equal(after.available, true);
  assert.equal(after.authPresent, true);
  assert.equal(after.configPresent, true);
});
