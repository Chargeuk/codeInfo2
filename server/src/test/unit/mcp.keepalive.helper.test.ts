import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createKeepAliveController } from '../../mcpCommon/keepAlive.js';

class MockResponse extends EventEmitter {
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  writes: string[] = [];
  endedPayload = '';

  writeHead(statusCode?: number, headers?: Record<string, string>) {
    void statusCode;
    void headers;
    this.headersSent = true;
    return this;
  }

  flushHeaders() {
    this.headersSent = true;
  }

  write(chunk: string) {
    if (this.writableEnded || this.destroyed) {
      throw new Error('write-after-close');
    }
    this.writes.push(chunk);
    return true;
  }

  end(payload?: string) {
    if (typeof payload === 'string') {
      this.endedPayload = payload;
    }
    this.writableEnded = true;
    this.emit('finish');
    this.emit('close');
    return this;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('start emits whitespace-only bytes and stops on sendJson', async () => {
  const res = new MockResponse();
  const keepAlive = createKeepAliveController({
    res,
    writeHeadersIfNeeded: () => {
      if (res.headersSent) return;
      res.writeHead();
      res.flushHeaders();
    },
    surface: 'unit_test',
    intervalMs: 5,
  });

  keepAlive.start();
  await wait(14);
  keepAlive.sendJson({ ok: true });

  assert.equal(keepAlive.isRunning(), false);
  assert.equal(res.endedPayload.length > 0, true);
  assert.equal(res.writes.length >= 2, true);
  assert.equal(
    res.writes.every((chunk) => /^\s+$/.test(chunk)),
    true,
  );
});

test('close stops timer and prevents additional writes', async () => {
  const res = new MockResponse();
  const keepAlive = createKeepAliveController({
    res,
    writeHeadersIfNeeded: () => {
      if (res.headersSent) return;
      res.writeHead();
    },
    surface: 'unit_test',
    intervalMs: 5,
  });

  keepAlive.start();
  await wait(8);
  const writesBeforeClose = res.writes.length;
  res.emit('close');
  await wait(16);

  assert.equal(keepAlive.isRunning(), false);
  assert.equal(res.writes.length, writesBeforeClose);
});

test('response end before next tick does not write after end', async () => {
  const res = new MockResponse();
  const keepAlive = createKeepAliveController({
    res,
    writeHeadersIfNeeded: () => {
      if (res.headersSent) return;
      res.writeHead();
    },
    surface: 'unit_test',
    intervalMs: 5,
  });

  keepAlive.start();
  res.end(JSON.stringify({ ok: true }));
  const writesAtEnd = res.writes.length;
  await wait(15);

  assert.equal(keepAlive.isRunning(), false);
  assert.equal(res.writes.length, writesAtEnd);
});
