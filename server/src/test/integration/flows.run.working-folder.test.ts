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
import { query, resetStore } from '../../logStore.js';
import { createConversationsRouter } from '../../routes/conversations.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';

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

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

test('POST /flows/:flowName/run validates working_folder', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-'),
  );
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
        }),
    }),
  );

  try {
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

test('a stale saved path is cleared before a flow restore uses it', async () => {
  resetStore();
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-restore-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  memoryConversations.set('flow-stale-restore', {
    _id: 'flow-stale-restore',
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
  app.use(express.json());
  app.use(createConversationsRouter());

  try {
    const res = await supertest(app).get('/conversations?flowName=llm-basic');
    assert.equal(res.status, 200);
    assert.equal(res.body.items[0].flags.workingFolder, undefined);
    assert.equal(
      memoryConversations.get('flow-stale-restore')?.flags?.workingFolder,
      undefined,
    );
  } finally {
    memoryConversations.delete('flow-stale-restore');
    memoryTurns.delete('flow-stale-restore');
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('a stale saved path is cleared before a flow run reuses it', async () => {
  resetStore();
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-rerun-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
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
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
        }),
    }),
  );

  try {
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId: 'flow-stale-rerun' });
    assert.equal(res.status, 202);
    assert.equal(
      memoryConversations.get('flow-stale-rerun')?.flags?.workingFolder,
      undefined,
    );
  } finally {
    memoryConversations.delete('flow-stale-rerun');
    memoryTurns.delete('flow-stale-rerun');
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('stale flow working-folder clear logs stale path, record type, and conversation id', async () => {
  resetStore();
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-workdir-log-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
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
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
        }),
    }),
  );

  try {
    await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId: 'flow-stale-log' })
      .expect(202);

    const marker = query({
      text: 'DEV_0000048_T5_WORKING_FOLDER_ROUTE_DECISION',
      level: ['warn'],
    }).find((entry) => entry.context?.conversationId === 'flow-stale-log');
    assert.ok(marker);
    assert.equal(marker?.context?.recordType, 'flow');
    assert.equal(marker?.context?.stalePath, '/definitely/missing/path');
  } finally {
    memoryConversations.delete('flow-stale-log');
    memoryTurns.delete('flow-stale-log');
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('a flow-created child agent conversation inherits the exact flow-step folder', async () => {
  resetStore();
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
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
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

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

  try {
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({
        conversationId: 'flow-child-working-folder',
        working_folder: workingFolder,
      })
      .expect(202);

    assert.equal(res.body.status, 'started');

    let childConversationId: string | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      childConversationId = (
        memoryConversations.get('flow-child-working-folder')?.flags?.flow as
          | { agentConversations?: Record<string, string> }
          | undefined
      )?.agentConversations?.['coding_agent:basic'];
      if (childConversationId) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.ok(childConversationId);
    assert.equal(
      memoryConversations.get(childConversationId!)?.flags?.workingFolder,
      workingFolder,
    );
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
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
