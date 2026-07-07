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
  replaceScopedTestProcessEnv({
    ...process.env,
    DEV_PROCESS_ENV_REPLACE_CANARY: 'scoped',
  });

  assert.equal(process.env.DEV_PROCESS_ENV_REPLACE_CANARY, 'scoped');
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

  beginScopedTestEnvIsolation();
});
