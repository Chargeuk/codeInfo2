import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import {
  closeAll,
  getClient,
  resetPoolForTests,
  restoreDefaultClientFactory,
  setClientFactoryForTests,
} from '../../lmstudio/clientPool.js';

class FakeLmClient {
  disposed = 0;
  constructor(public readonly baseUrl: string) {}
  [Symbol.asyncDispose]() {
    this.disposed += 1;
    return Promise.resolve();
  }
}

beforeEach(() => {
  resetPoolForTests();
  setClientFactoryForTests(
    (baseUrl: string) => new FakeLmClient(baseUrl) as unknown as LMStudioClient,
  );
});

afterEach(async () => {
  await closeAll();
  resetPoolForTests();
  restoreDefaultClientFactory();
});

test('returns the same client for the same baseUrl', () => {
  const first = getClient('ws://one');
  const second = getClient('ws://one');
  assert.strictEqual(first, second);
});

test('returns different clients for different baseUrls', () => {
  const first = getClient('ws://one');
  const second = getClient('ws://two');
  assert.notStrictEqual(first, second);
});

test('closeAll disposes each pooled client once', async () => {
  const one = getClient('ws://one') as unknown as FakeLmClient;
  const two = getClient('ws://two') as unknown as FakeLmClient;

  await closeAll();

  assert.equal(one.disposed, 1);
  assert.equal(two.disposed, 1);
});

test('closeAll is idempotent after pool is cleared', async () => {
  const one = getClient('ws://one') as unknown as FakeLmClient;

  await closeAll();
  await closeAll();

  assert.equal(one.disposed, 1);
});
