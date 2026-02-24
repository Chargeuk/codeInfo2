import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENAI_REQUEST_TIMEOUT_MS,
  createOpenAiEmbeddingProvider,
} from '../../ingest/providers/index.js';

function createClientDouble(options: {
  embeddingData?: Array<{ index: number; embedding: unknown }>;
  throwError?: unknown;
}) {
  const calls: Array<{
    body: { model: string; input: string[] };
    options?: { timeout?: number; maxRetries?: number };
  }> = [];

  return {
    calls,
    client: {
      embeddings: {
        create: async (
          body: { model: string; input: string[] },
          requestOptions?: { timeout?: number; maxRetries?: number },
        ) => {
          calls.push({ body, options: requestOptions });
          if (options.throwError) {
            throw options.throwError;
          }
          return {
            data: options.embeddingData ?? [
              { index: 0, embedding: [0.1, 0.2, 0.3] },
            ],
          };
        },
      },
      models: {
        list: async () => ({ data: [{ id: 'text-embedding-3-small' }] }),
      },
    },
  };
}

test('embeddings call uses timeout 30000 and SDK maxRetries=0', async () => {
  const double = createClientDouble({});
  const provider = createOpenAiEmbeddingProvider({
    apiKey: 'sk-test',
    clientFactory: () => double.client,
  });

  const model = await provider.getModel('text-embedding-3-small');
  const vector = await model.embedText('hello world');

  assert.equal(vector.length, 3);
  assert.equal(double.calls.length, 1);
  assert.equal(double.calls[0]?.options?.timeout, OPENAI_REQUEST_TIMEOUT_MS);
  assert.equal(double.calls[0]?.options?.maxRetries, 0);
});

test('rejects empty and non-numeric vectors with deterministic errors', async () => {
  const empty = createClientDouble({
    embeddingData: [{ index: 0, embedding: [] }],
  });
  const providerWithEmpty = createOpenAiEmbeddingProvider({
    apiKey: 'sk-test',
    clientFactory: () => empty.client,
    retrySleep: async () => {},
  });
  const modelWithEmpty = await providerWithEmpty.getModel(
    'text-embedding-3-small',
  );
  await assert.rejects(() => modelWithEmpty.embedText('x'), /empty vector/i);

  const nonNumeric = createClientDouble({
    embeddingData: [{ index: 0, embedding: [0.1, 'x'] }],
  });
  const providerWithNonNumeric = createOpenAiEmbeddingProvider({
    apiKey: 'sk-test',
    clientFactory: () => nonNumeric.client,
    retrySleep: async () => {},
  });
  const modelWithNonNumeric = await providerWithNonNumeric.getModel(
    'text-embedding-3-small',
  );
  await assert.rejects(
    () => modelWithNonNumeric.embedText('x'),
    /non-numeric/i,
  );
});
