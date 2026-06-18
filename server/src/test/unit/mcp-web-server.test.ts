import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach, mock } from 'node:test';
import { startWebMcpServer, stopWebMcpServer } from '../../mcpWeb/server.js';

afterEach(async () => {
  mock.restoreAll();
  await stopWebMcpServer();
});

test('startWebMcpServer is idempotent and stopWebMcpServer can be called repeatedly', async () => {
  let createServerCalls = 0;
  let closeCalls = 0;
  let closeHandler: (() => void) | undefined;

  const buildFakeServer = () =>
    ({
      on(event: string, listener: () => void) {
        if (event === 'close') {
          closeHandler = listener;
        }
        return this;
      },
      listen() {
        return this;
      },
      close(callback?: () => void) {
        closeCalls += 1;
        setImmediate(() => {
          callback?.();
          closeHandler?.();
        });
        return this;
      },
    }) as http.Server;

  mock.method(http, 'createServer', () => {
    createServerCalls += 1;
    return buildFakeServer();
  });

  const first = startWebMcpServer();
  const second = startWebMcpServer();

  assert.equal(first, second);
  assert.equal(createServerCalls, 1);

  const firstStop = stopWebMcpServer();
  const secondStop = stopWebMcpServer();
  assert.equal(firstStop, secondStop);
  await firstStop;
  assert.equal(closeCalls, 1);

  const third = startWebMcpServer();
  assert.notEqual(third, first);
  assert.equal(createServerCalls, 2);
});
