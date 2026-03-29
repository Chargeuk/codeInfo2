import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkTextStream } from '../../ingest/chunker.js';
import { createEmbeddingDispatcher } from '../../ingest/embeddingDispatcher.js';
import type { ProviderEmbeddingModel } from '../../ingest/providers/types.js';
import type { IngestConfig } from '../../ingest/types.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function baseConfig(overrides?: Partial<IngestConfig>): IngestConfig {
  return {
    includes: ['md', 'txt', 'ts'],
    excludes: [],
    tokenSafetyMargin: 0.8,
    fallbackTokenLimit: 64,
    flushEvery: 2,
    largeTextThresholdBytes: 1,
    openAiMaxBatchSize: 2,
    openAiMaxInFlight: 2,
    lmStudioMaxBatchSize: 1,
    lmStudioMaxInFlight: 2,
    maxQueueSize: -1,
    ...overrides,
  };
}

test('dispatcher refills a freed slot immediately and bounds waiting work with queue cap', async () => {
  const requests: Array<{
    texts: string[];
    deferred: ReturnType<typeof createDeferred<number[][]>>;
  }> = [];
  const dispatchEvents: Array<{ batchSize: number; queueDepth: number }> = [];
  const model: ProviderEmbeddingModel = {
    modelKey: 'test-model',
    effectiveBatchSize: 1,
    supportsAbort: true,
    async embedText() {
      return [0.1];
    },
    async embedBatch(texts) {
      const deferred = createDeferred<number[][]>();
      requests.push({ texts, deferred });
      return deferred.promise;
    },
    async countTokens(text) {
      return text.split(/\s+/).filter(Boolean).length;
    },
    async getContextLength() {
      return 32;
    },
  };

  const completed: string[] = [];
  const dispatcher = createEmbeddingDispatcher({
    model,
    effectiveBatchSize: 1,
    maxInFlight: 2,
    maxQueueSize: 1,
    isCancelled: () => false,
    onDispatch: ({ batchSize, queueDepth }) => {
      dispatchEvents.push({ batchSize, queueDepth });
    },
    onCompleted: async (results) => {
      completed.push(...results.map((result) => result.text));
    },
    onLateResultIgnored: () => {},
  });

  const first = await dispatcher.enqueue({
    sequence: 0,
    text: 'chunk-1',
    meta: null,
  });
  const second = await dispatcher.enqueue({
    sequence: 1,
    text: 'chunk-2',
    meta: null,
  });
  const third = await dispatcher.enqueue({
    sequence: 2,
    text: 'chunk-3',
    meta: null,
  });
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(third, true);

  const blockedFourth = dispatcher.enqueue({
    sequence: 3,
    text: 'chunk-4',
    meta: null,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 2, 'expected two requests to fill both slots');

  let fourthResolved = false;
  void blockedFourth.then(() => {
    fourthResolved = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    fourthResolved,
    false,
    'expected fourth enqueue to wait while queue is full',
  );

  requests[0]?.deferred.resolve([[0.1]]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    requests.length,
    3,
    'expected freed slot to dispatch next queued item immediately',
  );

  await blockedFourth;
  requests[1]?.deferred.resolve([[0.2]]);
  requests[2]?.deferred.resolve([[0.3]]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    requests.length,
    4,
    'expected waiting enqueue to dispatch once capacity reopened',
  );

  requests[3]?.deferred.resolve([[0.4]]);
  dispatcher.completeProduction();
  await dispatcher.waitForIdle();

  assert.deepEqual(completed, ['chunk-1', 'chunk-2', 'chunk-3', 'chunk-4']);
  assert.ok(dispatchEvents.length >= 4);
});

test('dispatcher preserves deterministic persistence order when batched results complete out of order', async () => {
  const requests: Array<{
    texts: string[];
    deferred: ReturnType<typeof createDeferred<number[][]>>;
  }> = [];
  const model: ProviderEmbeddingModel = {
    modelKey: 'test-openai',
    effectiveBatchSize: 2,
    supportsAbort: true,
    async embedText() {
      return [0.1];
    },
    async embedBatch(texts) {
      const deferred = createDeferred<number[][]>();
      requests.push({ texts, deferred });
      return deferred.promise;
    },
    async countTokens(text) {
      return text.split(/\s+/).filter(Boolean).length;
    },
    async getContextLength() {
      return 64;
    },
  };

  const pending = new Map<
    number,
    { relPath: string; text: string; embedding: number[] }
  >();
  const persisted: string[] = [];
  let nextSequence = 0;
  const flushReady = () => {
    while (pending.has(nextSequence)) {
      const result = pending.get(nextSequence);
      pending.delete(nextSequence);
      if (result) {
        persisted.push(`${result.relPath}:${result.text}`);
      }
      nextSequence += 1;
    }
  };

  const dispatcher = createEmbeddingDispatcher({
    model,
    effectiveBatchSize: 2,
    maxInFlight: 2,
    maxQueueSize: -1,
    isCancelled: () => false,
    onDispatch: () => {},
    onCompleted: async (results) => {
      for (const result of results) {
        pending.set(result.sequence, {
          ...(result.meta as { relPath: string; text: string }),
          embedding: result.embedding,
        });
      }
      flushReady();
    },
    onLateResultIgnored: () => {},
  });

  await Promise.all([
    dispatcher.enqueue({
      sequence: 0,
      text: 'alpha',
      meta: { relPath: 'b.md', text: 'alpha' },
    }),
    dispatcher.enqueue({
      sequence: 1,
      text: 'beta',
      meta: { relPath: 'a.md', text: 'beta' },
    }),
    dispatcher.enqueue({
      sequence: 2,
      text: 'gamma',
      meta: { relPath: 'c.md', text: 'gamma' },
    }),
  ]);
  dispatcher.completeProduction();

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    requests.length,
    2,
    'expected one mixed batch plus one trailing batch',
  );
  assert.deepEqual(requests[0]?.texts, ['alpha', 'beta']);

  requests[1]?.deferred.resolve([[0.3]]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    persisted,
    [],
    'later batch should not persist ahead of earlier sequence numbers',
  );

  requests[0]?.deferred.resolve([[0.1], [0.2]]);
  await dispatcher.waitForIdle();

  assert.deepEqual(persisted, ['b.md:alpha', 'a.md:beta', 'c.md:gamma']);
});

test('large-text chunk production can overlap with first embedding dispatch', async () => {
  const thirdBlockDeferred = createDeferred<number>();
  const firstEmbedStarted = createDeferred<void>();
  let delayedCountSeen = false;
  const model: ProviderEmbeddingModel = {
    modelKey: 'test-overlap',
    effectiveBatchSize: 1,
    supportsAbort: true,
    async embedText() {
      return [0.1];
    },
    async embedBatch(texts) {
      void texts;
      firstEmbedStarted.resolve();
      return [[0.1]];
    },
    async countTokens(text) {
      if (text.includes('lambda mu nu xi omicron pi')) {
        delayedCountSeen = true;
        return thirdBlockDeferred.promise;
      }
      return text.split(/\s+/).filter(Boolean).length;
    },
    async getContextLength() {
      return 10;
    },
  };

  const dispatcher = createEmbeddingDispatcher({
    model,
    effectiveBatchSize: 1,
    maxInFlight: 1,
    maxQueueSize: -1,
    isCancelled: () => false,
    onDispatch: () => {},
    onCompleted: async () => {},
    onLateResultIgnored: () => {},
  });

  const text = `# One

alpha beta gamma delta

# Two

epsilon zeta eta theta iota kappa

# Three

lambda mu nu xi omicron pi`;

  const producer = (async () => {
    let sequence = 0;
    for await (const chunk of chunkTextStream(text, model, baseConfig(), {
      logContext: { runId: 'run-overlap', relPath: 'docs/large.md' },
      fileInfo: {
        relPath: 'docs/large.md',
        ext: 'md',
        sizeBytes: 70_000,
      },
    })) {
      await dispatcher.enqueue({
        sequence: sequence++,
        text: chunk.text,
        meta: null,
      });
      if (sequence === 1) {
        await firstEmbedStarted.promise;
        thirdBlockDeferred.resolve(6);
      }
    }
    dispatcher.completeProduction();
    await dispatcher.waitForIdle();
  })();

  await producer;
  assert.equal(delayedCountSeen, true);
});
