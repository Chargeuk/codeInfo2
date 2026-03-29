import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLmStudioEmbeddingProvider,
  LmStudioEmbeddingError,
  type LmClientResolver,
} from '../../ingest/providers/index.js';

function createConcurrentResolver() {
  let activeCalls = 0;
  let peakActiveCalls = 0;
  const releases: Array<() => void> = [];

  const resolver: LmClientResolver = () => ({
    embedding: {
      model: async () => ({
        embed: async (text: string) => {
          activeCalls += 1;
          peakActiveCalls = Math.max(peakActiveCalls, activeCalls);
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
          activeCalls -= 1;
          return { embedding: [text.length] };
        },
        countTokens: async (text: string) => text.length,
        getContextLength: async () => 4096,
      }),
    },
  });

  return {
    resolver,
    getPeakActiveCalls: () => peakActiveCalls,
    releaseAll: () => {
      while (releases.length > 0) {
        releases.shift()?.();
      }
    },
  };
}

test('LM Studio model reports effective batch size 1 and rejects multi-input batches', async () => {
  const provider = createLmStudioEmbeddingProvider({
    lmClientResolver: createConcurrentResolver().resolver,
    baseUrl: 'ws://host.docker.internal:1234',
  });
  const model = await provider.getModel('text-embedding-nomic-embed-text-v1.5');

  assert.equal(model.effectiveBatchSize, 1);
  assert.equal(model.supportsAbort, true);

  await assert.rejects(
    () => model.embedBatch(['one', 'two']),
    (error: unknown) => {
      assert.ok(error instanceof LmStudioEmbeddingError);
      assert.equal(error.code, 'LMSTUDIO_BAD_REQUEST');
      assert.match(error.message, /one input per request/i);
      return true;
    },
  );
});

test('LM Studio single-input embedding requests can run concurrently through the provider seam', async () => {
  const double = createConcurrentResolver();
  const provider = createLmStudioEmbeddingProvider({
    lmClientResolver: double.resolver,
    baseUrl: 'ws://host.docker.internal:1234',
  });
  const model = await provider.getModel('text-embedding-nomic-embed-text-v1.5');

  const first = model.embedBatch(['first']);
  const second = model.embedBatch(['second']);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(double.getPeakActiveCalls(), 2);

  double.releaseAll();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(firstResult, [[5]]);
  assert.deepEqual(secondResult, [[6]]);
});
