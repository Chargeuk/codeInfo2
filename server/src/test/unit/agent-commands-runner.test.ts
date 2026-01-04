import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { runAgentCommandRunner } from '../../agents/commandsRunner.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function writeCommandFile(params: {
  agentHome: string;
  commandName: string;
  jsonText: string;
}): Promise<string> {
  const filePath = path.join(
    params.agentHome,
    'commands',
    `${params.commandName}.json`,
  );
  await fs.writeFile(filePath, params.jsonText, 'utf-8');
  return filePath;
}

describe('agent commands runner (v1)', () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
    tmpDir = null;
  });

  test('multi-step command executes all steps sequentially', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'improve',
      jsonText: JSON.stringify({
        Description: 'Improve plan',
        items: [
          { type: 'message', role: 'user', content: ['s1'] },
          { type: 'message', role: 'user', content: ['s2'] },
          { type: 'message', role: 'user', content: ['s3'] },
        ],
      }),
    });

    const calls: Array<{ stepIndex: number; totalSteps: number }> = [];

    const result = await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        calls.push({
          stepIndex: params.command?.stepIndex ?? -1,
          totalSteps: params.command?.totalSteps ?? -1,
        });
        return { modelId: 'm1' };
      },
    });

    assert.deepEqual(calls, [
      { stepIndex: 1, totalSteps: 3 },
      { stepIndex: 2, totalSteps: 3 },
      { stepIndex: 3, totalSteps: 3 },
    ]);

    assert.deepEqual(result, {
      agentName: 'a1',
      commandName: 'improve',
      conversationId: result.conversationId,
      modelId: 'm1',
    });
  });

  test('abort after step 1 prevents steps 2+ from running', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'improve',
      jsonText: JSON.stringify({
        Description: 'Improve plan',
        items: [
          { type: 'message', role: 'user', content: ['s1'] },
          { type: 'message', role: 'user', content: ['s2'] },
          { type: 'message', role: 'user', content: ['s3'] },
        ],
      }),
    });
    const controller = new AbortController();
    const started = deferred<void>();
    const finishStep1 = deferred<void>();
    const calls: number[] = [];

    const run = runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      source: 'REST',
      signal: controller.signal,
      runAgentInstructionUnlocked: async (params) => {
        calls.push(params.command?.stepIndex ?? -1);
        if (params.command?.stepIndex === 1) {
          started.resolve();
          await finishStep1.promise;
        }
        return { modelId: 'm1' };
      },
    });

    await started.promise;

    finishStep1.resolve();
    controller.abort();

    await run;

    assert.deepEqual(calls, [1]);
  });

  test('per-conversation lock blocks concurrent run during command execution', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'improve',
      jsonText: JSON.stringify({
        Description: 'Improve plan',
        items: [{ type: 'message', role: 'user', content: ['s1'] }],
      }),
    });

    const barrier = deferred<void>();
    const started = deferred<void>();

    const first = runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      conversationId: 'c1',
      source: 'REST',
      runAgentInstructionUnlocked: async () => {
        started.resolve();
        await barrier.promise;
        return { modelId: 'm1' };
      },
    });

    await started.promise;

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'improve',
          conversationId: 'c1',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      (err) => (err as { code?: string }).code === 'RUN_IN_PROGRESS',
    );

    barrier.resolve();
    await first;
  });

  test('client-supplied conversationId does not force mustExist=true', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'single',
      jsonText: JSON.stringify({
        Description: 'Single',
        items: [{ type: 'message', role: 'user', content: ['s1'] }],
      }),
    });

    let observedMustExist: boolean | undefined;

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'single',
      conversationId: 'c1',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        assert.equal(params.conversationId, 'c1');
        observedMustExist = params.mustExist;
        return { modelId: 'm1' };
      },
    });

    assert.notEqual(observedMustExist, true);
  });

  test("instruction passed to each step equals content.join('\\n') (with trimmed content)", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'join',
      jsonText: JSON.stringify({
        Description: 'Join',
        items: [
          {
            type: 'message',
            role: 'user',
            content: ['  first  ', 'second '],
          },
        ],
      }),
    });

    let seen: string | null = null;

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'join',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        seen = params.instruction;
        return { modelId: 'm1' };
      },
    });

    assert.equal(seen, 'first\nsecond');
  });

  test('working_folder is forwarded to the unlocked helper for every step', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'improve',
      jsonText: JSON.stringify({
        Description: 'Improve plan',
        items: [
          { type: 'message', role: 'user', content: ['s1'] },
          { type: 'message', role: 'user', content: ['s2'] },
        ],
      }),
    });

    const folders: Array<string | undefined> = [];

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      working_folder: '/abs/path',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        folders.push(params.working_folder);
        return { modelId: 'm1' };
      },
    });

    assert.deepEqual(folders, ['/abs/path', '/abs/path']);
  });

  test('when conversationId is omitted, a new id is generated and reused for all steps', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'improve',
      jsonText: JSON.stringify({
        Description: 'Improve plan',
        items: [
          { type: 'message', role: 'user', content: ['s1'] },
          { type: 'message', role: 'user', content: ['s2'] },
        ],
      }),
    });

    const conversationIds: string[] = [];

    const result = await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        conversationIds.push(params.conversationId);
        return { modelId: 'm1' };
      },
    });

    assert.equal(new Set(conversationIds).size, 1);
    assert.equal(conversationIds[0], result.conversationId);
  });

  test('when conversationId is provided, it is reused and returned unchanged', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'improve',
      jsonText: JSON.stringify({
        Description: 'Improve plan',
        items: [{ type: 'message', role: 'user', content: ['s1'] }],
      }),
    });

    const result = await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      conversationId: 'c1',
      source: 'REST',
      runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
    });

    assert.equal(result.conversationId, 'c1');
  });

  test("invalid commandName values are rejected with { code: 'COMMAND_INVALID' }", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: '../bad',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      (err) => (err as { code?: string }).code === 'COMMAND_INVALID',
    );

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'a/b',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      (err) => (err as { code?: string }).code === 'COMMAND_INVALID',
    );

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'a\\b',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      (err) => (err as { code?: string }).code === 'COMMAND_INVALID',
    );
  });

  test("missing command file throws { code: 'COMMAND_NOT_FOUND' }", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'does_not_exist',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      (err) => (err as { code?: string }).code === 'COMMAND_NOT_FOUND',
    );
  });

  test("invalid command file throws { code: 'COMMAND_INVALID' }", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'bad',
      jsonText: '{',
    });

    let called = false;

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'bad',
          source: 'REST',
          runAgentInstructionUnlocked: async () => {
            called = true;
            return { modelId: 'm1' };
          },
        }),
      (err) => (err as { code?: string }).code === 'COMMAND_INVALID',
    );

    assert.equal(called, false);
  });

  test('step failure stops execution and releases the lock', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'improve',
      jsonText: JSON.stringify({
        Description: 'Improve plan',
        items: [
          { type: 'message', role: 'user', content: ['s1'] },
          { type: 'message', role: 'user', content: ['s2'] },
          { type: 'message', role: 'user', content: ['s3'] },
        ],
      }),
    });

    const calls: number[] = [];

    await assert.rejects(async () =>
      runAgentCommandRunner({
        agentName: 'a1',
        agentHome,
        commandName: 'improve',
        conversationId: 'c1',
        source: 'REST',
        runAgentInstructionUnlocked: async (params) => {
          const step = params.command?.stepIndex ?? -1;
          calls.push(step);
          if (step === 2) {
            throw new Error('boom');
          }
          return { modelId: 'm1' };
        },
      }),
    );

    assert.deepEqual(calls, [1, 2]);

    const secondCalls: number[] = [];

    const second = await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      conversationId: 'c1',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        secondCalls.push(params.command?.stepIndex ?? -1);
        return { modelId: 'm1' };
      },
    });

    assert.equal(second.conversationId, 'c1');
    assert.deepEqual(secondCalls, [1, 2, 3]);
  });

  test('lock is per-conversation and does not block other conversations', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'improve',
      jsonText: JSON.stringify({
        Description: 'Improve plan',
        items: [{ type: 'message', role: 'user', content: ['s1'] }],
      }),
    });

    const barrier = deferred<void>();
    const started = deferred<void>();
    const c2Done = deferred<void>();

    const first = runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      conversationId: 'c1',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        if (params.conversationId === 'c1') {
          started.resolve();
          await barrier.promise;
          return { modelId: 'm1' };
        }
        c2Done.resolve();
        return { modelId: 'm1' };
      },
    });

    await started.promise;

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      conversationId: 'c2',
      source: 'REST',
      runAgentInstructionUnlocked: async () => {
        c2Done.resolve();
        return { modelId: 'm1' };
      },
    });

    await c2Done.promise;

    barrier.resolve();
    await first;
  });
});
