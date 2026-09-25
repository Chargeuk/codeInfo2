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
  let listenArgs: unknown[] | undefined;
  let closeHandler: (() => void) | undefined;
  let closeCallback: (() => void) | undefined;

  const buildFakeServer = () =>
    ({
      on(event: string, listener: () => void) {
        if (event === 'close') {
          closeHandler = listener;
        }
        return this;
      },
      once() {
        return this;
      },
      off() {
        return this;
      },
      listen(...args: unknown[]) {
        listenArgs = args;
        return this;
      },
      close(callback?: () => void) {
        closeCalls += 1;
        closeCallback = callback;
        return this;
      },
    }) as unknown as http.Server;

  mock.method(http, 'createServer', () => {
    createServerCalls += 1;
    return buildFakeServer();
  });

  const first = startWebMcpServer();
  const second = startWebMcpServer();

  assert.equal(first, second);
  assert.equal(createServerCalls, 1);
  assert.equal(listenArgs?.[1], '127.0.0.1');

  const firstStop = stopWebMcpServer();
  const secondStop = stopWebMcpServer();
  assert.equal(firstStop, secondStop);
  closeCallback?.();
  closeHandler?.();
  await firstStop;
  assert.equal(closeCalls, 1);

  const third = startWebMcpServer();
  assert.notEqual(third, first);
  assert.equal(createServerCalls, 2);

  const thirdStop = stopWebMcpServer();
  closeCallback?.();
  closeHandler?.();
  await thirdStop;
});

test('startWebMcpServer clears singleton state when listen emits a startup error', async () => {
  let createServerCalls = 0;
  let errorHandler: ((error: Error) => void) | undefined;
  let closeCallback: (() => void) | undefined;

  const buildFakeServer = () =>
    ({
      once() {
        return this;
      },
      on(event: string, listener: (error: Error) => void) {
        if (event === 'error') {
          errorHandler = listener;
        }
        return this;
      },
      off() {
        return this;
      },
      listen() {
        return this;
      },
      close(callback?: () => void) {
        closeCallback = callback;
        return this;
      },
    }) as unknown as http.Server;

  mock.method(http, 'createServer', () => {
    createServerCalls += 1;
    return buildFakeServer();
  });

  startWebMcpServer();
  errorHandler?.(
    Object.assign(new Error('port in use'), { code: 'EADDRINUSE' }),
  );
  await stopWebMcpServer();

  startWebMcpServer();
  assert.equal(createServerCalls, 2);

  const stop = stopWebMcpServer();
  closeCallback?.();
  await stop;
});

test('startWebMcpServer keeps a persistent error handler after startup', async () => {
  let runtimeErrorHandler: ((error: Error) => void) | undefined;
  let listeningHandler: (() => void) | undefined;
  let closeCallback: (() => void) | undefined;

  const fakeServer = {
    on(event: string, listener: (error?: Error) => void) {
      if (event === 'error') {
        runtimeErrorHandler = listener as (error: Error) => void;
      }
      return this;
    },
    once(event: string, listener: () => void) {
      if (event === 'listening') {
        listeningHandler = listener;
      }
      return this;
    },
    off() {
      return this;
    },
    listen() {
      return this;
    },
    close(callback?: () => void) {
      closeCallback = callback;
      return this;
    },
  } as unknown as http.Server;

  mock.method(http, 'createServer', () => fakeServer);

  startWebMcpServer();
  listeningHandler?.();

  assert.ok(runtimeErrorHandler);
  runtimeErrorHandler?.(new Error('late runtime error'));

  const stop = stopWebMcpServer();
  closeCallback?.();
  await stop;
});
