import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
} from '../../agents/service.js';
import { getChatInterface } from '../../chat/factory.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
  updateMemoryConversationWorkingFolder,
} from '../../chat/memoryPersistence.js';
import {
  __resetFlowServiceDepsForTests,
  __setFlowServiceDepsForTests,
} from '../../flows/service.js';
import { startFlowRun } from '../../flows/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { resetStore } from '../../logStore.js';
import { createConversationsRouter } from '../../routes/conversations.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { setWorkingFolderStatForTests } from '../../workingFolders/state.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
  withDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import {
  createMockCopilotSdkHarness,
  createSessionIdleEvent,
} from '../support/mockCopilotSdk.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import { bindCurrentTestOverrides } from '../support/testOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const buildRepoEntry = (containerPath: string): RepoEntry => ({
  id: path.basename(containerPath) || 'repo',
  description: null,
  containerPath,
  hostPath: containerPath,
  lastIngestAt: '2025-01-01T00:00:00.000Z',
  embeddingProvider: 'lmstudio',
  embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
  embeddingDimensions: 768,
  modelId: 'text-embedding-nomic-embed-text-v1.5',
  counts: { files: 0, chunks: 0, embedded: 0 },
  lastError: null,
});

class MinimalChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class CapturingFlowChat extends ChatInterface {
  constructor(
    private readonly calls: Array<{
      message: string;
      flags: Record<string, unknown>;
      conversationId: string;
    }>,
  ) {
    super();
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.calls.push({ message, flags, conversationId });
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', {
      type: 'final',
      content: message.includes('Answer with JSON only:')
        ? '{"answer":"yes"}'
        : 'ok',
    });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

beforeEach(() => {
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
  __resetAgentServiceDepsForTests();
  __resetFlowServiceDepsForTests();
  memoryConversations.clear();
  memoryTurns.clear();
  setWorkingFolderStatForTests(undefined);
  resetStore();
});

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const withFlowFixtureEnv = async (
  tmpDir: string,
  run: () => Promise<void>,
  overrides: Record<string, string | undefined> = {},
) =>
  await runWithTestEnvOverrides(
    {
      CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
      FLOWS_DIR: tmpDir,
      ...overrides,
    },
    run,
  );

const restoreEnvVar = (key: string, value: string | undefined) => {
  if (typeof value === 'string') {
    process.env[key] = value;
    return;
  }
  delete process.env[key];
};

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 4000,
  describe?: () => string,
): Promise<void> {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const deadline = Date.now() + resolvedTimeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    describe
      ? `Timed out waiting for test condition after ${resolvedTimeoutMs}ms | ${describe()}`
      : `Timed out waiting for test condition after ${resolvedTimeoutMs}ms`,
  );
}

const describeConversationState = (conversationId: string): string =>
  JSON.stringify({
    flags: memoryConversations.get(conversationId)?.flags ?? null,
    recentTurns: (memoryTurns.get(conversationId) ?? []).slice(-8).map((turn) => ({
      role: turn.role,
      status: turn.status,
      content: turn.content,
      provider: turn.provider,
      model: turn.model,
    })),
  });

test('POST /flows/:flowName/run validates working_folder', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(process.cwd())],
            lockedModelId: null,
          }),
        }),
      ),
    }),
  );

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      const invalid = await supertest(app)
        .post('/flows/llm-basic/run')
        .send({ working_folder: 'relative/path' });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.code, 'WORKING_FOLDER_INVALID');

      const missingPath = path.resolve(
        process.cwd(),
        'missing-workdir-' + Date.now().toString(),
      );
      const missing = await supertest(app)
        .post('/flows/llm-basic/run')
        .send({ working_folder: missingPath });
      assert.equal(missing.status, 400);
      assert.equal(missing.body.code, 'WORKING_FOLDER_NOT_FOUND');

      const valid = await supertest(app)
        .post('/flows/llm-basic/run')
        .send({ working_folder: process.cwd() });
      assert.equal(valid.status, 202);
      assert.equal(valid.body.status, 'started');
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run rejects resumeStepPath without conversationId before startFlowRun begins', async () => {
  let startCalls = 0;
  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: async () => {
        startCalls += 1;
        throw new Error('startFlowRun should not be reached');
      },
    }),
  );

  const res = await supertest(app)
    .post('/flows/llm-basic/run')
    .send({ resumeStepPath: [0] });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(
    res.body.message,
    'resumeStepPath requires an existing conversationId',
  );
  assert.equal(startCalls, 0);
});

