import assert from 'node:assert/strict';
import test from 'node:test';

import { getOrCreateSingleFlight } from '../../utils/singleFlight.js';

test('getOrCreateSingleFlight reuses in-flight promise for the same key', async () => {
  const cache = new Map<string, Promise<string>>();
  let resolveFirst!: (value: string) => void;
  let createCount = 0;

  const first = getOrCreateSingleFlight(cache, 'k', () => {
    createCount += 1;
    return new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
  });
  const second = getOrCreateSingleFlight(cache, 'k', () => {
    createCount += 1;
    return Promise.resolve('second');
  });

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(createCount, 1);
  assert.equal(first.promise, second.promise);

  resolveFirst('done');
  const value = await second.promise;
  assert.equal(value, 'done');
});

test('getOrCreateSingleFlight clears cache entry after fulfilled completion', async () => {
  const cache = new Map<string, Promise<string>>();

  const first = getOrCreateSingleFlight(cache, 'k', () => Promise.resolve('a'));
  assert.equal(cache.has('k'), true);
  await first.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.has('k'), false);

  const second = getOrCreateSingleFlight(cache, 'k', () =>
    Promise.resolve('b'),
  );
  assert.equal(second.reused, false);
  assert.equal(await second.promise, 'b');
});

test('getOrCreateSingleFlight clears cache entry after rejection', async () => {
  const cache = new Map<string, Promise<string>>();
  const failing = getOrCreateSingleFlight(cache, 'k', () =>
    Promise.reject(new Error('boom')),
  );

  await assert.rejects(failing.promise, /boom/u);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.has('k'), false);
});
