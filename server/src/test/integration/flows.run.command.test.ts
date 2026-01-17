import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';
import type WebSocket from 'ws';

import { loadAgentCommandFile } from '../../agents/commandsLoader.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import type { Turn } from '../../mongo/turn.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ScriptedChat extends ChatInterface {
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

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);
const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

const withFlowServer = async (
  task: (params: {
    baseUrl: string;
    wsUrl: WebSocket;
    tmpDir: string;
  }) => Promise<void>,
) => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-cmd-'));
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new ScriptedChat(),
        }),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ws = await connectWs({ baseUrl });

  try {
    await task({ baseUrl, wsUrl: ws, tmpDir });
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

const waitForTurns = async (
  conversationId: string,
  predicate: (turns: Turn[]) => boolean,
  timeoutMs = 2000,
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const turns = memoryTurns.get(conversationId) ?? [];
    if (predicate(turns)) return turns;
    await delay(20);
  }
  throw new Error('Timed out waiting for flow turns');
};

test('command steps execute agent command items', async () => {
  const commandPath = path.join(
    repoRoot,
    'codex_agents',
    'planning_agent',
    'commands',
    'improve_plan.json',
  );
  const command = await loadAgentCommandFile({ filePath: commandPath });
  assert.equal(command.ok, true);
  const totalItems = command.ok ? command.command.items.length : 0;

  await withFlowServer(async ({ baseUrl, wsUrl }) => {
    const conversationId = 'flow-command-conv-1';
    sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

    await supertest(baseUrl)
      .post('/flows/command-step/run')
      .send({ conversationId })
      .expect(202);

    const final = await waitForEvent({
      ws: wsUrl,
      predicate: (
        event: unknown,
      ): event is { type: 'turn_final'; status: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return (
          e.type === 'turn_final' &&
          e.conversationId === conversationId &&
          e.status === 'ok'
        );
      },
      timeoutMs: 4000,
    });

    assert.equal(final.status, 'ok');

    const turns = await waitForTurns(
      conversationId,
      (items) =>
        items.filter((turn) => turn.role === 'assistant').length === totalItems,
      4000,
    );

    const userTurns = turns.filter((turn) => turn.role === 'user');
    const assistantTurns = turns.filter((turn) => turn.role === 'assistant');
    assert.equal(userTurns.length, totalItems);
    assert.equal(assistantTurns.length, totalItems);

    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
});

test('invalid command steps return 400 invalid_request', async () => {
  await withFlowServer(async ({ baseUrl, tmpDir }) => {
    const invalidFlow = {
      description: 'Invalid command flow',
      steps: [
        {
          type: 'command',
          agentType: 'planning_agent',
          identifier: 'missing-command',
          commandName: 'missing_command',
        },
      ],
    };
    await fs.writeFile(
      path.join(tmpDir, 'command-missing.json'),
      JSON.stringify(invalidFlow, null, 2),
    );

    const res = await supertest(baseUrl)
      .post('/flows/command-missing/run')
      .send({})
      .expect(400);

    assert.equal(res.body.error, 'invalid_request');
  });
});
