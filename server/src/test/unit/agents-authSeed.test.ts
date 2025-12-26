import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import pino from 'pino';

import { ensureAgentAuthSeeded } from '../../agents/authSeed.js';

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

test('copies primary auth.json into agent home when missing', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHome = makeTempDir('codex-agent-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p"}');

  const result = await ensureAgentAuthSeeded({
    agentHome,
    primaryCodexHome,
    logger,
  });

  assert.equal(result.warning, undefined);
  assert.equal(result.seeded, true);
  assert.equal(
    fs.readFileSync(path.join(agentHome, 'auth.json'), 'utf8'),
    '{"token":"p"}',
  );
});

test('never overwrites existing agent auth.json', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHome = makeTempDir('codex-agent-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p"}');
  fs.writeFileSync(path.join(agentHome, 'auth.json'), '{"token":"a"}');

  const result = await ensureAgentAuthSeeded({
    agentHome,
    primaryCodexHome,
    logger,
  });

  assert.equal(result.warning, undefined);
  assert.equal(result.seeded, false);
  assert.equal(
    fs.readFileSync(path.join(agentHome, 'auth.json'), 'utf8'),
    '{"token":"a"}',
  );
});

test('lock-protects concurrent auth seeding calls', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHome = makeTempDir('codex-agent-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p"}');

  const [a, b] = await Promise.all([
    ensureAgentAuthSeeded({ agentHome, primaryCodexHome, logger }),
    ensureAgentAuthSeeded({ agentHome, primaryCodexHome, logger }),
  ]);

  assert.equal(a.warning, undefined);
  assert.equal(b.warning, undefined);
  assert.equal(a.seeded || b.seeded, true);
  assert.equal([a.seeded, b.seeded].filter(Boolean).length, 1);
  assert.ok(fs.existsSync(path.join(agentHome, 'auth.json')));
});
