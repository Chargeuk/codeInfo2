import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLmStudioEmbeddingProvider,
  type LmClientResolver,
} from '../../ingest/providers/index.js';
import { query, resetStore } from '../../logStore.js';

test.beforeEach(() => {
  resetStore();
});

test('LM Studio ingest retries log warn on retry and error on terminal exhaustion', async () => {
  let calls = 0;
  const resolver: LmClientResolver = () => ({
    embedding: {
      model: async () => ({
        embed: async () => {
          calls += 1;
          throw new Error('connect ECONNREFUSED 127.0.0.1:1234');
        },
        countTokens: async () => 10,
        getContextLength: async () => 4096,
      }),
    },
  });

  const provider = createLmStudioEmbeddingProvider({
    lmClientResolver: resolver,
    baseUrl: 'ws://host.docker.internal:1234',
    ingestFailureContext: () => ({
      runId: 'run-lm-retry',
      path: '/tmp/repo',
      root: '/tmp/repo',
      currentFile: 'src/main.ts',
    }),
  });
  const model = await provider.getModel('text-embedding-nomic-embed-text-v1.5');

  await assert.rejects(() => model.embedText('hello world'));
  assert.equal(calls, 3);

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    30,
  );
  const retryWarns = entries.filter(
    (entry) =>
      entry.level === 'warn' &&
      entry.context?.provider === 'lmstudio' &&
      entry.context?.stage === 'retry',
  );
  const terminalErrors = entries.filter(
    (entry) =>
      entry.level === 'error' &&
      entry.context?.provider === 'lmstudio' &&
      entry.context?.stage === 'terminal',
  );

  assert.equal(retryWarns.length, 2);
  assert.equal(terminalErrors.length, 1);
  assert.equal(terminalErrors[0]?.context?.code, 'LMSTUDIO_UNAVAILABLE');
  assert.equal(terminalErrors[0]?.context?.retryable, true);
});
