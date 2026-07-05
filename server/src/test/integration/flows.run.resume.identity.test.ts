import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import { getActiveRunOwnership } from '../../agents/runLock.js';
import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
} from '../../agents/service.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __resetProviderBootstrapStatusForTests,
  __setProviderBootstrapStatusForTests,
} from '../../config/runtimeConfig.js';
import { startFlowRun } from '../../flows/service.js';
import {
  __resetFlowResumeTestDepsForTests,
  __resetFlowWaitResumeDepsForTests,
  __setFlowResumeTestDepsForTests,
  __setFlowWaitResumeDepsForTests,
} from '../../flows/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { query } from '../../logStore.js';
import type { Conversation } from '../../mongo/conversation.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { withMockedMongoConversationPersistence } from '../support/conversationMongoPersistenceStub.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const buildRepoEntry = (containerPath: string): RepoEntry => ({
  id: path.posix.basename(containerPath.replace(/\\/g, '/')) || 'repo',
  description: null,
  containerPath,
  hostPath: containerPath,
  lastIngestAt: null,
  embeddingProvider: 'lmstudio',
  embeddingModel: 'model',
  embeddingDimensions: 768,
  model: 'model',
  modelId: 'model',
  lock: {
    embeddingProvider: 'lmstudio',
    embeddingModel: 'model',
    embeddingDimensions: 768,
    lockedModelId: 'model',
    modelId: 'model',
  },
  counts: { files: 0, chunks: 0, embedded: 0 },
  lastError: null,
});

beforeEach(() => {
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
  __resetProviderBootstrapStatusForTests();
  __resetFlowWaitResumeDepsForTests();
});

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 10000,
  intervalMs = 50,
  describe?: () => string,
) => {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const startedAt = Date.now();
  while (Date.now() - startedAt < resolvedTimeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    describe
      ? `Timed out waiting for predicate | ${describe()}`
      : 'Timed out waiting for predicate',
  );
};

const flushWakeBoundary = async () =>
  await new Promise<void>((resolve) => setImmediate(resolve));

const getAssistantTurnCount = (conversationId: string) =>
  (memoryTurns.get(conversationId) ?? []).filter(
    (turn) => turn?.role === 'assistant',
  ).length;

const describeConversationState = (conversationId: string) =>
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

const describeRelevantResumeRuntimeLogs = (conversationId: string) =>
  JSON.stringify(
    query({ text: 'flows.test.' }, 300)
      .filter((entry) => entry.context?.conversationId === conversationId)
      .slice(-25)
      .map((entry) => ({
        message: entry.message,
        context: entry.context,
      })),
  );

const writeResumeFlow = async (dir: string) => {
  const flow = {
    description: 'Resume test flow',
    steps: [
      {
        type: 'llm',
        label: 'Step 1',
        agentType: 'coding_agent',
        identifier: 'resume-test',
        messages: [{ role: 'user', content: ['Step 1'] }],
      },
      {
        type: 'llm',
        label: 'Step 2',
        agentType: 'coding_agent',
        identifier: 'resume-test',
        messages: [{ role: 'user', content: ['Step 2'] }],
      },
    ],
  };
  await fs.writeFile(
    path.join(dir, 'resume-basic.json'),
    JSON.stringify(flow, null, 2),
  );
};

const writeDualAgentResumeFlow = async (dir: string) => {
  const flow = {
    description: 'Resume dual-agent identity flow',
    steps: [
      {
        type: 'llm',
        label: 'Step 1',
        agentType: 'missing_agent',
        identifier: 'resume-missing',
        messages: [{ role: 'user', content: ['Missing Step 1'] }],
      },
      {
        type: 'llm',
        label: 'Step 2',
        agentType: 'planning_agent',
        identifier: 'resume-plan',
        messages: [{ role: 'user', content: ['Plan Step 2'] }],
      },
    ],
  };
  await fs.writeFile(
    path.join(dir, 'resume-dual-identity.json'),
    JSON.stringify(flow, null, 2),
  );
};

const writeWaitResumeFlow = async (dir: string) => {
  const flow = {
    description: 'Wait resume test flow',
    steps: [
      {
        type: 'llm',
        label: 'Step 1',
        agentType: 'coding_agent',
        identifier: 'resume-test',
        messages: [{ role: 'user', content: ['Step 1'] }],
      },
      {
        type: 'wait',
        label: 'Wait step',
        seconds: 60,
      },
      {
        type: 'llm',
        label: 'Step 2',
        agentType: 'coding_agent',
        identifier: 'resume-test',
        messages: [{ role: 'user', content: ['Step 2'] }],
      },
    ],
  };
  await fs.writeFile(
    path.join(dir, 'wait-resume.json'),
    JSON.stringify(flow, null, 2),
  );
};

class MinimalChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversation: string,
    _model: string,
  ) {
    void _flags;
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversation });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversation });
  }
}

const getFlowExecutionId = (conversationId: string) => {
  const conversation = memoryConversations.get(conversationId);
  const flags = (conversation?.flags ?? {}) as {
    flow?: { executionId?: string };
  };
  assert.equal(typeof flags.flow?.executionId, 'string');
  return flags.flow?.executionId as string;
};

const getFlowChildExecutionId = (conversationId: string) => {
  const conversation = memoryConversations.get(conversationId);
  const flags = (conversation?.flags ?? {}) as {
    flowChild?: { executionId?: string };
  };
  assert.equal(typeof flags.flowChild?.executionId, 'string');
  return flags.flowChild?.executionId as string;
};

const snapshotFlowChildConversation = (
  conversation: Conversation | null | undefined,
) => ({
  provider: conversation?.provider,
  model: conversation?.model,
  endpointId: conversation?.flags?.endpointId,
  flowChildExecutionId: (
    (conversation?.flags ?? {}) as {
      flowChild?: { executionId?: string };
    }
  ).flowChild?.executionId,
});

