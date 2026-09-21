import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginScopedTestEnvIsolation,
  clearScopedTestEnvValue,
  endScopedTestEnvIsolation,
  replaceScopedTestProcessEnv,
  setScopedTestEnvValue,
} from '../support/processEnvIsolation.js';

const createBarrier = (size: number) => {
  let waiting = 0;
  let release: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    waiting += 1;
    if (waiting === size) {
      release?.();
    }
    await promise;
  };
};

test(
  'scoped env values stay isolated across concurrent node:test cases',
  { concurrency: true },
  async (t) => {
    const barrier = createBarrier(2);

    await Promise.all([
      t.test('case a', { concurrency: true }, async () => {
        beginScopedTestEnvIsolation();
        setScopedTestEnvValue('DEV_PROCESS_ENV_ISOLATION_CANARY', 'a');
        await barrier();
        assert.equal(process.env.DEV_PROCESS_ENV_ISOLATION_CANARY, 'a');
      }),
      t.test('case b', { concurrency: true }, async () => {
        beginScopedTestEnvIsolation();
        setScopedTestEnvValue('DEV_PROCESS_ENV_ISOLATION_CANARY', 'b');
        await barrier();
        assert.equal(process.env.DEV_PROCESS_ENV_ISOLATION_CANARY, 'b');
      }),
    ]);
  },
);

test('replaceScopedTestProcessEnv stays scoped to the active test', () => {
  beginScopedTestEnvIsolation();
  replaceScopedTestProcessEnv({
    ...process.env,
    DEV_PROCESS_ENV_REPLACE_CANARY: 'scoped',
  });

  assert.equal(process.env.DEV_PROCESS_ENV_REPLACE_CANARY, 'scoped');
  endScopedTestEnvIsolation();
});

test('out-of-scope scoped env helpers throw immediately', () => {
  beginScopedTestEnvIsolation();
  endScopedTestEnvIsolation();

  assert.throws(
    () => setScopedTestEnvValue('DEV_PROCESS_ENV_OUT_OF_SCOPE', 'nope'),
    /outside an active test scope/,
  );
  assert.throws(
    () => clearScopedTestEnvValue('DEV_PROCESS_ENV_OUT_OF_SCOPE'),
    /outside an active test scope/,
  );
  assert.throws(
    () =>
      replaceScopedTestProcessEnv({
        DEV_PROCESS_ENV_REPLACE_OUT_OF_SCOPE: 'nope',
      }),
    /outside an active test scope/,
  );
  assert.throws(
    () =>
      Reflect.set(process.env, 'DEV_PROCESS_ENV_DIRECT_OUT_OF_SCOPE', 'nope'),
    /outside an active test scope/,
  );
  assert.throws(
    () =>
      Reflect.deleteProperty(
        process.env,
        'DEV_PROCESS_ENV_DIRECT_OUT_OF_SCOPE',
      ),
    /outside an active test scope/,
  );

  beginScopedTestEnvIsolation();
});

test('new persistent test scopes do not inherit prior scoped values', () => {
  const canary = 'DEV_PROCESS_ENV_FRESH_PERSISTENT_SCOPE_CANARY';
  setScopedTestEnvValue(canary, 'prior');

  beginScopedTestEnvIsolation({}, { persistentAcrossAsyncBoundaries: true });

  assert.equal(process.env[canary], undefined);
});

test('closed detached callbacks cannot read a later test scope', async (t) => {
  const canary = 'DEV_PROCESS_ENV_DETACHED_SCOPE_CANARY';
  let releaseDetached: (() => void) | undefined;
  let detachedRead: Promise<string | undefined> | undefined;

  await t.test('captures the current scope', () => {
    setScopedTestEnvValue(canary, 'closed');
    const released = new Promise<void>((resolve) => {
      releaseDetached = resolve;
    });
    detachedRead = (async () => {
      await released;
      return process.env[canary];
    })();
  });

  await t.test('keeps the next scope isolated', async () => {
    setScopedTestEnvValue(canary, 'current');
    releaseDetached?.();

    assert.equal(process.env[canary], 'current');
    assert.equal(await detachedRead, undefined);
  });
});
