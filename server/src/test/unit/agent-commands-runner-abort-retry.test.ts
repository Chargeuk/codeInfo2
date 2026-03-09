import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import {
  abortAgentCommandRun,
  runAgentCommandRunner,
} from '../../agents/commandsRunner.js';
import { runWithRetry } from '../../agents/retry.js';
import {
  getActiveRunOwnership,
  tryAcquireConversationLock,
} from '../../agents/runLock.js';
import {
  getErrorMessage,
  isTransientReconnect,
} from '../../agents/transientReconnect.js';
import {
  getPendingConversationCancel,
  registerPendingConversationCancel,
} from '../../chat/inflightRegistry.js';

test('retries stop on abort', async () => {
  const controller = new AbortController();
  const runStep = mock.fn(async () => {
    throw new Error('Reconnecting... 1/5');
  });

  const promise = runWithRetry({
    runStep,
    signal: controller.signal,
    sleep: async () => undefined,
    maxAttempts: 3,
    baseDelayMs: 1,
    isRetryableError: (err) =>
      isTransientReconnect(getErrorMessage(err) ?? null),
    onRetry: () => controller.abort(),
  });

  await assert.rejects(promise, (err) => (err as Error).name === 'AbortError');
  assert.equal(runStep.mock.calls.length, 1);
});

test('command runner stops remaining steps after abortAgentCommandRun is called', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-commands-runner-abort-'),
  );
  try {
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(agentHome, 'commands', 'improve.json'),
      JSON.stringify({
        Description: 'Improve plan',
        items: [
          { type: 'message', role: 'user', content: ['s1'] },
          { type: 'message', role: 'user', content: ['s2'] },
          { type: 'message', role: 'user', content: ['s3'] },
        ],
      }),
      'utf-8',
    );

    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const calls: number[] = [];

    const runPromise = runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      conversationId: 'c1',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        calls.push(params.command?.stepIndex ?? -1);
        if (params.command?.stepIndex === 1) {
          resolveStarted?.();
          await new Promise<void>((resolve) => {
            params.signal?.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });
        }
        return { modelId: 'm1' };
      },
    });

    await started;

    abortAgentCommandRun('c1');

    await runPromise;

    assert.deepEqual(calls, [1]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('command runner does not schedule retries after stop request', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-commands-runner-abort-'),
  );
  try {
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(agentHome, 'commands', 'retry.json'),
      JSON.stringify({
        Description: 'Retry command',
        items: [{ type: 'message', role: 'user', content: ['s1'] }],
      }),
      'utf-8',
    );

    let attempts = 0;
    const runPromise = runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'retry',
      conversationId: 'c-retry-stop',
      source: 'REST',
      sleep: async () => undefined,
      runAgentInstructionUnlocked: async () => {
        attempts += 1;
        if (attempts === 1) {
          abortAgentCommandRun('c-retry-stop');
        }
        throw new Error('retryable failure');
      },
    });

    await assert.rejects(
      runPromise,
      (err) => (err as Error).name === 'AbortError',
    );
    assert.equal(attempts, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('duplicate stop requests are idempotent and do not restart steps', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-commands-runner-abort-'),
  );
  try {
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(agentHome, 'commands', 'idempotent.json'),
      JSON.stringify({
        Description: 'Idempotent stop',
        items: [
          { type: 'message', role: 'user', content: ['s1'] },
          { type: 'message', role: 'user', content: ['s2'] },
        ],
      }),
      'utf-8',
    );

    const calls: number[] = [];
    let releaseAbortWait: (() => void) | undefined;
    let startedStepOne: (() => void) | undefined;
    const waitForAbort = new Promise<void>((resolve) => {
      releaseAbortWait = resolve;
    });
    const stepOneStarted = new Promise<void>((resolve) => {
      startedStepOne = resolve;
    });

    const runPromise = runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'idempotent',
      conversationId: 'c-idempotent',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        calls.push(params.command?.stepIndex ?? -1);
        if (params.command?.stepIndex === 1) {
          startedStepOne?.();
          await waitForAbort;
        }
        return { modelId: 'm1' };
      },
    });

    await stepOneStarted;
    abortAgentCommandRun('c-idempotent');
    abortAgentCommandRun('c-idempotent');
    releaseAbortWait?.();
    await runPromise;

    assert.deepEqual(calls, [1]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('pending cancel runtime state is released even if lock cleanup throws', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-commands-runner-pending-cleanup-'),
  );
  try {
    const agentHome = path.join(tmpDir, 'a1');
    const conversationId = 'c-pending-cleanup';
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(agentHome, 'commands', 'cleanup.json'),
      JSON.stringify({
        Description: 'Cleanup command',
        items: [{ type: 'message', role: 'user', content: ['s1'] }],
      }),
      'utf-8',
    );

    assert.equal(tryAcquireConversationLock(conversationId), true);
    const ownership = getActiveRunOwnership(conversationId);
    assert.ok(ownership);

    registerPendingConversationCancel({
      conversationId,
      runToken: ownership.runToken,
    });
    assert.ok(getPendingConversationCancel(conversationId));

    await assert.rejects(
      runAgentCommandRunner({
        agentName: 'a1',
        agentHome,
        commandName: 'cleanup',
        conversationId,
        lockAlreadyHeld: true,
        source: 'REST',
        releaseConversationLockFn: () => {
          throw new Error('release failed');
        },
        runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
      }),
      /release failed/,
    );

    assert.equal(getPendingConversationCancel(conversationId), null);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
