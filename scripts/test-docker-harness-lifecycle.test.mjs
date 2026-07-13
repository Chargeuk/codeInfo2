import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acquireTestDockerLock,
  createComposeCommand,
  waitForHttpReadiness,
  waitForProjectRemoval,
} from './test-docker-harness-lifecycle.mjs';

test('compose commands are restricted to deterministic test projects', () => {
  const cucumber = createComposeCommand({
    rootDir: '/repo',
    target: 'cucumber',
    action: 'up',
  });
  assert.deepEqual(cucumber.args.slice(-9), [
    '--project-name',
    'codeinfo2-cucumber',
    '-f',
    'server/src/test/compose/docker-compose.chroma.yml',
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '120',
  ]);
  assert.throws(
    () =>
      createComposeCommand({
        rootDir: '/repo',
        target: 'local',
        action: 'down',
      }),
    /Unsupported test Docker target/,
  );
});

test('HTTP readiness waits until every endpoint is ready', async () => {
  const attempts = new Map();
  await waitForHttpReadiness({
    urls: ['http://one.test', 'http://two.test'],
    intervalMs: 0,
    sleep: async () => {},
    fetchImpl: async (url) => {
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      return { ok: url.endsWith('one.test') || attempt >= 2, status: 503 };
    },
  });

  assert.equal(attempts.get('http://one.test'), 1);
  assert.equal(attempts.get('http://two.test'), 2);
});

test('HTTP readiness reports endpoints that never become ready', async () => {
  await assert.rejects(
    waitForHttpReadiness({
      urls: ['http://unready.test'],
      timeoutMs: 5,
      intervalMs: 1,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /Timed out waiting for test Docker readiness.*HTTP 503/,
  );
});

test('project teardown waits for both containers and networks', async () => {
  const snapshots = [
    { containers: ['one'], networks: ['network'] },
    { containers: [], networks: ['network'] },
    { containers: [], networks: [] },
  ];
  await waitForProjectRemoval({
    projectName: 'codeinfo2-e2e',
    intervalMs: 0,
    sleep: async () => {},
    listResources: async () => snapshots.shift() ?? snapshots.at(-1),
  });
  assert.equal(snapshots.length, 0);
});

test('project teardown refuses to inspect the local development project', async () => {
  await assert.rejects(
    waitForProjectRemoval({
      projectName: 'codeinfo2-local',
      listResources: async () => ({ containers: [], networks: [] }),
    }),
    /Refusing to inspect unmanaged Compose project/,
  );
});

test('project teardown reports resources that remain', async () => {
  await assert.rejects(
    waitForProjectRemoval({
      projectName: 'codeinfo2-cucumber',
      timeoutMs: 5,
      intervalMs: 1,
      listResources: async () => ({
        containers: ['stale-cucumber'],
        networks: ['stale-network'],
      }),
    }),
    /still owns resources.*stale-cucumber.*stale-network/,
  );
});

test('a stale lock is replaced and released by its new owner', async () => {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'codeinfo-lock-test-'));
  const lockPath = path.join(parent, 'lock');
  await fs.mkdir(lockPath);
  await fs.writeFile(
    path.join(lockPath, 'owner.json'),
    JSON.stringify({ pid: 999_999, token: 'stale' }),
  );

  try {
    const lock = await acquireTestDockerLock({
      lockPath,
      pidAlive: () => false,
      sleep: async () => {},
    });
    const owner = JSON.parse(
      await fs.readFile(path.join(lockPath, 'owner.json'), 'utf8'),
    );
    assert.equal(owner.pid, process.pid);
    assert.notEqual(owner.token, 'stale');
    await lock.release();
    await assert.rejects(fs.access(lockPath), { code: 'ENOENT' });
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('an active lock is respected before stale-owner recovery', async () => {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'codeinfo-lock-test-'));
  const lockPath = path.join(parent, 'lock');
  await fs.mkdir(lockPath);
  await fs.writeFile(
    path.join(lockPath, 'owner.json'),
    JSON.stringify({ pid: 123, token: 'active' }),
  );
  let active = true;
  let waits = 0;

  try {
    const lock = await acquireTestDockerLock({
      lockPath,
      pidAlive: () => active,
      onWait: () => {
        waits += 1;
      },
      sleep: async () => {
        active = false;
      },
    });
    assert.equal(waits, 1);
    await lock.release();
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('two stale-lock waiters acquire serially without deleting the new owner', async () => {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'codeinfo-lock-test-'));
  const lockPath = path.join(parent, 'lock');
  await fs.mkdir(lockPath);
  await fs.writeFile(
    path.join(lockPath, 'owner.json'),
    JSON.stringify({ pid: 999_999, token: 'stale' }),
  );
  const acquire = () =>
    acquireTestDockerLock({
      lockPath,
      timeoutMs: 2_000,
      intervalMs: 1,
      pidAlive: (pid) => pid === process.pid,
      sleep: async () => await new Promise((resolve) => setImmediate(resolve)),
    });

  try {
    const contenders = [acquire(), acquire()];
    const first = await Promise.race(
      contenders.map(async (promise, index) => ({
        index,
        lock: await promise,
      })),
    );
    const firstOwner = JSON.parse(
      await fs.readFile(path.join(lockPath, 'owner.json'), 'utf8'),
    );
    assert.equal(firstOwner.token, first.lock.token);

    await first.lock.release();
    const second = await contenders[first.index === 0 ? 1 : 0];
    assert.notEqual(second.token, first.lock.token);
    const secondOwner = JSON.parse(
      await fs.readFile(path.join(lockPath, 'owner.json'), 'utf8'),
    );
    assert.equal(secondOwner.token, second.token);
    await second.release();
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
