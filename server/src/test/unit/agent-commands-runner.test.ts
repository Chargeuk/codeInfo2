import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  __resetAgentCommandRunnerDepsForTests,
  __setAgentCommandRunnerDepsForTests,
  runAgentCommandRunner,
} from '../../agents/commandsRunner.js';
import {
  __resetMarkdownFileResolverDepsForTests,
  __setMarkdownFileResolverDepsForTests,
} from '../../flows/markdownFileResolver.js';
import type { ReingestError } from '../../ingest/reingestService.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { query, resetStore } from '../../logStore.js';

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

const buildRepoEntry = (params: {
  id: string;
  containerPath: string;
}): RepoEntry => ({
  id: params.id,
  description: null,
  containerPath: params.containerPath,
  hostPath: params.containerPath,
  lastIngestAt: null,
  embeddingProvider: 'lmstudio',
  embeddingModel: 'model',
  embeddingDimensions: 768,
  modelId: 'model',
  counts: { files: 0, chunks: 0, embedded: 0 },
  lastError: null,
});

const buildReingestSuccess = (
  overrides: Partial<{
    status: 'completed' | 'cancelled' | 'error';
    errorCode: string | null;
    sourceId: string;
    runId: string;
  }> = {},
) => ({
  status: 'completed' as const,
  operation: 'reembed' as const,
  runId: 'run-123',
  sourceId: '/repo/source-a',
  durationMs: 100,
  files: 3,
  chunks: 7,
  embedded: 7,
  errorCode: null,
  ...overrides,
});

const buildReingestError = (params: {
  message: 'INVALID_PARAMS' | 'NOT_FOUND' | 'BUSY';
  code: 'INVALID_SOURCE_ID' | 'NOT_FOUND' | 'BUSY';
  fieldMessage: string;
}): ReingestError => {
  if (params.message === 'INVALID_PARAMS') {
    return {
      code: -32602,
      message: 'INVALID_PARAMS',
      data: {
        tool: 'reingest_repository',
        code: 'INVALID_SOURCE_ID',
        retryable: true,
        retryMessage: 'retry',
        reingestableRepositoryIds: [],
        reingestableSourceIds: [],
        fieldErrors: [
          {
            field: 'sourceId',
            reason: 'unknown_root',
            message: params.fieldMessage,
          },
        ],
      },
    };
  }

  if (params.message === 'NOT_FOUND') {
    return {
      code: 404,
      message: 'NOT_FOUND',
      data: {
        tool: 'reingest_repository',
        code: 'NOT_FOUND',
        retryable: true,
        retryMessage: 'retry',
        reingestableRepositoryIds: [],
        reingestableSourceIds: [],
        fieldErrors: [
          {
            field: 'sourceId',
            reason: 'unknown_root',
            message: params.fieldMessage,
          },
        ],
      },
    };
  }

  return {
    code: 429,
    message: 'BUSY',
    data: {
      tool: 'reingest_repository',
      code: 'BUSY',
      retryable: true,
      retryMessage: 'retry',
      reingestableRepositoryIds: [],
      reingestableSourceIds: [],
      fieldErrors: [
        {
          field: 'sourceId',
          reason: 'busy',
          message: params.fieldMessage,
        },
      ],
    },
  };
};

async function writeMarkdownFile(params: {
  repoRoot: string;
  relativePath: string;
  content: string | Uint8Array;
}): Promise<string> {
  const filePath = path.join(
    params.repoRoot,
    'codeinfo_markdown',
    params.relativePath,
  );
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, params.content);
  return filePath;
}

