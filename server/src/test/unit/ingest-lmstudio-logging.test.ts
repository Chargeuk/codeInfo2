import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendIngestFailureLog,
  mapLmStudioIngestError,
} from '../../ingest/providers/ingestFailureLogging.js';
import { query, resetStore } from '../../logStore.js';

test.beforeEach(() => {
  resetStore();
});

test('LM Studio ingest/provider failures map and append terminal error logs', () => {
  const mapped = mapLmStudioIngestError(
    new Error('connect ECONNREFUSED 127.0.0.1:1234'),
  );

  appendIngestFailureLog('error', {
    runId: 'run-lmstudio-terminal',
    provider: 'lmstudio',
    code: mapped.error,
    retryable: mapped.retryable,
    attempt: 1,
    model: 'text-embedding-nomic-embed-text-v1.5',
    path: '/tmp/repo',
    root: '/tmp/repo',
    currentFile: 'main.ts',
    message: mapped.message,
    stage: 'terminal',
  });

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const lmstudioError = entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.context?.provider === 'lmstudio' &&
      entry.context?.stage === 'terminal',
  );

  assert.ok(lmstudioError, 'expected lmstudio terminal ingest failure log');
  assert.equal(lmstudioError?.context?.runId, 'run-lmstudio-terminal');
  assert.equal(lmstudioError?.context?.code, 'LMSTUDIO_UNAVAILABLE');
  assert.equal(lmstudioError?.context?.retryable, true);
  assert.equal(
    lmstudioError?.context?.model,
    'text-embedding-nomic-embed-text-v1.5',
  );
  assert.equal(lmstudioError?.context?.currentFile, 'main.ts');
});
