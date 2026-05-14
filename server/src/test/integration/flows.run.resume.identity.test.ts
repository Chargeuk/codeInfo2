import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';

beforeEach(() => {
  installDeterministicCodexAvailabilityBootstrap();
});

afterEach(() => {
  resetDeterministicCodexAvailabilityBootstrap();
});

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for predicate');
};

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

    await waitFor(() => captured.length === 1);
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

    await waitFor(() => capturedModels.length === 1);
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