async function createMarkdownHarness(baseDir: string) {
  const codeInfo2Root = path.join(baseDir, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const agentHome = path.join(agentsHome, 'a1');
  const sourceRepo = path.join(baseDir, 'repo-source');
  const otherRepo = path.join(baseDir, 'repo-other');
  const thirdRepo = path.join(baseDir, 'repo-third');

  await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });
  await fs.mkdir(sourceRepo, { recursive: true });
  await fs.mkdir(otherRepo, { recursive: true });
  await fs.mkdir(thirdRepo, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  __resetMarkdownFileResolverDepsForTests();
  __setMarkdownFileResolverDepsForTests({
    listIngestedRepositories: async () =>
      ({
        repos: [
          buildRepoEntry({ id: 'Source Repo', containerPath: sourceRepo }),
          buildRepoEntry({ id: 'Other Repo', containerPath: otherRepo }),
          buildRepoEntry({ id: 'Third Repo', containerPath: thirdRepo }),
        ],
      }) as never,
  });

  return { codeInfo2Root, agentHome, sourceRepo, otherRepo, thirdRepo };
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
  let previousAgentsHome: string | undefined;

  afterEach(async () => {
    __resetAgentCommandRunnerDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    resetStore();
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    previousAgentsHome = undefined;
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

  test('omitted startStep defaults to step 1', async () => {
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

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        calls.push(params.command?.stepIndex ?? -1);
        return { modelId: 'm1' };
      },
    });

    assert.deepEqual(calls, [1, 2, 3]);
  });

  test('valid non-default startStep runs from selected step and preserves absolute metadata', async () => {
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
          { type: 'message', role: 'user', content: ['s4'] },
        ],
      }),
    });
    const calls: Array<{ stepIndex: number; totalSteps: number }> = [];

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      startStep: 3,
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
      { stepIndex: 3, totalSteps: 4 },
      { stepIndex: 4, totalSteps: 4 },
    ]);
  });

  test('startStep lower bound of 1 is accepted', async () => {
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
    const calls: number[] = [];

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      startStep: 1,
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        calls.push(params.command?.stepIndex ?? -1);
        return { modelId: 'm1' };
      },
    });

    assert.deepEqual(calls, [1, 2]);
  });

  test('startStep upper bound of N executes only the final step', async () => {
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

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      startStep: 3,
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        calls.push(params.command?.stepIndex ?? -1);
        return { modelId: 'm1' };
      },
    });

    assert.deepEqual(calls, [3]);
  });

  test('startStep 0 fails with INVALID_START_STEP and deterministic message', async () => {
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

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'improve',
          startStep: 0,
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      (err) =>
        (err as { code?: string; reason?: string }).code ===
          'INVALID_START_STEP' &&
        (err as { code?: string; reason?: string }).reason ===
          'startStep must be between 1 and 3',
    );
  });

  test('startStep N+1 fails with INVALID_START_STEP and deterministic message', async () => {
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

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'improve',
          startStep: 4,
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      (err) =>
        (err as { code?: string; reason?: string }).code ===
          'INVALID_START_STEP' &&
        (err as { code?: string; reason?: string }).reason ===
          'startStep must be between 1 and 3',
    );
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

    assert.deepEqual(calls, [1, 2, 2, 2, 2, 2]);

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

  test('reingest items stay single-attempt while later message steps can still retry', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-then-message',
      jsonText: JSON.stringify({
        Description: 'Reingest then message',
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', content: ['hello'] },
        ],
      }),
    });

    let reingestCalls = 0;
    let lifecycleCalls = 0;
    const seenInstructions: string[] = [];

    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => {
        reingestCalls += 1;
        return { ok: true, value: buildReingestSuccess() };
      },
      runReingestStepLifecycle: async () => {
        lifecycleCalls += 1;
      },
    });

    let messageAttempts = 0;
    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'reingest-then-message',
      initialModelId: 'agent-model-1',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        seenInstructions.push(params.instruction);
        messageAttempts += 1;
        if (messageAttempts === 1) {
          throw new Error('first failure');
        }
        return { modelId: 'agent-model-1' };
      },
    });

    assert.equal(reingestCalls, 1);
    assert.equal(lifecycleCalls, 1);
    assert.equal(seenInstructions.length, 2);
    assert.equal(seenInstructions[0], 'hello');
    assert.match(seenInstructions[1], /Your previous attempt .* failed/i);
  });

  test('terminal completed reingest outcomes are recorded and execution continues', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-completed',
      jsonText: JSON.stringify({
        Description: 'Reingest completed',
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', content: ['after'] },
        ],
      }),
    });

    const lifecycleStatuses: string[] = [];
    const messageSteps: number[] = [];
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess({ status: 'completed' }),
      }),
      buildReingestToolResult: ({ callId, outcome }) => ({
        type: 'tool-result',
        callId,
        name: 'reingest_repository',
        stage: 'success',
        result: {
          kind: 'reingest_step_result',
          stepType: 'reingest',
          sourceId: outcome.sourceId,
          status: outcome.status,
          operation: outcome.operation,
          runId: outcome.runId,
          files: outcome.files,
          chunks: outcome.chunks,
          embedded: outcome.embedded,
          errorCode: outcome.errorCode,
        },
        error: null,
      }),
      runReingestStepLifecycle: async (params) => {
        lifecycleStatuses.push(
          (params.toolResult.result as { status: string }).status,
        );
      },
    });

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'reingest-completed',
      initialModelId: 'agent-model-1',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        messageSteps.push(params.command?.stepIndex ?? -1);
        return { modelId: 'agent-model-1' };
      },
    });

    assert.deepEqual(lifecycleStatuses, ['completed']);
    assert.deepEqual(messageSteps, [2]);
  });

  test('terminal cancelled reingest outcomes remain non-fatal once started', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-cancelled',
      jsonText: JSON.stringify({
        Description: 'Reingest cancelled',
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', content: ['after'] },
        ],
      }),
    });

    const lifecycleStatuses: string[] = [];
    const messageSteps: number[] = [];
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess({ status: 'cancelled' }),
      }),
      buildReingestToolResult: ({ callId, outcome }) => ({
        type: 'tool-result',
        callId,
        name: 'reingest_repository',
        stage: 'error',
        result: {
          kind: 'reingest_step_result',
          stepType: 'reingest',
          sourceId: outcome.sourceId,
          status: outcome.status,
          operation: outcome.operation,
          runId: outcome.runId,
          files: outcome.files,
          chunks: outcome.chunks,
          embedded: outcome.embedded,
          errorCode: outcome.errorCode,
        },
        error: null,
      }),
      runReingestStepLifecycle: async (params) => {
        lifecycleStatuses.push(
          (params.toolResult.result as { status: string }).status,
        );
      },
    });

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'reingest-cancelled',
      initialModelId: 'agent-model-1',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        messageSteps.push(params.command?.stepIndex ?? -1);
        return { modelId: 'agent-model-1' };
      },
    });

    assert.deepEqual(lifecycleStatuses, ['cancelled']);
    assert.deepEqual(messageSteps, [2]);
  });

  test('terminal error reingest outcomes remain non-fatal once started', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-error',
      jsonText: JSON.stringify({
        Description: 'Reingest error',
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', content: ['after'] },
        ],
      }),
    });

    const lifecycleStatuses: string[] = [];
    const messageSteps: number[] = [];
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess({
          status: 'error',
          errorCode: 'WAIT_TIMEOUT',
        }),
      }),
      buildReingestToolResult: ({ callId, outcome }) => ({
        type: 'tool-result',
        callId,
        name: 'reingest_repository',
        stage: 'error',
        result: {
          kind: 'reingest_step_result',
          stepType: 'reingest',
          sourceId: outcome.sourceId,
          status: outcome.status,
          operation: outcome.operation,
          runId: outcome.runId,
          files: outcome.files,
          chunks: outcome.chunks,
          embedded: outcome.embedded,
          errorCode: outcome.errorCode,
        },
        error: null,
      }),
      runReingestStepLifecycle: async (params) => {
        lifecycleStatuses.push(
          (params.toolResult.result as { status: string }).status,
        );
      },
    });

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'reingest-error',
      initialModelId: 'agent-model-1',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        messageSteps.push(params.command?.stepIndex ?? -1);
        return { modelId: 'agent-model-1' };
      },
    });

    assert.deepEqual(lifecycleStatuses, ['error']);
    assert.deepEqual(messageSteps, [2]);
  });

  test('accepted skipped outcomes stay on the public completed path', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-skipped-normalized',
      jsonText: JSON.stringify({
        Description: 'Reingest normalized',
        items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
      }),
    });

    const lifecycleStatuses: string[] = [];
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess({ status: 'completed' }),
      }),
      buildReingestToolResult: ({ callId, outcome }) => ({
        type: 'tool-result',
        callId,
        name: 'reingest_repository',
        stage: 'success',
        result: {
          kind: 'reingest_step_result',
          stepType: 'reingest',
          sourceId: outcome.sourceId,
          status: outcome.status,
          operation: outcome.operation,
          runId: outcome.runId,
          files: outcome.files,
          chunks: outcome.chunks,
          embedded: outcome.embedded,
          errorCode: outcome.errorCode,
        },
        error: null,
      }),
      runReingestStepLifecycle: async (params) => {
        lifecycleStatuses.push(
          (params.toolResult.result as { status: string }).status,
        );
      },
    });

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'reingest-skipped-normalized',
      initialModelId: 'agent-model-1',
      source: 'REST',
      runAgentInstructionUnlocked: async () => ({ modelId: 'agent-model-1' }),
    });

    assert.deepEqual(lifecycleStatuses, ['completed']);
  });

  test('stop during the blocking wait prevents the next item from starting', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-stop',
      jsonText: JSON.stringify({
        Description: 'Reingest stop',
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', content: ['after'] },
        ],
      }),
    });

    const wait = deferred<{
      ok: true;
      value: ReturnType<typeof buildReingestSuccess>;
    }>();
    const controller = new AbortController();
    const messageSteps: number[] = [];

    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => wait.promise,
      runReingestStepLifecycle: async () => undefined,
    });

    const run = runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'reingest-stop',
      initialModelId: 'agent-model-1',
      source: 'REST',
      signal: controller.signal,
      runAgentInstructionUnlocked: async (params) => {
        messageSteps.push(params.command?.stepIndex ?? -1);
        return { modelId: 'agent-model-1' };
      },
    });

    controller.abort();
    wait.resolve({ ok: true, value: buildReingestSuccess() });
    await run;

    assert.deepEqual(messageSteps, []);
  });

  test('malformed sourceId failures stop before later items begin', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-bad-source',
      jsonText: JSON.stringify({
        Description: 'Reingest bad source',
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', content: ['after'] },
        ],
      }),
    });

    let messageCalls = 0;
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: buildReingestError({
          message: 'INVALID_PARAMS',
          code: 'INVALID_SOURCE_ID',
          fieldMessage: 'sourceId must be an absolute path',
        }),
      }),
    });

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'reingest-bad-source',
          initialModelId: 'agent-model-1',
          source: 'REST',
          runAgentInstructionUnlocked: async () => {
            messageCalls += 1;
            return { modelId: 'agent-model-1' };
          },
        }),
      (err) =>
        (err as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        (err as { code?: string; reason?: string }).reason ===
          'sourceId must be an absolute path',
    );

    assert.equal(messageCalls, 0);
  });

  test('unknown sourceId failures stop before later items begin', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-missing-source',
      jsonText: JSON.stringify({
        Description: 'Reingest missing source',
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', content: ['after'] },
        ],
      }),
    });

    let messageCalls = 0;
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: buildReingestError({
          message: 'NOT_FOUND',
          code: 'NOT_FOUND',
          fieldMessage:
            'sourceId must match an existing ingested repository root exactly',
        }),
      }),
    });

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'reingest-missing-source',
          initialModelId: 'agent-model-1',
          source: 'REST',
          runAgentInstructionUnlocked: async () => {
            messageCalls += 1;
            return { modelId: 'agent-model-1' };
          },
        }),
      (err) =>
        (err as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        (err as { code?: string; reason?: string }).reason ===
          'sourceId must match an existing ingested repository root exactly',
    );

    assert.equal(messageCalls, 0);
  });

  test('busy reingest refusals stop the direct command clearly', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-busy',
      jsonText: JSON.stringify({
        Description: 'Reingest busy',
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', content: ['after'] },
        ],
      }),
    });

    let messageCalls = 0;
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: buildReingestError({
          message: 'BUSY',
          code: 'BUSY',
          fieldMessage:
            'reingest is currently locked by another ingest operation',
        }),
      }),
    });

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'reingest-busy',
          initialModelId: 'agent-model-1',
          source: 'REST',
          runAgentInstructionUnlocked: async () => {
            messageCalls += 1;
            return { modelId: 'agent-model-1' };
          },
        }),
      (err) =>
        (err as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        (err as { code?: string; reason?: string }).reason ===
          'reingest is currently locked by another ingest operation',
    );

    assert.equal(messageCalls, 0);
  });

  test('shared prestart formatter fallback stays aligned for direct command failures', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-format-fallback',
      jsonText: JSON.stringify({
        Description: 'Reingest fallback formatting',
        items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
      }),
    });

    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: buildReingestError({
          message: 'INVALID_PARAMS',
          code: 'INVALID_SOURCE_ID',
          fieldMessage: '',
        }),
      }),
    });

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'reingest-format-fallback',
          initialModelId: 'agent-model-1',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({
            modelId: 'agent-model-1',
          }),
        }),
      (err) =>
        (err as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        (err as { code?: string; reason?: string }).reason ===
          'INVALID_PARAMS: INVALID_SOURCE_ID',
    );
  });

  test('unexpected thrown exceptions before a terminal result fail the command clearly', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'reingest-throws',
      jsonText: JSON.stringify({
        Description: 'Reingest throws',
        items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
      }),
    });

    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => {
        throw new Error('unexpected reingest failure');
      },
    });

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: 'reingest-throws',
          initialModelId: 'agent-model-1',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({
            modelId: 'agent-model-1',
          }),
        }),
      /unexpected reingest failure/,
    );
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

  test('rejects command names that attempt path traversal', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    const agentHome = path.join(tmpDir, 'a1');

    await assert.rejects(
      async () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome,
          commandName: '../escape',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      (err) => (err as { code?: string }).code === 'COMMAND_INVALID',
    );
  });

  test('markdownFile message items load one markdown instruction and execute once', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    const harness = await createMarkdownHarness(tmpDir);
    await writeCommandFile({
      agentHome: harness.agentHome,
      commandName: 'markdown-once',
      jsonText: JSON.stringify({
        Description: 'Markdown once',
        items: [{ type: 'message', role: 'user', markdownFile: 'once.md' }],
      }),
    });
    await writeMarkdownFile({
      repoRoot: harness.codeInfo2Root,
      relativePath: 'once.md',
      content: '# Heading\n\nBody',
    });

    const instructions: string[] = [];

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome: harness.agentHome,
      commandName: 'markdown-once',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        instructions.push(params.instruction);
        return { modelId: 'm1' };
      },
    });

    assert.deepEqual(instructions, ['# Heading\n\nBody']);
    const logs = query({
      text: 'DEV-0000045:T4:direct_command_markdown_message_loaded',
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.context?.resolvedSourceId, harness.codeInfo2Root);
  });

  test('markdownFile instructions are passed through verbatim', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    const harness = await createMarkdownHarness(tmpDir);
    const markdown = '  # Title\n\n- first item\n- second item\n';
    await writeCommandFile({
      agentHome: harness.agentHome,
      commandName: 'markdown-verbatim',
      jsonText: JSON.stringify({
        Description: 'Markdown verbatim',
        items: [{ type: 'message', role: 'user', markdownFile: 'verbatim.md' }],
      }),
    });
    await writeMarkdownFile({
      repoRoot: harness.codeInfo2Root,
      relativePath: 'verbatim.md',
      content: markdown,
    });

    let seenInstruction = '';

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome: harness.agentHome,
      commandName: 'markdown-verbatim',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        seenInstruction = params.instruction;
        return { modelId: 'm1' };
      },
    });

    assert.equal(seenInstruction, markdown);
  });

  test('multiple markdownFile items execute in order', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    const harness = await createMarkdownHarness(tmpDir);
    await writeCommandFile({
      agentHome: harness.agentHome,
      commandName: 'markdown-multi',
      jsonText: JSON.stringify({
        Description: 'Markdown multi',
        items: [
          { type: 'message', role: 'user', markdownFile: 'one.md' },
          { type: 'message', role: 'user', markdownFile: 'two.md' },
        ],
      }),
    });
    await writeMarkdownFile({
      repoRoot: harness.codeInfo2Root,
      relativePath: 'one.md',
      content: 'first markdown',
    });
    await writeMarkdownFile({
      repoRoot: harness.codeInfo2Root,
      relativePath: 'two.md',
      content: 'second markdown',
    });

    const instructions: string[] = [];

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome: harness.agentHome,
      commandName: 'markdown-multi',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        instructions.push(params.instruction);
        return { modelId: 'm1' };
      },
    });

    assert.deepEqual(instructions, ['first markdown', 'second markdown']);
  });

  test('markdownFile and inline content items can be mixed without changing inline behavior', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    const harness = await createMarkdownHarness(tmpDir);
    await writeCommandFile({
      agentHome: harness.agentHome,
      commandName: 'markdown-mixed',
      jsonText: JSON.stringify({
        Description: 'Markdown mixed',
        items: [
          { type: 'message', role: 'user', markdownFile: 'mixed.md' },
          {
            type: 'message',
            role: 'user',
            content: ['inline one', 'inline two'],
          },
        ],
      }),
    });
    await writeMarkdownFile({
      repoRoot: harness.codeInfo2Root,
      relativePath: 'mixed.md',
      content: 'markdown mixed',
    });

    const instructions: string[] = [];

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome: harness.agentHome,
      commandName: 'markdown-mixed',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        instructions.push(params.instruction);
        return { modelId: 'm1' };
      },
    });

    assert.deepEqual(instructions, [
      'markdown mixed',
      'inline one\ninline two',
    ]);
  });

  test('sourceId same-source markdown wins over codeInfo2 fallback', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    const harness = await createMarkdownHarness(tmpDir);
    await writeCommandFile({
      agentHome: harness.agentHome,
      commandName: 'markdown-source-wins',
      jsonText: JSON.stringify({
        Description: 'Markdown source wins',
        items: [{ type: 'message', role: 'user', markdownFile: 'source.md' }],
      }),
    });
    await writeMarkdownFile({
      repoRoot: harness.codeInfo2Root,
      relativePath: 'source.md',
      content: 'codeinfo2 markdown',
    });
    await writeMarkdownFile({
      repoRoot: harness.sourceRepo,
      relativePath: 'source.md',
      content: 'source markdown',
    });

    let seenInstruction = '';

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome: harness.agentHome,
      commandName: 'markdown-source-wins',
      source: 'REST',
      sourceId: harness.sourceRepo,
      runAgentInstructionUnlocked: async (params) => {
        seenInstruction = params.instruction;
        return { modelId: 'm1' };
      },
    });

    assert.equal(seenInstruction, 'source markdown');
  });

  test('sourceId falls back to codeInfo2 when same-source markdown is missing', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    const harness = await createMarkdownHarness(tmpDir);
    await writeCommandFile({
      agentHome: harness.agentHome,
      commandName: 'markdown-source-fallback',
      jsonText: JSON.stringify({
        Description: 'Markdown source fallback',
        items: [{ type: 'message', role: 'user', markdownFile: 'fallback.md' }],
      }),
    });
    await writeMarkdownFile({
      repoRoot: harness.codeInfo2Root,
      relativePath: 'fallback.md',
      content: 'codeinfo2 fallback markdown',
    });

    let seenInstruction = '';

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome: harness.agentHome,
      commandName: 'markdown-source-fallback',
      source: 'REST',
      sourceId: harness.sourceRepo,
      runAgentInstructionUnlocked: async (params) => {
        seenInstruction = params.instruction;
        return { modelId: 'm1' };
      },
    });

    assert.equal(seenInstruction, 'codeinfo2 fallback markdown');
  });

  test('missing markdown files fail clearly', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    const harness = await createMarkdownHarness(tmpDir);
    await writeCommandFile({
      agentHome: harness.agentHome,
      commandName: 'markdown-missing',
      jsonText: JSON.stringify({
        Description: 'Markdown missing',
        items: [{ type: 'message', role: 'user', markdownFile: 'missing.md' }],
      }),
    });

    await assert.rejects(
      () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome: harness.agentHome,
          commandName: 'markdown-missing',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      /was not found in any codeinfo_markdown repository candidate/,
    );
  });

  test('undecodable markdown bytes surface as command failures', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    const harness = await createMarkdownHarness(tmpDir);
    await writeCommandFile({
      agentHome: harness.agentHome,
      commandName: 'markdown-invalid-utf8',
      jsonText: JSON.stringify({
        Description: 'Markdown invalid utf8',
        items: [{ type: 'message', role: 'user', markdownFile: 'bad.md' }],
      }),
    });
    await writeMarkdownFile({
      repoRoot: harness.codeInfo2Root,
      relativePath: 'bad.md',
      content: Uint8Array.from([0xc3, 0x28]),
    });

    await assert.rejects(
      () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome: harness.agentHome,
          commandName: 'markdown-invalid-utf8',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      /Invalid UTF-8 markdown content/,
    );
  });

  test('unexpected resolver failures surface as clear command errors', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    const harness = await createMarkdownHarness(tmpDir);
    await writeCommandFile({
      agentHome: harness.agentHome,
      commandName: 'markdown-resolver-explosion',
      jsonText: JSON.stringify({
        Description: 'Markdown resolver explosion',
        items: [{ type: 'message', role: 'user', markdownFile: 'boom.md' }],
      }),
    });
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => {
        throw new Error('resolver exploded');
      },
    });

    await assert.rejects(
      () =>
        runAgentCommandRunner({
          agentName: 'a1',
          agentHome: harness.agentHome,
          commandName: 'markdown-resolver-explosion',
          source: 'REST',
          runAgentInstructionUnlocked: async () => ({ modelId: 'm1' }),
        }),
      /resolver exploded/,
    );
  });

  test('inline content message execution remains unchanged after markdown support', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-runner-'));
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    const harness = await createMarkdownHarness(tmpDir);
    await writeCommandFile({
      agentHome: harness.agentHome,
      commandName: 'inline-still-works',
      jsonText: JSON.stringify({
        Description: 'Inline still works',
        items: [{ type: 'message', role: 'user', content: ['alpha', 'beta'] }],
      }),
    });

    let seenInstruction = '';

    await runAgentCommandRunner({
      agentName: 'a1',
      agentHome: harness.agentHome,
      commandName: 'inline-still-works',
      source: 'REST',
      runAgentInstructionUnlocked: async (params) => {
        seenInstruction = params.instruction;
        return { modelId: 'm1' };
      },
    });

    assert.equal(seenInstruction, 'alpha\nbeta');
  });
});