test('POST /flows/:flowName/run surfaces a safe WORKING_FOLDER_UNAVAILABLE message', async () => {
  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: async () => {
        throw {
          code: 'WORKING_FOLDER_UNAVAILABLE',
          reason: 'working_folder could not be validated (EACCES)',
          causeCode: 'EACCES',
        };
      },
    }),
  );

  const res = await supertest(app)
    .post('/flows/llm-basic/run')
    .send({ conversationId: 'flow-unavailable' })
    .expect(503);

  assert.deepEqual(res.body, {
    error: 'working_folder_unavailable',
    code: 'WORKING_FOLDER_UNAVAILABLE',
    message: 'working_folder is temporarily unavailable',
  });
});

test('a stale saved path yields to a newer saved working folder before a flow restore completes', async () => {
  resetStore();
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-restore-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  const staleWorkingFolder = '/definitely/missing/path';
  const refreshedWorkingFolder = '/repos/newer-flow-working-folder';
  memoryConversations.set('flow-stale-restore', {
    _id: 'flow-stale-restore',
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Flow: llm-basic',
    flowName: 'llm-basic',
    source: 'REST',
    flags: { workingFolder: staleWorkingFolder },
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    archivedAt: null,
  });

  let updateHookUsed = false;

  const app = express();
  app.use(express.json());
  app.use(
    createConversationsRouter({
      listIngestedRepositories: async () => ({
        repos: [],
        lockedModelId: null,
      }),
      findConversationById: async (id) => memoryConversations.get(id) ?? null,
      updateConversationWorkingFolder: async (params) => {
        if (
          !updateHookUsed &&
          params.conversationId === 'flow-stale-restore' &&
          params.workingFolder == null &&
          params.expectedWorkingFolder === staleWorkingFolder
        ) {
          updateHookUsed = true;
          return updateMemoryConversationWorkingFolder({
            conversationId: 'flow-stale-restore',
            workingFolder: refreshedWorkingFolder,
          });
        }

        return (
          updateMemoryConversationWorkingFolder({
            conversationId: params.conversationId,
            workingFolder: params.workingFolder,
            expectedWorkingFolder: params.expectedWorkingFolder,
          }) ?? null
        );
      },
    }),
  );

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      const res = await supertest(app).get('/conversations?flowName=llm-basic');
      assert.equal(res.status, 200);
      assert.equal(updateHookUsed, true);
      assert.equal(
        res.body.items[0].flags.workingFolder,
        refreshedWorkingFolder,
      );
      assert.equal(
        memoryConversations.get('flow-stale-restore')?.flags?.workingFolder,
        refreshedWorkingFolder,
      );
    });
  } finally {
    memoryConversations.delete('flow-stale-restore');
    memoryTurns.delete('flow-stale-restore');
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('a fresh run from an older flow conversation does not inherit its stale saved working folder', async () => {
  resetStore();
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-rerun-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  memoryConversations.set('flow-stale-rerun', {
    _id: 'flow-stale-rerun',
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Flow: llm-basic',
    flowName: 'llm-basic',
    source: 'REST',
    flags: { workingFolder: '/definitely/missing/path' },
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    archivedAt: null,
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
        }),
      ),
    }),
  );

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      const res = await supertest(app)
        .post('/flows/llm-basic/run')
        .send({ conversationId: 'flow-stale-rerun' });
      assert.equal(res.status, 202);
      assert.notEqual(res.body.conversationId, 'flow-stale-rerun');
      assert.equal(
        memoryConversations.get(res.body.conversationId)?.flags?.workingFolder,
        undefined,
      );
      memoryConversations.delete(res.body.conversationId);
      memoryTurns.delete(res.body.conversationId);
    });
  } finally {
    memoryConversations.delete('flow-stale-rerun');
    memoryTurns.delete('flow-stale-rerun');
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('a fresh run still starts a replacement conversation when the older selected flow has a stale saved working folder', async () => {
  resetStore();
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-log-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  memoryConversations.set('flow-stale-log', {
    _id: 'flow-stale-log',
    provider: 'codex',
    model: 'gpt-5.1-codex-max',
    title: 'Flow: llm-basic',
    flowName: 'llm-basic',
    source: 'REST',
    flags: { workingFolder: '/definitely/missing/path' },
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    archivedAt: null,
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
        }),
      ),
    }),
  );

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      const res = await supertest(app)
        .post('/flows/llm-basic/run')
        .send({ conversationId: 'flow-stale-log' })
        .expect(202);

      assert.notEqual(res.body.conversationId, 'flow-stale-log');
      assert.equal(
        memoryConversations.get(res.body.conversationId)?.flags?.workingFolder,
        undefined,
      );
      memoryConversations.delete(res.body.conversationId);
      memoryTurns.delete(res.body.conversationId);
    });
  } finally {
    memoryConversations.delete('flow-stale-log');
    memoryTurns.delete('flow-stale-log');
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('a flow-created child agent conversation inherits the exact flow-step folder', async () => {
  resetStore();
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-child-'),
  );
  const workingFolder = path.join(tmpDir, 'working-root');
  await fs.mkdir(workingFolder, { recursive: true });
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  try {
    await withDeterministicCodexAvailabilityBootstrap(async () => {
      await runWithTestEnvOverrides(
        {
          CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
          CODEINFO_CODEX_HOME: path.join(repoRoot, 'codex'),
          FLOWS_DIR: tmpDir,
        },
        async () => {
          const app = express();
          app.use(
            createFlowsRunRouter({
              startFlowRun: bindCurrentTestOverrides((params) =>
                startFlowRun({
                  ...params,
                  chatFactory: () => new MinimalChat(),
                  listIngestedRepositories: async () => ({
                    repos: [buildRepoEntry(workingFolder)],
                    lockedModelId: null,
                  }),
                })),
            }),
          );

          const res = await supertest(app)
            .post('/flows/llm-basic/run')
            .send({
              conversationId: 'flow-child-working-folder',
              working_folder: workingFolder,
            })
            .expect(202);

          assert.equal(res.body.status, 'started');

          let childConversationId: string | undefined;
          await waitForCondition(
            () => {
              childConversationId = (
                memoryConversations.get('flow-child-working-folder')?.flags
                  ?.flow as
                  | { agentConversations?: Record<string, string> }
                  | undefined
              )?.agentConversations?.['coding_agent:basic'];
              return Boolean(childConversationId);
            },
            4000,
            () =>
              JSON.stringify({
                parent: JSON.parse(
                  describeConversationState('flow-child-working-folder'),
                ),
                childConversationId:
                  (
                    memoryConversations.get('flow-child-working-folder')?.flags
                      ?.flow as
                      | { agentConversations?: Record<string, string> }
                      | undefined
                  )?.agentConversations?.['coding_agent:basic'] ?? null,
                child:
                  childConversationId &&
                  memoryConversations.has(childConversationId)
                    ? JSON.parse(describeConversationState(childConversationId))
                    : null,
              }),
          );

          assert.ok(childConversationId);
          assert.equal(
            memoryConversations.get(childConversationId!)?.flags?.workingFolder,
            workingFolder,
          );
        },
      );
    });
  } finally {
    const childConversationId = (
      memoryConversations.get('flow-child-working-folder')?.flags?.flow as
        | { agentConversations?: Record<string, string> }
        | undefined
    )?.agentConversations?.['coding_agent:basic'];
    if (childConversationId) {
      memoryConversations.delete(childConversationId);
      memoryTurns.delete(childConversationId);
    }
    memoryConversations.delete('flow-child-working-folder');
    memoryTurns.delete('flow-child-working-folder');
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('flow llm steps map a host working_folder into the shared mounted runtime path', async () => {
  resetStore();
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const prevHostIngestDir = process.env.CODEINFO_HOST_INGEST_DIR;
  const prevCodexWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
  const prevCodeWorkdir = process.env.CODEX_WORKDIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-host-map-'),
  );
  const hostIngestDir = path.join(tmpDir, 'host', 'base');
  const codexWorkdir = path.join(tmpDir, 'data');
  const hostWorkingFolder = path.join(hostIngestDir, 'repo', 'sub');
  const expectedMounted = path.join(codexWorkdir, 'repo', 'sub');
  const calls: Array<{
    message: string;
    flags: Record<string, unknown>;
    conversationId: string;
  }> = [];
  await fs.mkdir(expectedMounted, { recursive: true });
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  process.env.CODEINFO_HOST_INGEST_DIR = hostIngestDir;
  process.env.CODEINFO_CODEX_WORKDIR = codexWorkdir;
  delete process.env.CODEX_WORKDIR;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new CapturingFlowChat(calls),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(expectedMounted)],
            lockedModelId: null,
          }),
        }),
    }),
  );

  try {
    await supertest(app)
      .post('/flows/llm-basic/run')
      .send({
        conversationId: 'flow-host-working-folder-map',
        working_folder: hostWorkingFolder,
      })
      .expect(202);

    await waitForCondition(
      () => calls.length >= 1,
      4000,
      () =>
        JSON.stringify({
          conversation: JSON.parse(
            describeConversationState('flow-host-working-folder-map'),
          ),
          calls,
          hostWorkingFolder,
          expectedMounted,
        }),
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.flags.workingDirectoryOverride, expectedMounted);
    assert.equal(
      memoryConversations.get('flow-host-working-folder-map')?.flags
        ?.workingFolder,
      expectedMounted,
    );
  } finally {
    memoryConversations.delete('flow-host-working-folder-map');
    memoryTurns.delete('flow-host-working-folder-map');
    restoreEnvVar('CODEINFO_CODEX_AGENT_HOME', prevAgentsHome);
    restoreEnvVar('FLOWS_DIR', prevFlowsDir);
    restoreEnvVar('CODEINFO_HOST_INGEST_DIR', prevHostIngestDir);
    restoreEnvVar('CODEINFO_CODEX_WORKDIR', prevCodexWorkdir);
    restoreEnvVar('CODEX_WORKDIR', prevCodeWorkdir);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('flow-owned llm steps default to the shared execution root when working_folder is empty', async () => {
  resetStore();
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const prevCodexWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
  const prevCodeWorkdir = process.env.CODEX_WORKDIR;
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-source-default-root-'),
  );
  const sourceRoot = path.join(tmpDir, 'source-root');
  const sharedExecutionRoot = path.join(tmpDir, 'shared-runtime-root');
  const calls: Array<{
    message: string;
    flags: Record<string, unknown>;
    conversationId: string;
  }> = [];
  await fs.mkdir(path.join(sourceRoot, 'flows'), { recursive: true });
  await fs.mkdir(sharedExecutionRoot, { recursive: true });
  await fs.cp(fixturesDir, path.join(sourceRoot, 'flows'), { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  process.env.CODEINFO_CODEX_WORKDIR = sharedExecutionRoot;
  delete process.env.CODEX_WORKDIR;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new CapturingFlowChat(calls),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(sourceRoot)],
            lockedModelId: null,
          }),
        }),
      ),
    }),
  );

  try {
    await supertest(app)
      .post('/flows/llm-basic/run')
      .send({
        conversationId: 'flow-source-default-root',
        sourceId: sourceRoot,
      })
      .expect(202);

    await waitForCondition(() => calls.length >= 1);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.message, 'Say hello from a flow step.');
    assert.equal(calls[0]?.flags.workingDirectoryOverride, sharedExecutionRoot);
    assert.equal(
      memoryConversations.get('flow-source-default-root')?.flags?.workingFolder,
      undefined,
    );
  } finally {
    memoryConversations.delete('flow-source-default-root');
    memoryTurns.delete('flow-source-default-root');
    restoreEnvVar('CODEINFO_CODEX_AGENT_HOME', prevAgentsHome);
    restoreEnvVar('FLOWS_DIR', prevFlowsDir);
    restoreEnvVar('CODEINFO_CODEX_WORKDIR', prevCodexWorkdir);
    restoreEnvVar('CODEX_WORKDIR', prevCodeWorkdir);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('flow execution preserves WORKING_FOLDER_UNAVAILABLE when the shared execution-context seam cannot validate the path', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-unavailable-'),
  );
  const workingFolder = path.join(process.cwd(), 'flow-unavailable-workdir');
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(workingFolder)],
            lockedModelId: null,
          }),
        }),
    }),
  );

  setWorkingFolderStatForTests(async () => {
    const error = new Error('denied') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    throw error;
  });

  try {
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ working_folder: workingFolder })
      .expect(503);

    assert.deepEqual(res.body, {
      error: 'working_folder_unavailable',
      code: 'WORKING_FOLDER_UNAVAILABLE',
      message: 'working_folder is temporarily unavailable',
    });
  } finally {
    setWorkingFolderStatForTests(undefined);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('validated working_folder also drives dedicated flow reingest target working', async () => {
  resetStore();
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-reingest-'),
  );
  const sourceRoot = path.join(tmpDir, 'flow-owner');
  const workingFolder = path.join(tmpDir, 'working-root');
  const calls: string[] = [];
  await fs.mkdir(path.join(sourceRoot, 'flows'), { recursive: true });
  await fs.mkdir(workingFolder, { recursive: true });
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  await fs.writeFile(
    path.join(sourceRoot, 'flows', 'working-folder-reingest.json'),
    JSON.stringify({
      description: 'working-folder-reingest',
      steps: [{ type: 'reingest', target: 'working' }],
    }),
  );
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(sourceRoot), buildRepoEntry(workingFolder)],
            lockedModelId: null,
          }),
        }),
    }),
  );

  __setFlowServiceDepsForTests({
    runReingestRepository: async ({ sourceId }) => {
      calls.push(sourceId ?? '(missing)');
      return {
        ok: true,
        value: {
          status: 'completed',
          operation: 'reembed',
          runId: 'run-working-folder',
          sourceId: sourceId ?? workingFolder,
          resolvedRepositoryId: path.basename(workingFolder),
          completionMode: 'reingested',
          durationMs: 10,
          files: 1,
          chunks: 1,
          embedded: 1,
          errorCode: null,
        },
      };
    },
    createCallId: () => 'call-working-folder',
  });

  try {
    const res = await supertest(app)
      .post('/flows/working-folder-reingest/run')
      .send({
        conversationId: 'flow-working-folder-reingest',
        sourceId: sourceRoot,
        working_folder: workingFolder,
      })
      .expect(202);

    assert.equal(res.body.status, 'started');
    await waitForCondition(
      () => {
        const turns = memoryTurns.get('flow-working-folder-reingest') ?? [];
        return turns.length >= 2;
      },
      4000,
      () =>
        JSON.stringify({
          calls,
          conversationFlags:
            memoryConversations.get('flow-working-folder-reingest')?.flags ?? null,
          recentTurns: (memoryTurns.get('flow-working-folder-reingest') ?? [])
            .slice(-8)
            .map((turn) => ({
              role: turn.role,
              status: turn.status,
              content: turn.content,
              toolCalls: turn.toolCalls,
            })),
        }),
    );

    const turns = memoryTurns.get('flow-working-folder-reingest') ?? [];
    assert.deepEqual(calls, [workingFolder]);
    assert.equal(
      memoryConversations.get('flow-working-folder-reingest')?.flags
        ?.workingFolder,
      workingFolder,
    );
    assert.equal(turns[1]?.role, 'assistant');
    assert.equal(
      (
        turns[1]?.toolCalls as {
          calls?: Array<{
            result?: { targetMode?: string; sourceId?: string };
          }>;
        } | null
      )?.calls?.[0]?.result?.targetMode,
      'working',
    );
    assert.equal(
      (
        turns[1]?.toolCalls as {
          calls?: Array<{ result?: { sourceId?: string } }>;
        } | null
      )?.calls?.[0]?.result?.sourceId,
      workingFolder,
    );
  } finally {
    __resetFlowServiceDepsForTests();
    memoryConversations.delete('flow-working-folder-reingest');
    memoryTurns.delete('flow-working-folder-reingest');
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('cross-repo harness-owned llm steps inherit CODEINFO_ROOT and target cwd', async () => {
  resetStore();
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-codeinfo-root-'),
  );
  const workingFolder = path.join(tmpDir, 'working-root');
  const calls: Array<{
    message: string;
    flags: Record<string, unknown>;
    conversationId: string;
  }> = [];
  await fs.mkdir(workingFolder, { recursive: true });
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new CapturingFlowChat(calls),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(workingFolder)],
            lockedModelId: null,
          }),
        }),
      ),
    }),
  );

  try {
    await withFlowFixtureEnv(tmpDir, async () => {
      await supertest(app)
        .post('/flows/llm-basic/run')
        .send({
          conversationId: 'flow-codeinfo-root-markdown',
          working_folder: workingFolder,
        })
        .expect(202);

      await waitForCondition(() => calls.length >= 1);

      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.message, 'Say hello from a flow step.');
      assert.equal(calls[0]?.flags.workingDirectoryOverride, workingFolder);
      assert.deepEqual(calls[0]?.flags.envOverrides, {
        CODEINFO_ROOT: repoRoot,
      });
    });
  } finally {
    memoryConversations.delete('flow-codeinfo-root-markdown');
    memoryTurns.delete('flow-codeinfo-root-markdown');
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('flow-owned Copilot agent steps forward CODEINFO_ROOT into the Copilot runtime environment', async () => {
  resetStore();
  const tempRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-copilot-env-root-'),
  );
  const flowsDir = path.join(tempRoot, 'flows');
  const agentsHome = path.join(tempRoot, 'agents');
  const agentHome = path.join(agentsHome, 'coding_agent');
  const codexHome = path.join(tempRoot, 'codex-home');
  const copilotHome = path.join(tempRoot, 'copilot-home');
  const workingFolder = path.join(tempRoot, 'working-root');
  await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(workingFolder, { recursive: true });
  await fs.cp(fixturesDir, flowsDir, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    'codeinfo_provider = "copilot"\nmodel = "copilot-model"\n',
    'utf8',
  );
  await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(codexHome, 'chat', 'config.toml'),
    'model = "codex-model"\n',
    'utf8',
  );
  await fs.writeFile(path.join(copilotHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    'model = "copilot-model"\n',
    'utf8',
  );

  const prevAgentHome = process.env.CODEINFO_AGENT_HOME;
  const prevLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const prevCodexHome = process.env.CODEINFO_CODEX_HOME;
  const prevCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.FLOWS_DIR = flowsDir;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEINFO_COPILOT_HOME = copilotHome;

  const capturedOptions: { env?: NodeJS.ProcessEnv }[] = [];
  const harness = createMockCopilotSdkHarness({
    name: 'flow-copilot-env-forwarding',
    createSessionEvents: [createSessionIdleEvent()],
  });

  __setAgentServiceDepsForTests({
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      models: ['copilot-model'],
      modelsRaw: [
        {
          id: 'copilot-model',
          name: 'Copilot Model',
          capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
          },
        },
      ],
      authSource: 'env-token',
    }),
  });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: (provider, deps) =>
            getChatInterface(provider, {
              ...deps,
              copilotClientFactory: (options) => {
                capturedOptions.push(options);
                return harness.createClientFactory()(options);
              },
            }),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(workingFolder)],
            lockedModelId: null,
          }),
        }),
    }),
  );

  try {
    await supertest(app)
      .post('/flows/llm-basic/run')
      .send({
        conversationId: 'flow-copilot-env-forwarding',
        working_folder: workingFolder,
      })
      .expect(202);

    await waitForCondition(() => capturedOptions.length >= 1);

    assert.equal(capturedOptions.length, 1);
    assert.equal(capturedOptions[0]?.env?.CODEINFO_ROOT, tempRoot);
    assert.equal(capturedOptions[0]?.env?.COPILOT_HOME, copilotHome);
  } finally {
    __resetAgentServiceDepsForTests();
    memoryConversations.delete('flow-copilot-env-forwarding');
    memoryTurns.delete('flow-copilot-env-forwarding');
    restoreEnvVar('CODEINFO_AGENT_HOME', prevAgentHome);
    restoreEnvVar('CODEINFO_CODEX_AGENT_HOME', prevLegacyAgentHome);
    restoreEnvVar('FLOWS_DIR', prevFlowsDir);
    restoreEnvVar('CODEINFO_CODEX_HOME', prevCodexHome);
    restoreEnvVar('CODEINFO_COPILOT_HOME', prevCopilotHome);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('break steps inherit CODEINFO_ROOT and the selected working_folder', async () => {
  resetStore();
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-break-root-'),
  );
  const workingFolder = path.join(tmpDir, 'working-root');
  const calls: Array<{
    message: string;
    flags: Record<string, unknown>;
    conversationId: string;
  }> = [];
  await fs.mkdir(workingFolder, { recursive: true });
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new CapturingFlowChat(calls),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(workingFolder)],
            lockedModelId: null,
          }),
        }),
    }),
  );

  try {
    await supertest(app)
      .post('/flows/loop-break/run')
      .send({
        conversationId: 'flow-break-working-folder',
        working_folder: workingFolder,
      })
      .expect(202);

    await waitForCondition(
      () => {
        const breakCalls = calls.filter((call) =>
          call.message.includes('Answer with JSON only:'),
        );
        return breakCalls.length >= 2;
      },
      4000,
      () =>
        JSON.stringify({
          calls,
          conversationFlags:
            memoryConversations.get('flow-break-working-folder')?.flags ?? null,
          recentTurns: (memoryTurns.get('flow-break-working-folder') ?? [])
            .slice(-8)
            .map((turn) => ({
              role: turn.role,
              status: turn.status,
              content: turn.content,
            })),
        }),
    );

    const breakCalls = calls.filter((call) =>
      call.message.includes('Answer with JSON only:'),
    );
    assert.equal(breakCalls.length, 2);
    breakCalls.forEach((call) => {
      assert.equal(call.flags.workingDirectoryOverride, workingFolder);
      assert.deepEqual(call.flags.envOverrides, {
        CODEINFO_ROOT: repoRoot,
      });
    });
  } finally {
    memoryConversations.delete('flow-break-working-folder');
    memoryTurns.delete('flow-break-working-folder');
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
