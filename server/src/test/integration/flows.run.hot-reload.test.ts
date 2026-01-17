import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { startFlowRun } from '../../flows/service.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

class CapturingChat extends ChatInterface {
  constructor(private readonly onMessage: (message: string) => void) {
    super();
  }

  async execute(
    message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.onMessage(message);
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
};

test('Flow run reloads flow file between runs', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-reload-'),
  );
  await fs.cp(fixturesDir, tmpDir, { recursive: true });
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const observedMessages: string[] = [];
  let nextMessageResolver: (() => void) | null = null;

  const chatFactory = () =>
    new CapturingChat((message) => {
      observedMessages.push(message);
      if (nextMessageResolver) nextMessageResolver();
    });

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory,
        }),
    }),
  );

  try {
    nextMessageResolver = null;
    const firstMessagePromise = new Promise<void>((resolve) => {
      nextMessageResolver = resolve;
    });

    await supertest(app).post('/flows/hot-reload/run').send({});
    await firstMessagePromise;
    await waitFor(() => observedMessages.length >= 1);
    assert.equal(observedMessages[0], 'First run');

    const updatedFlow = {
      description: 'Hot reload flow',
      steps: [
        {
          type: 'llm',
          agentType: 'coding_agent',
          identifier: 'reload',
          messages: [{ role: 'user', content: ['Updated run'] }],
        },
      ],
    };
    await fs.writeFile(
      path.join(tmpDir, 'hot-reload.json'),
      JSON.stringify(updatedFlow, null, 2),
      'utf8',
    );

    nextMessageResolver = null;
    const secondMessagePromise = new Promise<void>((resolve) => {
      nextMessageResolver = resolve;
    });
    await supertest(app).post('/flows/hot-reload/run').send({});
    await secondMessagePromise;
    await waitFor(() => observedMessages.length >= 2);
    assert.equal(observedMessages[1], 'Updated run');
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