const writeFlowResumeAgentHome = async (params: {
  agentsHome: string;
  codexHome: string;
  endpointId: string;
  modelId: string;
}) => {
  const agentHome = path.join(params.agentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.mkdir(path.join(params.codexHome, 'chat'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    [
      'codeinfo_provider = "codex"',
      `model = "${params.modelId}"`,
      `codeinfo_openai_endpoint = "${params.endpointId}|responses"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(params.codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(params.codexHome, 'config.toml'), '', 'utf8');
  await fs.writeFile(
    path.join(params.codexHome, 'chat', 'config.toml'),
    `model = "${params.modelId}"\n`,
    'utf8',
  );
};

const buildApp = () => {
  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
        }),
    }),
  );
  return { app, supertest };
};

test('startFlowRun resumes after resumeStepPath from legitimate server-owned persisted flow state', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-conv-1';
  const childConversationId = 'agent-conv-resume-1';
  const originalTitle = 'Flow: resume-basic';
  const customTitle = 'Resume Custom Title';
  const captured: string[] = [];

  class TrackingChat extends ChatInterface {
    async execute(
      message: string,
      _flags: Record<string, unknown>,
      conversation: string,
      _model: string,
    ) {
      void _flags;
      void _model;
      captured.push(message);
      this.emit('thread', { type: 'thread', threadId: conversation });
      this.emit('final', { type: 'final', content: 'ok' });
      this.emit('complete', { type: 'complete', threadId: conversation });
    }
  }

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: originalTitle,
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-1',
        stepPath: [0],
        loopStack: [{ loopStepPath: [0], iteration: 1 }],
        agentConversations: {
          'coding_agent:resume-test': childConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(childConversationId, {
    _id: childConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {
      flowChild: {
        executionId: 'resume-execution-1',
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await startFlowRun({
      flowName: 'resume-basic',
      conversationId,
      resumeStepPath: [0],
      customTitle,
      source: 'REST',
      chatFactory: () => new TrackingChat(),
    });

    await waitFor(
      () => captured.length === 1,
      10000,
      50,
      () => describeConversationState(conversationId),
    );
    assert.equal(captured[0], 'Step 2');
    const conversation = memoryConversations.get(conversationId);
    assert.equal(conversation?.title, originalTitle);
    assert.equal(getFlowExecutionId(conversationId), 'resume-execution-1');
    assert.equal(
      (
        (conversation?.flags ?? {}) as {
          flow?: { agentConversations?: Record<string, string> };
        }
      ).flow?.agentConversations?.['coding_agent:resume-test'],
      childConversationId,
    );
    assert.equal(
      getFlowChildExecutionId(childConversationId),
      'resume-execution-1',
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun rejects resumeStepPath without conversationId before repository discovery begins', async () => {
  let repoListCalls = 0;

  await assert.rejects(
    () =>
      startFlowRun({
        flowName: 'resume-basic',
        resumeStepPath: [0],
        source: 'REST',
        chatFactory: () => new MinimalChat(),
        listIngestedRepositories: async () => {
          repoListCalls += 1;
          return { repos: [], lockedModelId: null };
        },
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'INVALID_REQUEST');
      assert.equal(
        (error as { reason?: string }).reason,
        'resumeStepPath requires an existing conversationId',
      );
      return true;
    },
  );

  assert.equal(repoListCalls, 0);
});

test('startFlowRun keeps resumed child execution pinned to the saved provider and model', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-pinned-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-pinned-conv-1';
  const childConversationId = 'agent-conv-resume-pinned-1';
  const capturedModels: string[] = [];

  class TrackingChat extends ChatInterface {
    async execute(
      message: string,
      _flags: Record<string, unknown>,
      conversation: string,
      model: string,
    ) {
      void _flags;
      capturedModels.push(model);
      this.emit('thread', { type: 'thread', threadId: conversation });
      this.emit('final', { type: 'final', content: `ok:${message}` });
      this.emit('complete', { type: 'complete', threadId: conversation });
    }
  }

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.4',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-pinned-1',
        stepPath: [0],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': childConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(childConversationId, {
    _id: childConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {
      flowChild: {
        executionId: 'resume-execution-pinned-1',
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await startFlowRun({
      flowName: 'resume-basic',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new TrackingChat(),
    });

    await waitFor(() => capturedModels.length === 1, 15000);
    assert.deepEqual(capturedModels, ['gpt-5.2-codex']);
    assert.equal(
      memoryConversations.get(childConversationId)?.provider,
      'codex',
    );
    assert.equal(
      memoryConversations.get(childConversationId)?.model,
      'gpt-5.2-codex',
    );
    const childTurns = memoryTurns.get(childConversationId) ?? [];
    assert.equal(childTurns.at(-1)?.model, 'gpt-5.2-codex');
    assert.equal(childTurns.at(-1)?.provider, 'codex');
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun keeps resumed child endpoint identity pinned and fails in place when the saved endpoint disappears', async () => {
  const prevAgentHome = process.env.CODEINFO_AGENT_HOME;
  const prevLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevCodexHome = process.env.CODEINFO_CODEX_HOME;
  const prevRuntimeCodexHome = process.env.CODEX_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const prevCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const originalInfo = console.info;
  const originalError = console.error;
  const infoLogs: string[] = [];
  const errorLogs: string[] = [];
  const conversationId = 'flow-resume-endpoint-fail';
  const childConversationId = 'agent-conv-resume-endpoint-fail';
  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const agentHome = path.join(agentsHome, 'coding_agent');
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-endpoint-fail-'),
  );
  let externalServer: Awaited<
    ReturnType<typeof startExternalOpenAiCompatServer>
  > | null = null;

  try {
    console.info = (...args: unknown[]) => {
      infoLogs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    };
    await writeResumeFlow(tmpDir);

    externalServer = await startExternalOpenAiCompatServer({
      responseMode: 'transport-failure',
    });
    const endpointId = `${externalServer.baseUrl}/v1`;

    await fs.mkdir(agentHome, { recursive: true });
    await fs.mkdir(path.join(codexHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
    await fs.writeFile(
      path.join(agentHome, 'config.toml'),
      [
        'codeinfo_provider = "codex"',
        'model = "gpt-5.2-codex"',
        `codeinfo_openai_endpoint = "${endpointId}|responses"`,
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(path.join(codexHome, 'auth.json'), '{}', 'utf8');
    await fs.writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');
    await fs.writeFile(
      path.join(codexHome, 'chat', 'config.toml'),
      'model = "gpt-5.2-codex"\n',
      'utf8',
    );

    process.env.CODEINFO_AGENT_HOME = agentsHome;
    process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
    process.env.CODEINFO_CODEX_HOME = codexHome;
    process.env.CODEX_HOME = codexHome;
    process.env.FLOWS_DIR = tmpDir;
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${endpointId}|responses`;

    await withMockedMongoConversationPersistence({
      seedConversations: [
        {
          _id: conversationId,
          provider: 'codex',
          model: 'gpt-5.2-codex',
          title: 'Flow: resume-basic',
          flowName: 'resume-basic',
          source: 'REST',
          flags: {
            flow: {
              executionId: 'resume-execution-endpoint-fail',
              stepPath: [0],
              loopStack: [],
              agentConversations: {
                'coding_agent:resume-test': childConversationId,
              },
              agentProviders: {
                'coding_agent:resume-test': 'codex',
              },
              agentModels: {
                'coding_agent:resume-test': 'flow-current-model',
              },
              agentEndpointIds: {
                'coding_agent:resume-test': endpointId,
              },
              agentThreads: {},
            },
          },
          lastMessageAt: new Date(),
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: childConversationId,
          provider: 'codex',
          model: 'gpt-5.2-codex',
          title: 'Flow: resume-basic (resume-test)',
          agentName: 'coding_agent',
          source: 'REST',
          flags: {
            endpointId,
            flowChild: {
              executionId: 'resume-execution-endpoint-fail',
            },
          },
          lastMessageAt: new Date(),
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Conversation,
      ],
      run: async ({ conversations }) => {
        const result = await startFlowRun({
          flowName: 'resume-basic',
          conversationId,
          resumeStepPath: [0],
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        });
        assert.equal(result.providerId, 'codex');
        await waitFor(
          () =>
            [...infoLogs, ...errorLogs].some((line) =>
              line.includes('PROVIDER_UNAVAILABLE'),
            ),
          5000,
          50,
          () =>
            JSON.stringify({
              infoLogs,
              errorLogs,
              parent: JSON.parse(describeConversationState(conversationId)),
              child: JSON.parse(describeConversationState(childConversationId)),
            }),
        );

        assert.equal(
          (
            conversations.get(conversationId)?.flags as
              | { flow?: { agentEndpointIds?: Record<string, string> } }
              | undefined
          )?.flow?.agentEndpointIds?.['coding_agent:resume-test'],
          endpointId,
        );
        assert.equal(conversations.get(childConversationId)?.provider, 'codex');
        assert.equal(
          conversations.get(childConversationId)?.model,
          'gpt-5.2-codex',
        );
      },
    });
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    await externalServer?.stop();
    if (prevAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = prevAgentHome;
    }
    if (prevLegacyAgentHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevLegacyAgentHome;
    }
    if (prevCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = prevCodexHome;
    }
    if (prevRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = prevRuntimeCodexHome;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    if (prevCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        prevCompatEndpoints;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
  }
});

test('Task 9 resumes flow-owned child execution from the saved child endpoint identity', async () => {
  const prevAgentHome = process.env.CODEINFO_AGENT_HOME;
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevCodexHome = process.env.CODEINFO_CODEX_HOME;
  const prevRuntimeCodexHome = process.env.CODEX_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const prevCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-child-endpoint-'),
  );
  await writeResumeFlow(tmpDir);

  const externalServer = await startExternalOpenAiCompatServer({
    models: ['flow-current-model'],
  });
  const endpointId = `${externalServer.baseUrl}/v1`;
  const childConversationId = 'agent-conv-flow-endpoint-success';
  const conversationId = 'flow-conv-flow-endpoint-success';
  const capturedFlags: Array<Record<string, unknown>> = [];
  let resolveFirstExecute:
    | ((flags: Record<string, unknown>) => void)
    | undefined;
  const firstExecute = new Promise<Record<string, unknown>>((resolve) => {
    resolveFirstExecute = resolve;
  });

  class TrackingChat extends ChatInterface {
    async execute(
      _message: string,
      flags: Record<string, unknown>,
      conversation: string,
      _model: string,
    ) {
      void _message;
      void _model;
      capturedFlags.push({ ...flags });
      resolveFirstExecute?.({ ...flags });
      resolveFirstExecute = undefined;
      this.emit('thread', { type: 'thread', threadId: conversation });
      this.emit('final', { type: 'final', content: 'ok' });
      this.emit('complete', { type: 'complete', threadId: conversation });
    }
  }

  await writeFlowResumeAgentHome({
    agentsHome,
    codexHome,
    endpointId,
    modelId: 'flow-current-model',
  });

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.FLOWS_DIR = tmpDir;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${endpointId}|responses`;

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'flow-current-model',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
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

  __setFlowResumeTestDepsForTests({
    ensureFlowChildConversationOwnership: async () => ({
      needsExecutionIdBackfill: false,
    }),
  });

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'flow-current-model',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-flow-endpoint-success',
        stepPath: [0],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': childConversationId,
        },
        agentProviders: {
          'coding_agent:resume-test': 'codex',
        },
        agentModels: {
          'coding_agent:resume-test': 'flow-current-model',
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(childConversationId, {
    _id: childConversationId,
    provider: 'codex',
    model: 'flow-saved-model',
    title: 'Flow: resume-basic (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {
      endpointId,
      flowChild: {
        executionId: 'resume-execution-flow-endpoint-success',
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const result = await startFlowRun({
      flowName: 'resume-basic',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new TrackingChat(),
    });

    assert.equal(result.providerId, 'codex');
    assert.equal(result.modelId, 'flow-current-model');
    const executedFlags = await firstExecute;
    assert.equal(capturedFlags.length, 1);
    assert.equal(executedFlags.endpointId, endpointId);
    assert.equal(capturedFlags[0]?.endpointId, endpointId);
  } finally {
    __resetFlowResumeTestDepsForTests();
    __resetAgentServiceDepsForTests();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    await externalServer.stop();
    if (prevAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = prevAgentHome;
    }
    if (prevAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    }
    if (prevCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = prevCodexHome;
    }
    if (prevRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = prevRuntimeCodexHome;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    if (prevCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        prevCompatEndpoints;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
  }
});

test('Task 15 keeps the saved child endpoint record untouched when degraded codex bootstrap forces resumed flow fallback selection', async () => {
  const prevAgentHome = process.env.CODEINFO_AGENT_HOME;
  const prevLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevCodexHome = process.env.CODEINFO_CODEX_HOME;
  const prevRuntimeCodexHome = process.env.CODEX_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const prevCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-endpoint-degraded-'),
  );
  await writeResumeFlow(tmpDir);

  const externalServer = await startExternalOpenAiCompatServer({
    models: ['flow-current-model'],
  });
  const endpointId = `${externalServer.baseUrl}/v1`;
  const childConversationId = 'agent-conv-resume-endpoint-degraded';
  const conversationId = 'flow-resume-endpoint-degraded';

  await writeFlowResumeAgentHome({
    agentsHome,
    codexHome,
    endpointId,
    modelId: 'flow-current-model',
  });

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.FLOWS_DIR = tmpDir;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${endpointId}|responses`;

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'flow-current-model',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
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
  __setFlowResumeTestDepsForTests({
    ensureFlowChildConversationOwnership: async () => ({
      needsExecutionIdBackfill: false,
    }),
  });
  __setProviderBootstrapStatusForTests('codex', {
    healthy: false,
    reason: 'codex bootstrap degraded',
  });

  try {
    await withMockedMongoConversationPersistence({
      seedConversations: [
        {
          _id: conversationId,
          provider: 'codex',
          model: 'flow-current-model',
          title: 'Flow: resume-basic',
          flowName: 'resume-basic',
          source: 'REST',
          flags: {
            requestedProviderId: 'codex',
            flow: {
              executionId: 'resume-execution-endpoint-degraded',
              stepPath: [0],
              loopStack: [],
              agentConversations: {
                'coding_agent:resume-test': childConversationId,
              },
              agentProviders: {
                'coding_agent:resume-test': 'codex',
              },
              agentModels: {
                'coding_agent:resume-test': 'flow-current-model',
              },
              agentRequestedProviders: {
                'coding_agent:resume-test': 'codex',
              },
              agentEndpointIds: {
                'coding_agent:resume-test': endpointId,
              },
              agentThreads: {},
            },
          },
          lastMessageAt: new Date(),
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: childConversationId,
          provider: 'codex',
          model: 'flow-current-model',
          title: 'Flow: resume-basic (resume-test)',
          agentName: 'coding_agent',
          source: 'REST',
          flags: {
            requestedProviderId: 'codex',
            endpointId,
            flowChild: {
              executionId: 'resume-execution-endpoint-degraded',
            },
          },
          lastMessageAt: new Date(),
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Conversation,
      ],
      run: async ({ conversations }) => {
        const result = await startFlowRun({
          flowName: 'resume-basic',
          conversationId,
          resumeStepPath: [0],
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        });

        assert.equal(result.providerId, 'copilot');
        assert.equal(result.modelId, 'flow-current-model');

        assert.equal(
          (
            conversations.get(conversationId)?.flags as
              | { flow?: { agentEndpointIds?: Record<string, string> } }
              | undefined
          )?.flow?.agentEndpointIds?.['coding_agent:resume-test'],
          endpointId,
        );
        assert.equal(conversations.get(childConversationId)?.provider, 'codex');
        assert.equal(
          conversations.get(childConversationId)?.model,
          'flow-current-model',
        );
      },
    });
  } finally {
    __resetFlowResumeTestDepsForTests();
    __resetAgentServiceDepsForTests();
    __resetProviderBootstrapStatusForTests();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    await externalServer.stop();
    if (prevAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = prevAgentHome;
    }
    if (prevLegacyAgentHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevLegacyAgentHome;
    }
    if (prevCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = prevCodexHome;
    }
    if (prevRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = prevRuntimeCodexHome;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    if (prevCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        prevCompatEndpoints;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
  }
});

test('Task 9 rejects stale flow replay before mutating the existing child conversation in memory', async () => {
  const prevAgentHome = process.env.CODEINFO_AGENT_HOME;
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevCodexHome = process.env.CODEINFO_CODEX_HOME;
  const prevRuntimeCodexHome = process.env.CODEX_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const prevCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-stale-memory-'),
  );
  await writeResumeFlow(tmpDir);

  const externalServer = await startExternalOpenAiCompatServer({
    models: ['flow-current-model'],
  });
  const endpointId = `${externalServer.baseUrl}/v1`;
  const childConversationId = 'agent-conv-flow-stale-memory';
  const conversationId = 'flow-conv-flow-stale-memory';

  await writeFlowResumeAgentHome({
    agentsHome,
    codexHome,
    endpointId,
    modelId: 'flow-current-model',
  });

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.FLOWS_DIR = tmpDir;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${endpointId}|responses`;

  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
    }),
    resolveCodexCapabilities: async () => ({
      defaults: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        modelReasoningEffort: 'high',
        networkAccessEnabled: true,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      },
      models: [
        {
          model: 'flow-current-model',
          supportedReasoningEfforts: ['high'],
          defaultReasoningEffort: 'high',
        },
      ],
      byModel: new Map(),
      warnings: [],
      fallbackUsed: false,
    }),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      reason: undefined,
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

  __setFlowResumeTestDepsForTests({
    ensureFlowChildConversationOwnership: async () => {
      throw new Error('stale replay rejected before child mutation');
    },
  });

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'flow-current-model',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-flow-stale-memory',
        stepPath: [0],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': childConversationId,
        },
        agentProviders: {
          'coding_agent:resume-test': 'codex',
        },
        agentModels: {
          'coding_agent:resume-test': 'flow-current-model',
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(childConversationId, {
    _id: childConversationId,
    provider: 'codex',
    model: 'flow-saved-model',
    title: 'Flow: resume-basic (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {
      endpointId,
      flowChild: {
        executionId: 'resume-execution-flow-stale-memory',
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const beforeChild = snapshotFlowChildConversation(
    memoryConversations.get(childConversationId),
  );

  try {
    await assert.rejects(
      () =>
        startFlowRun({
          flowName: 'resume-basic',
          conversationId,
          resumeStepPath: [0],
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) => {
        assert.equal(
          (error as { message?: string }).message,
          'stale replay rejected before child mutation',
        );
        return true;
      },
    );

    assert.deepEqual(
      snapshotFlowChildConversation(
        memoryConversations.get(childConversationId),
      ),
      beforeChild,
    );
  } finally {
    __resetFlowResumeTestDepsForTests();
    __resetAgentServiceDepsForTests();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    await externalServer.stop();
    if (prevAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = prevAgentHome;
    }
    if (prevAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    }
    if (prevCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = prevCodexHome;
    }
    if (prevRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = prevRuntimeCodexHome;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    if (prevCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        prevCompatEndpoints;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
  }
});

test('Task 9 rejects stale flow replay before mutating the existing child conversation in Mongo', async () => {
  const prevAgentHome = process.env.CODEINFO_AGENT_HOME;
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevCodexHome = process.env.CODEINFO_CODEX_HOME;
  const prevRuntimeCodexHome = process.env.CODEX_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const prevCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const agentsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-stale-mongo-'),
  );
  await writeResumeFlow(tmpDir);

  const externalServer = await startExternalOpenAiCompatServer({
    models: ['flow-current-model'],
  });
  const endpointId = `${externalServer.baseUrl}/v1`;
  const childConversationId = 'agent-conv-flow-stale-mongo';
  const conversationId = 'flow-conv-flow-stale-mongo';

  await writeFlowResumeAgentHome({
    agentsHome,
    codexHome,
    endpointId,
    modelId: 'flow-current-model',
  });

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.FLOWS_DIR = tmpDir;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = `${endpointId}|responses`;

  __setFlowResumeTestDepsForTests({
    ensureFlowChildConversationOwnership: async () => {
      throw new Error('stale replay rejected before child mutation');
    },
  });

  const seededFlowConversation: Conversation = {
    _id: conversationId,
    provider: 'codex',
    model: 'flow-current-model',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-flow-stale-mongo',
        stepPath: [0],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': childConversationId,
        },
        agentProviders: {
          'coding_agent:resume-test': 'codex',
        },
        agentModels: {
          'coding_agent:resume-test': 'flow-current-model',
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const seededChildConversation: Conversation = {
    _id: childConversationId,
    provider: 'codex',
    model: 'flow-saved-model',
    title: 'Flow: resume-basic (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {
      endpointId,
      flowChild: {
        executionId: 'resume-execution-flow-stale-mongo',
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const beforeChild = snapshotFlowChildConversation(seededChildConversation);

  try {
    await withMockedMongoConversationPersistence({
      seedConversations: [seededFlowConversation, seededChildConversation],
      run: async ({ conversations }) => {
        await assert.rejects(
          () =>
            startFlowRun({
              flowName: 'resume-basic',
              conversationId,
              resumeStepPath: [0],
              source: 'REST',
              chatFactory: () => new MinimalChat(),
            }),
          (error: unknown) => {
            assert.equal(
              (error as { message?: string }).message,
              'stale replay rejected before child mutation',
            );
            return true;
          },
        );

        assert.deepEqual(
          snapshotFlowChildConversation(conversations.get(childConversationId)),
          beforeChild,
        );
      },
    });
  } finally {
    __resetFlowResumeTestDepsForTests();
    await externalServer.stop();
    if (prevAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = prevAgentHome;
    }
    if (prevAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    }
    if (prevCodexHome === undefined) {
      delete process.env.CODEINFO_CODEX_HOME;
    } else {
      process.env.CODEINFO_CODEX_HOME = prevCodexHome;
    }
    if (prevRuntimeCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = prevRuntimeCodexHome;
    }
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    if (prevCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        prevCompatEndpoints;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(agentsHome, { recursive: true, force: true });
    await fs.rm(codexHome, { recursive: true, force: true });
  }
});

test('startFlowRun derives resumed runtime identity from the remaining step set instead of the first flow step', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-remaining-identity-'),
  );
  await writeDualAgentResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-remaining-identity-1';
  const childConversationId = 'agent-conv-resume-remaining-plan-1';

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.4',
    title: 'Flow: resume-dual-identity',
    flowName: 'resume-dual-identity',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-remaining-identity-1',
        stepPath: [0],
        loopStack: [],
        agentConversations: {
          'planning_agent:resume-plan': childConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(childConversationId, {
    _id: childConversationId,
    provider: 'codex',
    model: 'gpt-4.1',
    title: 'Flow: resume-dual-identity (resume-plan)',
    agentName: 'planning_agent',
    source: 'REST',
    flags: {
      flowChild: {
        executionId: 'resume-execution-remaining-identity-1',
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const result = await startFlowRun({
      flowName: 'resume-dual-identity',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    assert.equal(result.conversationId, conversationId);
    assert.equal(
      memoryConversations.get(conversationId)?.flowName,
      'resume-dual-identity',
    );
    assert.equal(
      memoryConversations.get(childConversationId)?.agentName,
      'planning_agent',
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun ignores stale fresh-run retry ownership while resuming a flow', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-requested-provider-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-requested-provider';
  const childConversationId = 'agent-resume-requested-provider';
  const executionId = 'resume-execution-requested-provider';

  try {
    const freshRetryResult = await startFlowRun({
      flowName: 'resume-basic',
      conversationId: 'fresh-retry-resume-1',
      source: 'REST',
      retryOwnershipId: 'fresh-run-retry-1',
      chatFactory: () => new MinimalChat(),
    });

    const seededFlowConversation: Conversation = {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.2-codex',
      title: 'Flow: resume-basic',
      flowName: 'resume-basic',
      source: 'REST',
      flags: {
        flow: {
          executionId,
          stepPath: [],
          loopStack: [],
          agentConversations: {
            'coding_agent:resume-test': childConversationId,
          },
          agentThreads: {},
        },
      },
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const seededChildConversation: Conversation = {
      _id: childConversationId,
      provider: 'codex',
      model: 'gpt-5.2-codex',
      title: 'Flow: resume-basic (resume-test)',
      agentName: 'coding_agent',
      source: 'REST',
      flags: {
        requestedProviderId: 'copilot',
        flowChild: {
          executionId,
        },
      },
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await withMockedMongoConversationPersistence({
      seedConversations: [seededFlowConversation, seededChildConversation],
      run: async ({ conversations, turns }) => {
        const resumedResult = await startFlowRun({
          flowName: 'resume-basic',
          conversationId,
          resumeStepPath: [0],
          source: 'REST',
          retryOwnershipId: 'fresh-run-retry-1',
          chatFactory: () => new MinimalChat(),
        });

        await waitFor(
          () => turns.length >= 2,
          5000,
          50,
          () =>
            JSON.stringify({
              phase: 'waiting_for_resumed_turns',
              turns: turns.map((turn) => ({
                role: turn.role,
                status: turn.status,
                content: turn.content,
                conversationId: turn.conversationId,
              })),
              parentState: JSON.parse(describeConversationState(conversationId)),
              childState: JSON.parse(
                describeConversationState(childConversationId),
              ),
              runtimeLogs: JSON.parse(
                describeRelevantResumeRuntimeLogs(conversationId),
              ),
            }),
        );
        assert.equal(resumedResult.conversationId, conversationId);
        assert.notEqual(
          resumedResult.conversationId,
          freshRetryResult.conversationId,
        );

        const flowConversation = conversations.get(conversationId);
        const flowFlags = (flowConversation?.flags ?? {}) as {
          flow?: { agentRequestedProviders?: Record<string, string> };
        };
        assert.equal(
          flowFlags.flow?.agentRequestedProviders?.['coding_agent:resume-test'],
          'copilot',
        );
        assert.equal(
          conversations.get(childConversationId)?.flags?.requestedProviderId,
          'copilot',
        );
      },
    });
  } finally {
    memoryConversations.delete('fresh-retry-resume-1');
    memoryTurns.delete('fresh-retry-resume-1');
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun keeps the parent requestedProviderId authoritative over weaker child history when resuming a flow', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-parent-requested-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-parent-requested';
  const childConversationId = 'agent-conv-resume-parent-requested';

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      requestedProviderId: 'codex',
      flow: {
        executionId: 'resume-execution-parent-requested',
        stepPath: [0],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': childConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(childConversationId, {
    _id: childConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {
      requestedProviderId: 'copilot',
      flowChild: {
        executionId: 'resume-execution-parent-requested',
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const result = await startFlowRun({
      flowName: 'resume-basic',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    assert.equal(result.conversationId, conversationId);
    await waitFor(() => {
      const conversation = memoryConversations.get(conversationId);
      const flowFlags = (conversation?.flags ?? {}) as {
        flow?: { agentRequestedProviders?: Record<string, string> };
      };
      return (
        flowFlags.flow?.agentRequestedProviders?.[
          'coding_agent:resume-test'
        ] === 'codex'
      );
    });
    const conversation = memoryConversations.get(conversationId);
    const flowFlags = (conversation?.flags ?? {}) as {
      flow?: { agentRequestedProviders?: Record<string, string> };
    };
    assert.equal(
      flowFlags.flow?.agentRequestedProviders?.['coding_agent:resume-test'],
      'codex',
    );
    assert.equal(conversation?.flags?.requestedProviderId, 'codex');
    assert.equal(
      memoryConversations.get(childConversationId)?.flags?.requestedProviderId,
      'copilot',
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(childConversationId);
    memoryTurns.delete(childConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun ignores stale parent flow metadata on an ordinary conversation without flow ownership', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-stale-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'ordinary-conv-with-stale-flow';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Ordinary conversation',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'smuggled-resume-execution-1',
        stepPath: [0],
        loopStack: [],
        agentConversations: {},
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await assert.rejects(
      () =>
        startFlowRun({
          flowName: 'resume-basic',
          conversationId,
          resumeStepPath: [0],
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) => {
        assert.deepEqual(error, {
          code: 'INVALID_REQUEST',
          reason: 'resumeStepPath requires saved flow state',
        });
        return true;
      },
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run rejects invalid resumeStepPath', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-invalid-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  const { app, supertest } = buildApp();

  try {
    const res = await supertest(app)
      .post('/flows/resume-basic/run')
      .send({ resumeStepPath: [99] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('paused wait resumes the same execution after the authored delay using an explicit wake boundary', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-wait-resume-identity-'),
  );
  await writeWaitResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-wait-resume-identity';
  const captured: string[] = [];
  let wake: (() => void) | null = null;

  class TrackingChat extends ChatInterface {
    async execute(
      message: string,
      _flags: Record<string, unknown>,
      childConversationId: string,
      _model: string,
    ) {
      void _flags;
      void _model;
      captured.push(message);
      this.emit('thread', { type: 'thread', threadId: childConversationId });
      this.emit('final', { type: 'final', content: 'ok' });
      this.emit('complete', {
        type: 'complete',
        threadId: childConversationId,
      });
    }
  }

  __setFlowWaitResumeDepsForTests({
    now: () => 1_700_000_000_000,
    scheduleWake: ({ onWake }) => {
      wake = onWake;
      return { cancel: () => {} };
    },
  });

  try {
    const result = await startFlowRun({
      flowName: 'wait-resume',
      conversationId,
      source: 'REST',
      chatFactory: () => new TrackingChat(),
    });

    assert.equal(result.conversationId, conversationId);
    await waitFor(() => captured.length === 1);

    const executionId = getFlowExecutionId(conversationId);
    const flags = (memoryConversations.get(conversationId)?.flags ?? {}) as {
      flow?: { wait?: { stepPath?: number[]; resumeAt?: number } };
    };
    assert.deepEqual(flags.flow?.wait?.stepPath, [1]);
    assert.equal(flags.flow?.wait?.resumeAt, 1_700_000_060_000);
    assert.ok(wake, 'expected wait wake callback to be captured');

    (wake as () => void)();
    await waitFor(
      () => getAssistantTurnCount(conversationId) >= 2,
      10000,
      50,
      () => describeConversationState(conversationId),
    );

    assert.equal(getFlowExecutionId(conversationId), executionId);
    assert.equal(
      (
        (memoryConversations.get(conversationId)?.flags ?? {}) as {
          flow?: { wait?: unknown };
        }
      ).flow?.wait,
      undefined,
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('cancelled wait does not emit a later resume side effect when the persisted wait state is cleared before wake', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-wait-resume-cancel-'),
  );
  await writeWaitResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-wait-resume-cancel';
  const captured: string[] = [];
  let wake: (() => Promise<void>) | null = null;

  class TrackingChat extends ChatInterface {
    async execute(
      message: string,
      _flags: Record<string, unknown>,
      childConversationId: string,
      _model: string,
    ) {
      void _flags;
      void _model;
      captured.push(message);
      this.emit('thread', { type: 'thread', threadId: childConversationId });
      this.emit('final', { type: 'final', content: 'ok' });
      this.emit('complete', {
        type: 'complete',
        threadId: childConversationId,
      });
    }
  }

  __setFlowWaitResumeDepsForTests({
    scheduleWake: ({ onWake }) => {
      wake = async () => {
        onWake();
        await flushWakeBoundary();
      };
      return { cancel: () => {} };
    },
  });

  try {
    await startFlowRun({
      flowName: 'wait-resume',
      conversationId,
      source: 'REST',
      chatFactory: () => new TrackingChat(),
    });

    await waitFor(() => captured.length === 1);
    const conversation = memoryConversations.get(conversationId);
    assert.ok(conversation);
    memoryConversations.set(conversationId, {
      ...conversation,
      flags: {
        ...(conversation.flags ?? {}),
        flow: {
          ...(((conversation.flags ?? {}) as { flow?: Record<string, unknown> })
            .flow ?? {}),
          wait: undefined,
        },
      },
      updatedAt: new Date(),
    });

    const wakeCallback = wake;
    if (!wakeCallback) {
      throw new Error('expected wait wake callback to be captured');
    }
    await (wakeCallback as () => Promise<void>)();
    assert.equal(captured.length, 1);
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('paused repository-backed waits keep the original sourceId and retryOwnershipId barrier while excluding a conflicting fresh sourceId on resume', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-wait-resume-sourceid-'),
  );
  const sourceRepo = path.join(tmpDir, 'repo-source');
  await fs.mkdir(path.join(sourceRepo, 'flows'), { recursive: true });
  await writeWaitResumeFlow(path.join(sourceRepo, 'flows'));

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  delete process.env.FLOWS_DIR;

  const conversationId = 'flow-wait-resume-sourceid';
  const captured: string[] = [];

  class TrackingChat extends ChatInterface {
    async execute(
      message: string,
      _flags: Record<string, unknown>,
      childConversationId: string,
      _model: string,
    ) {
      void _flags;
      void _model;
      captured.push(message);
      this.emit('thread', { type: 'thread', threadId: childConversationId });
      this.emit('final', { type: 'final', content: 'ok' });
      this.emit('complete', {
        type: 'complete',
        threadId: childConversationId,
      });
    }
  }

  __setFlowWaitResumeDepsForTests({
    now: () => 1_700_000_000_000,
    scheduleWake: () => ({ cancel: () => {} }),
  });

  try {
    const firstStart = await startFlowRun({
      flowName: 'wait-resume',
      conversationId,
      sourceId: sourceRepo,
      working_folder: sourceRepo,
      retryOwnershipId: 'paused-retry-1',
      source: 'REST',
      chatFactory: () => new TrackingChat(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(sourceRepo)],
        lockedModelId: null,
      }),
    });

    await waitFor(() => captured.length === 1, 10000, 50, () =>
      JSON.stringify({
        phase: 'waiting_for_first_execute',
        captured,
        state: JSON.parse(describeConversationState(conversationId)),
        runtimeLogs: JSON.parse(describeRelevantResumeRuntimeLogs(conversationId)),
      }),
    );
    const executionId = getFlowExecutionId(conversationId);
    await waitFor(
      () => {
        const flags = (memoryConversations.get(conversationId)?.flags ?? {}) as {
          flow?: { wait?: { sourceId?: string; stepPath?: number[] } };
        };
        return (
          flags.flow?.wait?.sourceId === sourceRepo &&
          Array.isArray(flags.flow?.wait?.stepPath) &&
          flags.flow?.wait?.stepPath?.[0] === 1
        );
      },
      10000,
      50,
      () =>
        JSON.stringify({
          phase: 'waiting_for_wait_state',
          captured,
          state: JSON.parse(describeConversationState(conversationId)),
          runtimeLogs: JSON.parse(
            describeRelevantResumeRuntimeLogs(conversationId),
          ),
        }),
    );
    await waitFor(
      () => getActiveRunOwnership(conversationId) === null,
      10000,
      50,
      () =>
        JSON.stringify({
          phase: 'waiting_for_unlock',
          captured,
          state: JSON.parse(describeConversationState(conversationId)),
          runtimeLogs: JSON.parse(
            describeRelevantResumeRuntimeLogs(conversationId),
          ),
        }),
    );

    const replayedStart = await startFlowRun({
      flowName: 'wait-resume',
      sourceId: sourceRepo,
      working_folder: sourceRepo,
      retryOwnershipId: 'paused-retry-1',
      source: 'REST',
      chatFactory: () => new TrackingChat(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(sourceRepo)],
        lockedModelId: null,
      }),
    });

    assert.equal(replayedStart.conversationId, firstStart.conversationId);
    assert.equal(replayedStart.inflightId, firstStart.inflightId);
    assert.equal(captured.length, 1);

    await startFlowRun({
      flowName: 'wait-resume',
      conversationId,
      resumeStepPath: [1],
      sourceId: '/data/conflicting-source',
      working_folder: sourceRepo,
      source: 'REST',
      chatFactory: () => new TrackingChat(),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(sourceRepo)],
        lockedModelId: null,
      }),
    });

    await waitFor(
      () => getAssistantTurnCount(conversationId) >= 2,
      10000,
      50,
      () =>
        JSON.stringify({
          phase: 'waiting_for_resume_terminal',
          captured,
          state: JSON.parse(describeConversationState(conversationId)),
          runtimeLogs: JSON.parse(
            describeRelevantResumeRuntimeLogs(conversationId),
          ),
        }),
    );
    assert.equal(getFlowExecutionId(conversationId), executionId);
    assert.equal(
      (
        (memoryConversations.get(conversationId)?.flags ?? {}) as {
          flow?: { wait?: unknown };
        }
      ).flow?.wait,
      undefined,
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run rejects agent mismatch', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-mismatch-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  const { app, supertest } = buildApp();

  const flowConversationId = 'flow-resume-conv-2';
  const agentConversationId = 'agent-conv-1';
  memoryConversations.set(flowConversationId, {
    _id: flowConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-2',
        stepPath: [0],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': agentConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(agentConversationId, {
    _id: agentConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Agent: mismatch',
    agentName: 'planning_agent',
    source: 'REST',
    flags: {},
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const res = await supertest(app)
      .post('/flows/resume-basic/run')
      .send({ conversationId: flowConversationId, resumeStepPath: [0] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'agent_mismatch');
  } finally {
    memoryConversations.delete(flowConversationId);
    memoryConversations.delete(agentConversationId);
    memoryTurns.delete(flowConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run rejects conflicting child execution marker', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-child-conflict-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  const { app, supertest } = buildApp();

  const flowConversationId = 'flow-resume-conv-child-conflict';
  const agentConversationId = 'agent-conv-child-conflict';
  memoryConversations.set(flowConversationId, {
    _id: flowConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-parent-1',
        stepPath: [0],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': agentConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(agentConversationId, {
    _id: agentConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Agent: conflicting-child',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {
      flowChild: {
        executionId: 'other-execution',
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const res = await supertest(app)
      .post('/flows/resume-basic/run')
      .send({ conversationId: flowConversationId, resumeStepPath: [0] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  } finally {
    memoryConversations.delete(flowConversationId);
    memoryConversations.delete(agentConversationId);
    memoryTurns.delete(flowConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run rejects missing child conversation mapping', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-child-missing-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  const { app, supertest } = buildApp();

  const flowConversationId = 'flow-resume-conv-child-missing';
  memoryConversations.set(flowConversationId, {
    _id: flowConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-parent-missing',
        stepPath: [0],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': 'missing-child-conversation',
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const res = await supertest(app)
      .post('/flows/resume-basic/run')
      .send({ conversationId: flowConversationId, resumeStepPath: [0] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  } finally {
    memoryConversations.delete(flowConversationId);
    memoryTurns.delete(flowConversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
