import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __scheduleQueueAdvanceForTest,
  __scheduleQueueCleanupRetryForTest,
  __setFinalizeQueueRequestForRunForTest,
  __setQueueCleanupRetryDelayForTest,
  __setQueueRequestIdForRunForTest,
  __setQueueRuntimeOpsForTest,
  __setRunProcessorForTest,
  __setRunSchedulerForTest,
  startIngest,
  waitForTerminalIngestStatus,
} from '../../ingest/ingestJob.js';
import { subscribe } from '../../logStore.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
import {
  createTempRepo,
  installQueueRuntimeTestHooks,
  setupIngestChromaMocks,
  waitForIngestRuntimeIdle,
} from './ingest-queue-runtime.helpers.js';

installQueueRuntimeTestHooks();

const waitForDetachedRejection = async (
  operation: string,
  action: () => void | Promise<void>,
) => {
  const entryPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(`Timed out waiting for detached rejection: ${operation}`),
      );
    }, resolveConfiguredTestTimeoutMs(2000));
    const unsubscribe = subscribe((entry) => {
      if (
        entry.message === 'detached ingest task rejected' &&
        JSON.stringify(entry.context ?? {}).includes(operation)
      ) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });

  await action();
  await entryPromise;
  await waitForIngestRuntimeIdle();
};

test('detached startIngest run processor rejection becomes terminal status without unhandled rejection', async () => {
  const scheduledTasks: Array<() => void> = [];
  __setRunSchedulerForTest((task) => {
    scheduledTasks.push(task);
  });
  __setRunProcessorForTest(async () => {
    throw new Error('detached run processor exploded');
  });

  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);

  const { root, cleanup } = await createTempRepo({
    'src/index.ts': 'export const ready = true;\n',
  });
  setupIngestChromaMocks();

  try {
    const runId = await startIngest(
      {
        path: root,
        name: 'detached-run-processor',
        model: 'embed-1',
        embeddingProvider: 'lmstudio',
        embeddingModel: 'embed-1',
        operation: 'start',
      },
      {
        baseUrl: 'ws://host.docker.internal:1234',
        lmClientFactory: () => ({}) as never,
      },
    );

    assert.equal(scheduledTasks.length, 1);
    const detachedRejection = waitForDetachedRejection('processRun', () => {
      scheduledTasks[0]!();
    });

    const result = await waitForTerminalIngestStatus(runId, {
      timeoutMs: 5_000,
      pollMs: 1,
    });
    assert.equal(result.reason, 'terminal');
    assert.equal(result.status?.state, 'error');
    assert.equal(
      result.status?.lastError,
      'processRun failed: detached run processor exploded',
    );

    await detachedRejection;
    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    await cleanup();
  }
});

test('detached queue advance rejection is logged without unhandled rejection', async () => {
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    __setQueueRuntimeOpsForTest({
      findOldestCleanupBlockedQueueRequest: async () => {
        throw new Error('queue advance exploded');
      },
    });

    await waitForDetachedRejection('pumpIngestQueue', () => {
      __scheduleQueueAdvanceForTest();
    });

    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
});

test('detached cleanup retry rejection is logged without unhandled rejection', async () => {
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);

  __setFinalizeQueueRequestForRunForTest(async () => {
    throw new Error('cleanup retry exploded');
  });
  __setQueueCleanupRetryDelayForTest(0);
  __setQueueRequestIdForRunForTest(
    'run-detached-retry',
    'queue-detached-retry',
  );

  try {
    await waitForDetachedRejection('finalizeQueueRequestForRun.retry', () => {
      return __scheduleQueueCleanupRetryForTest({
        requestId: 'queue-detached-retry',
        runId: 'run-detached-retry',
      });
    });

    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
});
