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
  getErrorMessage,
  isTransientReconnect,
} from '../../agents/transientReconnect.js';

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
