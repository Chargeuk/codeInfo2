import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';

import { getInflight } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __resetMarkdownFileResolverDepsForTests,
  __setMarkdownFileResolverDepsForTests,
} from '../../flows/markdownFileResolver.js';
import { startFlowRun } from '../../flows/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import type { TurnSummary } from '../../mongo/repo.js';
import { createConversationsRouter } from '../../routes/conversations.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';
import { createIsolatedProviderHomeEnv } from '../support/providerHomeHarness.js';
import { enterTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import { bindCurrentTestOverrides } from '../support/testOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2000,
  describe?: () => string,
): Promise<void> {
  const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
  const deadline = Date.now() + resolvedTimeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(20);
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
      command: turn.command,
      runtime: turn.runtime,
    })),
  });

let providerHomes: Awaited<
  ReturnType<typeof createIsolatedProviderHomeEnv>
> | null = null;

beforeEach(async () => {
  providerHomes = await createIsolatedProviderHomeEnv(
    'flow-turn-metadata-provider-homes-',
  );
  installDeterministicCodexAvailabilityBootstrap();
  enterTestEnvOverrides(providerHomes.envOverrides);
});

afterEach(async () => {
  resetDeterministicCodexAvailabilityBootstrap();
  await providerHomes?.cleanup();
  providerHomes = null;
});

class SlowChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _flags;
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('token', { type: 'token', content: 'Hi' });
    await delay(1500);
    this.emit('final', { type: 'final', content: 'Hello flow' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const listTurnsFromMemory = (conversationId: string): TurnSummary[] => {
  const turns = memoryTurns.get(conversationId) ?? [];
  return turns.map((turn, index) => ({
    turnId: (() => {
      const stored = (turn as { turnId?: unknown }).turnId;
      return typeof stored === 'string' && stored.length > 0
        ? stored
        : String(index);
    })(),
    conversationId: turn.conversationId,
    role: turn.role,
    content: turn.content,
    model: turn.model,
    provider: turn.provider,
    source: turn.source ?? 'REST',
    toolCalls: turn.toolCalls ?? null,
    status: turn.status,
    command: turn.command,
    usage: turn.usage,
    timing: turn.timing,
    runtime: turn.runtime,
    createdAt: turn.createdAt ?? new Date(),
  }));
};

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

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

test('flow turns include command metadata in snapshots and history', async () => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-meta-'));

  const flow = {
    description: 'Metadata flow',
    steps: [
      {
        type: 'llm',
        agentType: 'coding_agent',
        identifier: 'flow-meta',
        messages: [{ role: 'user', content: ['Hello'] }],
      },
    ],
  };
  await fs.writeFile(
    path.join(tmpDir, 'flow-metadata.json'),
    JSON.stringify(flow, null, 2),
  );

  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });

  const continueInFlowScope = bindCurrentTestOverrides(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  );

  const app = express();
  app.use((req, res, next) => continueInFlowScope(req, res, next));
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new SlowChat(),
        }),
      ),
    }),
  );
  app.use(
    createConversationsRouter({
      findConversationById: async (id) => {
        const convo = memoryConversations.get(id);
        if (!convo) return null;
        return {
          _id: String(convo._id ?? id),
          archivedAt: convo.archivedAt ?? null,
        };
      },
      listAllTurns: async (id) => ({ items: listTurnsFromMemory(id) }),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const conversationId = 'flow-metadata-conv-1';
  const expectedCommand = {
    name: 'flow',
    stepIndex: 1,
    totalSteps: 1,
    loopDepth: 0,
    agentType: 'coding_agent',
    identifier: 'flow-meta',
    label: 'llm',
  };

  const wsSnapshot = await connectWs({ baseUrl });

  try {
    await supertest(baseUrl)
      .post('/flows/flow-metadata/run')
      .send({ conversationId })
      .expect(202);

    await waitForCondition(
      () => typeof getInflight(conversationId)?.inflightId === 'string',
      20000,
      () =>
        JSON.stringify({
          conversation: JSON.parse(describeConversationState(conversationId)),
          expectedCommand,
          inflight: getInflight(conversationId) ?? null,
        }),
    );

    sendJson(wsSnapshot, { type: 'subscribe_conversation', conversationId });

    const snapshot = await waitForEvent({
      ws: wsSnapshot,
      predicate: (
        event: unknown,
      ): event is {
        type: 'inflight_snapshot';
        inflight: { command?: Record<string, unknown> };
      } => {
        const e = event as {
          type?: string;
          inflight?: { command?: unknown };
        };
        return e.type === 'inflight_snapshot' && Boolean(e.inflight?.command);
      },
      timeoutMs: 20000,
      describe: () =>
        JSON.stringify({
          conversation: JSON.parse(describeConversationState(conversationId)),
          expectedCommand,
          inflight: getInflight(conversationId) ?? null,
        }),
    });

    assert.deepEqual(snapshot.inflight.command, expectedCommand);

    await waitForCondition(
      () => {
        const items = listTurnsFromMemory(conversationId);
        return items.length >= 2;
      },
      20000,
      () =>
        JSON.stringify({
          conversation: JSON.parse(describeConversationState(conversationId)),
          expectedCommand,
          inflight: getInflight(conversationId) ?? null,
        }),
    );

    const turnsRes = await supertest(baseUrl)
      .get(`/conversations/${conversationId}/turns`)
      .expect(200);

    const items = turnsRes.body.items ?? [];
    assert.equal(items.length >= 2, true);
    assert.deepEqual(items[0].command, expectedCommand);
    assert.deepEqual(items[1].command, expectedCommand);
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await closeWs(wsSnapshot);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('top-level flow markdown persists runtime lookupSummary metadata', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-markdown-meta-'),
  );
  const workingRepo = path.join(tmpDir, 'working-repo');

  const flow = {
    description: 'Markdown metadata flow',
    steps: [
      {
        type: 'llm',
        agentType: 'coding_agent',
        identifier: 'flow-markdown-meta',
        markdownFile: 'top-level.md',
      },
    ],
  };
  await fs.writeFile(
    path.join(tmpDir, 'flow-markdown-metadata.json'),
    JSON.stringify(flow, null, 2),
  );
  await fs.mkdir(path.join(workingRepo, 'codeinfo_markdown'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(workingRepo, 'codeinfo_markdown', 'top-level.md'),
    'working repo markdown',
    'utf8',
  );

  enterTestEnvOverrides({
    CODEINFO_CODEX_AGENT_HOME: path.join(repoRoot, 'codex_agents'),
    FLOWS_DIR: tmpDir,
  });

  const continueInFlowScope = bindCurrentTestOverrides(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  );

  const app = express();
  app.use((req, res, next) => continueInFlowScope(req, res, next));
  app.use(
    createFlowsRunRouter({
      startFlowRun: bindCurrentTestOverrides((params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new SlowChat(),
          listIngestedRepositories: async () => ({
            repos: [
              buildRepoEntry({
                id: 'Working Repo',
                containerPath: workingRepo,
              }),
            ],
            lockedModelId: null,
          }),
        }),
      ),
    }),
  );
  app.use(
    createConversationsRouter({
      findConversationById: async (id) => {
        const convo = memoryConversations.get(id);
        if (!convo) return null;
        return {
          _id: String(convo._id ?? id),
          archivedAt: convo.archivedAt ?? null,
        };
      },
      listAllTurns: async (id) => ({ items: listTurnsFromMemory(id) }),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const conversationId = 'flow-markdown-metadata-conv-1';
  try {
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            buildRepoEntry({
              id: 'Working Repo',
              containerPath: workingRepo,
            }),
          ],
        }) as never,
    });

    await supertest(baseUrl)
      .post('/flows/flow-markdown-metadata/run')
      .send({ conversationId, working_folder: workingRepo })
      .expect(202);

    await waitForCondition(
      () => {
        const items = memoryTurns.get(conversationId) ?? [];
        return items.length >= 2;
      },
      20000,
      () =>
        JSON.stringify({
          conversation: JSON.parse(describeConversationState(conversationId)),
          workingRepo,
          markdownPath: path.join(
            workingRepo,
            'codeinfo_markdown',
            'top-level.md',
          ),
        }),
    );

    const turnsRes = await supertest(baseUrl)
      .get(`/conversations/${conversationId}/turns`)
      .expect(200);

    const items = turnsRes.body.items ?? [];
    const persistedTurns = memoryTurns.get(conversationId) ?? [];
    assert.equal(items.length >= 2, true);
    assert.equal(persistedTurns.length >= 2, true);
    assert.equal(
      persistedTurns.every(
        (turn) =>
          turn.command?.name === 'flow' &&
          turn.runtime?.lookupSummary?.selectedRepositoryPath ===
            path.resolve(workingRepo) &&
          turn.runtime?.lookupSummary?.fallbackUsed === false &&
          turn.runtime?.lookupSummary?.workingRepositoryAvailable === true,
      ),
      true,
    );
  } finally {
    __resetMarkdownFileResolverDepsForTests();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
