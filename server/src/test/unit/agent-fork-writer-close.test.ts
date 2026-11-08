import assert from 'node:assert/strict';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { CodexAppServer } from '../../codex/appServer.js';

function fakeWriter() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: () => {
      child.emit('close', null, 'SIGKILL');
      return true;
    },
  });
  const factory = (() => child) as unknown as typeof spawn;
  return { child, rpc: new CodexAppServer(factory) };
}

test('owned app-server close is idempotent and waits for a normal writer exit', async () => {
  const { child, rpc } = fakeWriter();
  const first = rpc.close();
  assert.equal(rpc.close(), first);
  assert.equal(rpc.isWriterTerminated(), false);
  child.emit('close', 0, null);
  try {
    await first;
    assert.equal(rpc.isWriterTerminated(), true);
  } finally {
    child.stdin.destroy();
    child.stdout.destroy();
  }
});

test('forced shutdown cannot acknowledge durable handover delivery', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { child, rpc } = fakeWriter();
  const rejected = assert.rejects(rpc.close(), /did not close gracefully/);
  try {
    t.mock.timers.tick(10_000);
    await rejected;
    assert.equal(rpc.isWriterTerminated(), false);
  } finally {
    child.stdin.destroy();
    child.stdout.destroy();
  }
});

test('nonzero app-server exit is a close failure even without forced shutdown', async () => {
  const { child, rpc } = fakeWriter();
  const rejected = assert.rejects(rpc.close(), /did not close gracefully/);
  child.emit('close', 1, null);
  try {
    await rejected;
    assert.equal(rpc.isWriterTerminated(), true);
  } finally {
    child.stdin.destroy();
    child.stdout.destroy();
  }
});

test('launcher exit with inherited pipes still open settles at the close deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { child, rpc } = fakeWriter();
  // The launcher exited, but a descendant retains stdout and never emits close.
  child.kill = () => true;
  child.emit('exit', 0, null);
  const rejected = assert.rejects(rpc.close(), /did not close gracefully/);
  try {
    t.mock.timers.tick(10_000);
    await rejected;
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stdin.destroyed, true);
    assert.equal(rpc.isWriterTerminated(), false);
    await assert.rejects(rpc.request('thread/read', {}), /connection closed/);
  } finally {
    child.stdin.destroy();
    child.stdout.destroy();
  }
});

test('timeout signals only the detached helper process group, including its native descendant', async (t) => {
  if (process.platform === 'win32') return;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals: Array<[number, NodeJS.Signals | number | undefined]> = [];
  t.mock.method(
    process,
    'kill',
    (pid: number, signal?: NodeJS.Signals | number) => {
      signals.push([pid, signal]);
      return true;
    },
  );
  const child = Object.assign(new EventEmitter(), {
    pid: 123456,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: () => {
      throw new Error('Must signal the owned group');
    },
  });
  const factory = ((
    _command: string,
    _args: string[],
    options: { detached?: boolean },
  ) => {
    assert.equal(options.detached, true);
    return child;
  }) as unknown as typeof spawn;
  const rpc = new CodexAppServer(factory);
  const rejected = assert.rejects(rpc.close(), /did not close gracefully/);
  try {
    t.mock.timers.tick(10_000);
    await rejected;
    assert.deepEqual(signals, [[-123456, 'SIGKILL']]);
    assert.equal(rpc.isWriterTerminated(), false);
  } finally {
    child.stdin.destroy();
    child.stdout.destroy();
  }
});
