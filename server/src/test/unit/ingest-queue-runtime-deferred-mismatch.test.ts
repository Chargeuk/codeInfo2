import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __setQueueRuntimeOpsForTest,
  pumpIngestQueue,
  waitForTerminalIngestStatus,
} from '../../ingest/ingestJob.js';
import {
  createQueueRequest,
  installQueueRuntimeTestHooks,
  waitForNextTurn,
} from './ingest-queue-runtime.helpers.js';

installQueueRuntimeTestHooks();

test('queue-managed deferred reembed rejects mismatched persisted requestPayload.path before discovery begins', async () => {
  process.env.CODEINFO_CODEX_WORKDIR = '/allowed/workdir';
  const canonicalRoot = '/allowed/workdir/reembed-canonical';
  const mismatchedPersistedPath = '/allowed/workdir/reembed-other';
  const deletedRequestIds: string[] = [];
  let promotedOnce = false;

  __setQueueRuntimeOpsForTest({
    deleteQueueRequestById: async (requestId: string) => {
      deletedRequestIds.push(requestId);
      return null;
    },
    findOldestCleanupBlockedQueueRequest: async () => null,
    markQueueRequestNonReplayable: async () => null,
    markQueueRequestTerminalPublished: async () => null,
    promoteOldestWaitingQueueRequest: async (runId: string) => {
      if (promotedOnce) {
        return null;
      }
      promotedOnce = true;
      return {
        ...createQueueRequest({
          requestId: '24',
          root: canonicalRoot,
          queueState: 'running',
          runId,
        }),
        runId,
        requestPayload: {
          path: mismatchedPersistedPath,
          name: 'repo',
          model: 'embed-1',
          operation: 'reembed',
        },
      };
    },
  });

  const started = await pumpIngestQueue();
  assert.equal(started.started, true);
  assert.ok(started.runId);

  const terminal = await waitForTerminalIngestStatus(started.runId!, {
    timeoutMs: 1_000,
    pollMs: 10,
  });
  await waitForNextTurn();
  await waitForNextTurn();

  assert.equal(terminal.reason, 'terminal');
  assert.equal(terminal.status?.state, 'error');
  assert.equal(
    terminal.status?.lastError,
    'queued reembed requestPayload.path must match canonicalTargetPath',
  );
  assert.ok(deletedRequestIds.length >= 1);
  assert.equal(
    deletedRequestIds.every(
      (requestId) => requestId === '000000000000000000000024',
    ),
    true,
  );
});
