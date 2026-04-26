import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExecutableIngestInput } from '../../ingest/ingestJob.js';
import { installQueueRuntimeTestHooks } from './ingest-queue-runtime.helpers.js';

installQueueRuntimeTestHooks();

test('queue-managed execution rejects non-allowlisted OpenAI models before promotion can run', async () => {
  await assert.rejects(
    () =>
      validateExecutableIngestInput(
        {
          operation: 'reembed',
          model: 'openai/text-embedding-ada-002',
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-ada-002',
        },
        {
          getLockedEmbeddingModel: async () => null,
        },
      ),
    (error) => {
      assert.equal(
        (error as { code?: string }).code,
        'OPENAI_MODEL_UNAVAILABLE',
      );
      return true;
    },
  );
});
