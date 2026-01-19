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

test('startFlowRun resumes after resumeStepPath', async () => {
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
    title: 'Flow: resume-basic',
    flowName: 'resume-basic',
    source: 'REST',
    flags: {
      flow: {
        stepPath: [0],
        loopStack: [{ loopStepPath: [0], iteration: 1 }],
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
    await startFlowRun({
      flowName: 'resume-basic',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new TrackingChat(),
    });

    await waitFor(() => captured.length === 1);
    assert.equal(captured[0], 'Step 2');
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
