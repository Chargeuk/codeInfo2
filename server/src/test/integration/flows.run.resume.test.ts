import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
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

const writeResumeDualAgentFlow = async (dir: string) => {
  const flow = {
    description: 'Resume dual-agent test flow',
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
        identifier: 'resume-test-2',
        messages: [{ role: 'user', content: ['Step 2'] }],
      },
    ],
  };
  await fs.writeFile(
    path.join(dir, 'resume-dual-agent.json'),
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
  return app;
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
  const app = buildApp();

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
  const app = buildApp();

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

test('startFlowRun backfills legacy executionId on resume', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-backfill-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-conv-legacy';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        stepPath: [],
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
    const result = await startFlowRun({
      flowName: 'resume-basic',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    assert.equal(result.conversationId, conversationId);
    await waitFor(
      () => (memoryTurns.get(conversationId) ?? []).length >= 2,
      5000,
    );

    const conversation = memoryConversations.get(conversationId);
    const flags = (conversation?.flags ?? {}) as {
      flow?: { executionId?: string };
    };

    assert.equal(typeof flags.flow?.executionId, 'string');
  } finally {
    const conversation = memoryConversations.get(conversationId);
    const flags = (conversation?.flags ?? {}) as {
      flow?: { agentConversations?: Record<string, string> };
    };
    const childConversationIds = Object.values(
      flags.flow?.agentConversations ?? {},
    );
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    childConversationIds.forEach((childConversationId) => {
      memoryConversations.delete(childConversationId);
      memoryTurns.delete(childConversationId);
    });
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('startFlowRun backfills legacy child executionId on resume', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-child-backfill-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-conv-child-legacy';
  const childConversationId = 'agent-resume-conv-child-legacy';
  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        executionId: 'resume-execution-child-legacy',
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
  });
  memoryConversations.set(childConversationId, {
    _id: childConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-basic (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {},
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
      chatFactory: () => new MinimalChat(),
    });

    await waitFor(
      () => (memoryTurns.get(conversationId) ?? []).length >= 2,
      5000,
    );
    assert.equal(
      getFlowChildExecutionId(childConversationId),
      'resume-execution-child-legacy',
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

test('startFlowRun persists legacy parent executionId before child backfill validation failures', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-parent-backfill-order-'),
  );
  await writeResumeDualAgentFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const conversationId = 'flow-resume-conv-parent-backfill-order';
  const firstChildConversationId = 'agent-resume-conv-parent-backfill-first';
  const secondChildConversationId = 'agent-resume-conv-parent-backfill-second';

  memoryConversations.set(conversationId, {
    _id: conversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-dual-agent',
    flowName: 'resume-dual-agent',
    source: 'REST',
    flags: {
      flow: {
        stepPath: [],
        loopStack: [],
        agentConversations: {
          'coding_agent:resume-test': firstChildConversationId,
          'coding_agent:resume-test-2': secondChildConversationId,
        },
        agentThreads: {},
      },
    },
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(firstChildConversationId, {
    _id: firstChildConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-dual-agent (resume-test)',
    agentName: 'coding_agent',
    source: 'REST',
    flags: {},
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryConversations.set(secondChildConversationId, {
    _id: secondChildConversationId,
    provider: 'codex',
    model: 'gpt-5.2-codex',
    title: 'Flow: resume-dual-agent (resume-test-2)',
    agentName: 'planning_agent',
    source: 'REST',
    flags: {},
    lastMessageAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await assert.rejects(
      () =>
        startFlowRun({
          flowName: 'resume-dual-agent',
          conversationId,
          resumeStepPath: [0],
          source: 'REST',
          chatFactory: () => new MinimalChat(),
        }),
      (error: unknown) => {
        assert.equal((error as { code?: string })?.code, 'AGENT_MISMATCH');
        return true;
      },
    );

    const backfilledExecutionId = getFlowExecutionId(conversationId);
    assert.equal(
      getFlowChildExecutionId(firstChildConversationId),
      backfilledExecutionId,
    );

    memoryConversations.set(secondChildConversationId, {
      ...(memoryConversations.get(secondChildConversationId) ?? {
        _id: secondChildConversationId,
      }),
      provider: 'codex',
      model: 'gpt-5.2-codex',
      title: 'Flow: resume-dual-agent (resume-test-2)',
      agentName: 'coding_agent',
      source: 'REST',
      flags: {},
      lastMessageAt: new Date(),
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await startFlowRun({
      flowName: 'resume-dual-agent',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    await waitFor(
      () => (memoryTurns.get(conversationId) ?? []).length >= 2,
      5000,
    );
    assert.equal(getFlowExecutionId(conversationId), backfilledExecutionId);
    assert.equal(
      getFlowChildExecutionId(firstChildConversationId),
      backfilledExecutionId,
    );
    assert.equal(
      getFlowChildExecutionId(secondChildConversationId),
      backfilledExecutionId,
    );
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    memoryConversations.delete(firstChildConversationId);
    memoryTurns.delete(firstChildConversationId);
    memoryConversations.delete(secondChildConversationId);
    memoryTurns.delete(secondChildConversationId);
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
  const app = buildApp();

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
  const app = buildApp();

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

test('fresh start reuses the same agent slot inside one execution', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-resume-same-slot-'),
  );
  await writeResumeFlow(tmpDir);

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  let conversationId: string | undefined;
  try {
    const result = await startFlowRun({
      flowName: 'resume-basic',
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });
    conversationId = result.conversationId;
    assert.ok(conversationId);
    const runConversationId = conversationId;
    await waitFor(
      () => (memoryTurns.get(runConversationId) ?? []).length >= 4,
      5000,
    );

    const conversation = memoryConversations.get(runConversationId);
    const flags = (conversation?.flags ?? {}) as {
      flow?: {
        executionId?: string;
        agentConversations?: Record<string, string>;
      };
    };

    assert.equal(typeof flags.flow?.executionId, 'string');
    assert.deepEqual(Object.keys(flags.flow?.agentConversations ?? {}), [
      'coding_agent:resume-test',
    ]);
    assert.equal(
      typeof flags.flow?.agentConversations?.['coding_agent:resume-test'],
      'string',
    );
  } finally {
    const conversation = conversationId
      ? memoryConversations.get(conversationId)
      : undefined;
    const flags = (conversation?.flags ?? {}) as {
      flow?: { agentConversations?: Record<string, string> };
    };
    const childConversationIds = Object.values(
      flags.flow?.agentConversations ?? {},
    );
    if (conversationId) {
      memoryConversations.delete(conversationId);
      memoryTurns.delete(conversationId);
    }
    childConversationIds.forEach((childConversationId) => {
      memoryConversations.delete(childConversationId);
      memoryTurns.delete(childConversationId);
    });
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
