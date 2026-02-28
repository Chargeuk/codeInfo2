import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, mock } from 'node:test';

import pino from 'pino';

import {
  copyAgentAuthFromPrimary,
  ensureAgentAuthSeeded,
  propagateAgentAuthFromPrimary,
} from '../../agents/authSeed.js';

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

test('overwrite copy replaces existing agent auth.json when enabled', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHome = makeTempDir('codex-agent-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p"}');
  fs.writeFileSync(path.join(agentHome, 'auth.json'), '{"token":"a"}');

  const result = await copyAgentAuthFromPrimary({
    agentHome,
    primaryCodexHome,
    logger,
    overwrite: true,
  });

  assert.equal(result.warning, undefined);
  assert.equal(result.copied, true);
  assert.equal(
    fs.readFileSync(path.join(agentHome, 'auth.json'), 'utf8'),
    '{"token":"p"}',
  );
});

test('propagation targets only the selected agent', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHomeA = makeTempDir('codex-agent-a-');
  const agentHomeB = makeTempDir('codex-agent-b-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p"}');
  fs.writeFileSync(path.join(agentHomeA, 'auth.json'), '{"token":"a"}');
  fs.writeFileSync(path.join(agentHomeB, 'auth.json'), '{"token":"b"}');

  const result = await propagateAgentAuthFromPrimary({
    agents: [
      { name: 'agent-a', home: agentHomeA },
      { name: 'agent-b', home: agentHomeB },
    ],
    primaryCodexHome,
    logger,
    targetAgentName: 'agent-a',
    overwrite: true,
  });

  assert.equal(result.agentCount, 1);
  assert.equal(
    fs.readFileSync(path.join(agentHomeA, 'auth.json'), 'utf8'),
    '{"token":"p"}',
  );
  assert.equal(
    fs.readFileSync(path.join(agentHomeB, 'auth.json'), 'utf8'),
    '{"token":"b"}',
  );
});

test('does not use destructive delete operations under agent directories', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHome = makeTempDir('codex-agent-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p"}');
  const rmCalls: string[] = [];
  const unlinkCalls: string[] = [];
  mock.method(fsPromises, 'rm', async (targetPath: fs.PathLike) => {
    rmCalls.push(String(targetPath));
  });
  mock.method(fsPromises, 'unlink', async (targetPath: fs.PathLike) => {
    unlinkCalls.push(String(targetPath));
  });

  try {
    await ensureAgentAuthSeeded({
      agentHome,
      primaryCodexHome,
      logger,
    });
    await propagateAgentAuthFromPrimary({
      agents: [{ name: 'coding_agent', home: agentHome }],
      primaryCodexHome,
      logger,
    });
    assert.equal(rmCalls.length, 0);
    assert.equal(unlinkCalls.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test('does not use rename/move operations under agent directories', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHome = makeTempDir('codex-agent-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p"}');
  const renameCalls: Array<{ from: string; to: string }> = [];
  mock.method(
    fsPromises,
    'rename',
    async (oldPath: fs.PathLike, newPath: fs.PathLike) => {
      renameCalls.push({ from: String(oldPath), to: String(newPath) });
    },
  );

  try {
    await ensureAgentAuthSeeded({
      agentHome,
      primaryCodexHome,
      logger,
    });
    assert.equal(renameCalls.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test('propagation is idempotent across repeated runs', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHome = makeTempDir('codex-agent-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p1"}');

  await propagateAgentAuthFromPrimary({
    agents: [{ name: 'coding_agent', home: agentHome }],
    primaryCodexHome,
    logger,
  });
  const authPath = path.join(agentHome, 'auth.json');
  const afterFirst = fs.readFileSync(authPath, 'utf8');

  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p2"}');
  await propagateAgentAuthFromPrimary({
    agents: [{ name: 'coding_agent', home: agentHome }],
    primaryCodexHome,
    logger,
  });
  const afterSecond = fs.readFileSync(authPath, 'utf8');

  assert.equal(afterFirst, '{"token":"p1"}');
  assert.equal(afterSecond, '{"token":"p1"}');
});

test('agent auth files remain present after propagation flow', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHomeA = makeTempDir('codex-agent-a-');
  const agentHomeB = makeTempDir('codex-agent-b-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p"}');

  await propagateAgentAuthFromPrimary({
    agents: [
      { name: 'agent-a', home: agentHomeA },
      { name: 'agent-b', home: agentHomeB },
    ],
    primaryCodexHome,
    logger,
  });

  assert.equal(fs.existsSync(path.join(agentHomeA, 'auth.json')), true);
  assert.equal(fs.existsSync(path.join(agentHomeB, 'auth.json')), true);
});

test('emits deterministic T09 success log when auth compatibility checks pass', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHome = makeTempDir('codex-agent-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p"}');
  const infoLogs: string[] = [];
  mock.method(console, 'info', (...args: unknown[]) => {
    infoLogs.push(args.map(String).join(' '));
  });

  try {
    await propagateAgentAuthFromPrimary({
      agents: [{ name: 'coding_agent', home: agentHome }],
      primaryCodexHome,
      logger,
    });
    assert(
      infoLogs.some((line) =>
        line.includes(
          '[DEV-0000037][T09] event=auth_compatibility_guard_passed result=success',
        ),
      ),
    );
  } finally {
    mock.restoreAll();
  }
});

test('emits deterministic T09 error log on intentional auth-copy failure', async () => {
  const primaryCodexHome = makeTempDir('codex-primary-');
  const agentHome = makeTempDir('codex-agent-');
  fs.writeFileSync(path.join(primaryCodexHome, 'auth.json'), '{"token":"p"}');
  const errorLogs: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errorLogs.push(args.map(String).join(' '));
  });
  mock.method(fsPromises, 'copyFile', async () => {
    const error = new Error('simulated copy failure') as Error & {
      code?: string;
    };
    error.code = 'EACCES';
    throw error;
  });

  try {
    await propagateAgentAuthFromPrimary({
      agents: [{ name: 'coding_agent', home: agentHome }],
      primaryCodexHome,
      logger,
      overwrite: true,
    });
    assert(
      errorLogs.some((line) =>
        line.includes(
          '[DEV-0000037][T09] event=auth_compatibility_guard_passed result=error',
        ),
      ),
    );
  } finally {
    mock.restoreAll();
  }
});
