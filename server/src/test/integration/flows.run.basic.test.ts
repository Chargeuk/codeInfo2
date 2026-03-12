import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';
import pkg from '../../../package.json' with { type: 'json' };

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { DEV_0000037_T01_REQUIRED_VERSION } from '../../config/codexSdkUpgrade.js';
import {
  __resetMarkdownFileResolverDepsForTests,
  __setMarkdownFileResolverDepsForTests,
} from '../../flows/markdownFileResolver.js';
import { startFlowRun } from '../../flows/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
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
const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

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

class StreamingChat extends ChatInterface {
  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    const signal = (flags as { signal?: AbortSignal }).signal;
    const abortIfNeeded = () => {
      if (!signal?.aborted) return false;
      this.emit('error', { type: 'error', message: 'aborted' });
      return true;
    };

    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('analysis', { type: 'analysis', content: 'thinking...' });
    await delay(30);
    if (abortIfNeeded()) return;
    this.emit('token', { type: 'token', content: 'Hel' });
    await delay(30);
    if (abortIfNeeded()) return;
    this.emit('token', { type: 'token', content: 'lo' });
    await delay(30);
    if (abortIfNeeded()) return;
    this.emit('final', { type: 'final', content: 'Hello flow' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class InstantChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _message;
    void _flags;
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class CapturingChat extends ChatInterface {
  constructor(
    private readonly messages: string[],
    private readonly finalContent = 'ok',
  ) {
    super();
  }

  async execute(
    message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _flags;
    void _model;
    this.messages.push(message);
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: this.finalContent });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 4000,
): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error('Timed out waiting for flow condition');
};

const waitForTurns = async (
  conversationId: string,
  predicate: (turns: Turn[]) => boolean,
  timeoutMs = 4000,
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const turns = memoryTurns.get(conversationId) ?? [];
    if (predicate(turns)) return turns;
    await delay(20);
  }
  throw new Error('Timed out waiting for flow turns');
};

const cleanupMemory = (...conversationIds: Array<string | undefined>) => {
  conversationIds.forEach((conversationId) => {
    if (!conversationId) return;
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
};

const writeAgentScaffold = async (params: {
  agentsHome: string;
  agentName: string;
  codexHome: string;
}) => {
  const agentHome = path.join(params.agentsHome, params.agentName);
  await fs.mkdir(params.codexHome, { recursive: true });
  await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "agent-model-1"', 'approval_policy = "never"'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(params.codexHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(path.join(params.codexHome, 'config.toml'), '', 'utf8');
  await fs.mkdir(path.join(params.codexHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(params.codexHome, 'chat', 'config.toml'),
    '',
    'utf8',
  );
};

const writeFlowFile = async (params: {
  flowsRoot: string;
  flowName: string;
  steps: unknown[];
}) => {
  await fs.mkdir(params.flowsRoot, { recursive: true });
  await fs.writeFile(
    path.join(params.flowsRoot, `${params.flowName}.json`),
    JSON.stringify(
      {
        description: 'markdown flow',
        steps: params.steps,
      },
      null,
      2,
    ),
    'utf8',
  );
};

const writeMarkdownFile = async (params: {
  repoRoot: string;
  relativePath: string;
  content?: string;
  bytes?: Uint8Array;
}) => {
  const filePath = path.join(
    params.repoRoot,
    'codeinfo_markdown',
    params.relativePath,
  );
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (params.bytes) {
    await fs.writeFile(filePath, params.bytes);
  } else {
    await fs.writeFile(filePath, params.content ?? '', 'utf8');
  }
  return filePath;
};

const getAgentConversationId = (conversationId: string) => {
  const conversation = memoryConversations.get(conversationId);
  const flags = (conversation?.flags ?? {}) as {
    flow?: { agentConversations?: Record<string, string> };
  };
  const agentConversationId =
    flags.flow?.agentConversations?.['coding_agent:basic'];
  assert.ok(agentConversationId, 'Missing coding_agent:basic conversation');
  return agentConversationId;
};

const collectAgentConversationIds = (conversationId: string) => {
  const conversation = memoryConversations.get(conversationId);
  const flags = (conversation?.flags ?? {}) as {
    flow?: { agentConversations?: Record<string, string> };
  };
  return Object.values(flags.flow?.agentConversations ?? {});
};

const withMarkdownFlowHarness = async (
  task: (params: {
    tempRoot: string;
    codeInfo2Root: string;
    localFlowsDir: string;
    buildRepoEntry: typeof buildRepoEntry;
    writeFlowFile: typeof writeFlowFile;
    writeMarkdownFile: typeof writeMarkdownFile;
    runFlow: (params: {
      flowName: string;
      conversationId: string;
      listedRepos?: RepoEntry[];
      sourceId?: string;
      finalContent?: string;
      resolverListRepos?: () => Promise<{
        repos: RepoEntry[];
        lockedModelId: string | null;
      }>;
      resolverReadFile?: (filePath: string) => Promise<Buffer>;
      turnsPredicate: (turns: Turn[]) => boolean;
    }) => Promise<{ messages: string[]; turns: Turn[] }>;
  }) => Promise<void>,
) => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flows-markdown-file-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const localFlowsDir = path.join(codeInfo2Root, 'flows');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  await fs.mkdir(localFlowsDir, { recursive: true });
  await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });

  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  process.env.FLOWS_DIR = localFlowsDir;

  const conversations = new Set<string>();

  try {
    await task({
      tempRoot,
      codeInfo2Root,
      localFlowsDir,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow: async ({
        flowName,
        conversationId,
        listedRepos = [],
        sourceId,
        finalContent,
        resolverListRepos,
        resolverReadFile,
        turnsPredicate,
      }) => {
        conversations.add(conversationId);
        const messages: string[] = [];
        const repoResult = {
          repos: listedRepos,
          lockedModelId: null,
        };
        __setMarkdownFileResolverDepsForTests({
          listIngestedRepositories:
            resolverListRepos ??
            (async () => ({ repos: listedRepos, lockedModelId: null })),
          ...(resolverReadFile ? { readFile: resolverReadFile } : {}),
        });

        await startFlowRun({
          flowName,
          conversationId,
          source: 'REST',
          sourceId,
          chatFactory: () => new CapturingChat(messages, finalContent),
          listIngestedRepositories: async () => repoResult,
        });

        const turns = await waitForTurns(conversationId, turnsPredicate);
        collectAgentConversationIds(conversationId).forEach((id) =>
          conversations.add(id),
        );
        await waitFor(
          () =>
            messages.length > 0 ||
            turns.some((turn) => turn.role === 'assistant'),
        );
        return { messages, turns };
      },
    });
  } finally {
    __resetMarkdownFileResolverDepsForTests();
    cleanupMemory(...conversations);
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    if (previousFlowsDir) {
      process.env.FLOWS_DIR = previousFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};

test('POST /flows/:flowName/run starts a flow run and streams events', async () => {
  assert.equal(
    pkg.dependencies?.['@openai/codex-sdk'],
    DEV_0000037_T01_REQUIRED_VERSION,
  );
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const fixturesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../fixtures/flows',
  );
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-run-'));
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new StreamingChat(),
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

  const conversationId = 'flow-basic-conv-1';
  const customTitle = 'Custom Flow Title';

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const userTurnPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'user_turn';
        conversationId: string;
        inflightId: string;
      } => {
        const e = event as { type?: string; conversationId?: string };
        return e.type === 'user_turn' && e.conversationId === conversationId;
      },
      timeoutMs: 8000,
    });

    const deltaPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'assistant_delta';
        conversationId: string;
        inflightId: string;
        delta: string;
      } => {
        const e = event as { type?: string; conversationId?: string };
        return (
          e.type === 'assistant_delta' && e.conversationId === conversationId
        );
      },
      timeoutMs: 8000,
    });

    const finalPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is { type: 'turn_final'; status: string } => {
        const e = event as { type?: string; conversationId?: string };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 8000,
    });

    const res = await supertest(baseUrl)
      .post('/flows/llm-basic/run')
      .send({ conversationId, customTitle })
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.flowName, 'llm-basic');
    assert.equal(res.body.conversationId, conversationId);
    assert.equal(typeof res.body.inflightId, 'string');
    assert.equal(typeof res.body.modelId, 'string');

    const userTurn = await userTurnPromise;
    const delta = await deltaPromise;
    assert.equal(userTurn.inflightId, delta.inflightId);

    const final = await finalPromise;
    assert.equal(final.status, 'ok');

    const conversation = memoryConversations.get(conversationId);
    assert.ok(conversation);
    assert.equal(conversation?.title, customTitle);
    assert.equal(conversation?.flowName, 'llm-basic');
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
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
});

test('POST /flows/:flowName/run ignores whitespace customTitle', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const fixturesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../fixtures/flows',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-whitespace-'),
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
          chatFactory: () => new StreamingChat(),
        }),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const conversationId = 'flow-basic-conv-whitespace';

  try {
    await supertest(baseUrl)
      .post('/flows/llm-basic/run')
      .send({ conversationId, customTitle: '   ' })
      .expect(202);

    const conversation = memoryConversations.get(conversationId);
    assert.ok(conversation);
    assert.equal(conversation?.title, 'Flow: llm-basic');
  } finally {
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
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
});

test('POST /flows/:flowName/run returns 404 for unknown sourceId', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-unknown-source-'),
  );
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry('/data/known-repo')],
            lockedModelId: null,
          }),
        }),
    }),
  );

  try {
    await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ sourceId: '/data/unknown-repo' })
      .expect(404);
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

test('POST /flows/:flowName/run fails on invalid agent config supported key types (resolver regression guard)', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const tmpAgentsHome = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agents-home-'),
  );
  const tmpFlowsDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-invalid-config-'),
  );
  const agentHome = path.join(tmpAgentsHome, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'auth.json'), '{}', 'utf8');
  await fs.writeFile(
    path.join(agentHome, 'config.toml'),
    ['model = "gpt-5.1-codex-max"', 'approval_policy = 42'].join('\n'),
    'utf8',
  );
  await fs.cp(fixturesDir, tmpFlowsDir, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = tmpAgentsHome;
  process.env.FLOWS_DIR = tmpFlowsDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
        }),
    }),
  );

  try {
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId: 'flow-invalid-config-regression' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
    assert.equal(typeof res.body.message, 'string');
    assert.equal(res.body.message.length > 0, true);
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpFlowsDir, { recursive: true, force: true });
    await fs.rm(tmpAgentsHome, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run uses ingested flow when sourceId provided', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpLocalDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-local-'),
  );
  const tmpRepoRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-ingested-'),
  );
  const tmpRepoFlows = path.join(tmpRepoRoot, 'flows');
  await fs.mkdir(tmpRepoFlows, { recursive: true });
  await fs.cp(fixturesDir, tmpRepoFlows, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpLocalDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(tmpRepoRoot)],
            lockedModelId: null,
          }),
        }),
    }),
  );

  try {
    const conversationId = 'flow-ingested-conv-1';
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId, sourceId: tmpRepoRoot })
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.flowName, 'llm-basic');
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run resolves sourceId with legacy alias payloads', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpLocalDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-local-legacy-'),
  );
  const tmpRepoRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-ingested-legacy-'),
  );
  const tmpRepoFlows = path.join(tmpRepoRoot, 'flows');
  await fs.mkdir(tmpRepoFlows, { recursive: true });
  await fs.cp(fixturesDir, tmpRepoFlows, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpLocalDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [
              {
                id: 'Legacy',
                description: null,
                containerPath: tmpRepoRoot,
                hostPath: tmpRepoRoot,
                lastIngestAt: null,
                model: 'legacy-model',
                modelId: 'legacy-model',
                counts: { files: 0, chunks: 0, embedded: 0 },
                lastError: null,
              } as unknown as RepoEntry,
            ],
            lockedModelId: null,
          }),
        }),
    }),
  );

  try {
    const conversationId = 'flow-ingested-conv-legacy';
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId, sourceId: tmpRepoRoot })
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.flowName, 'llm-basic');
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  }
});

test('POST /flows/:flowName/run uses local flows when sourceId omitted', async () => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  const tmpLocalDir = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-local-only-'),
  );
  await fs.cp(fixturesDir, tmpLocalDir, { recursive: true });
  const tmpRepoRoot = await fs.mkdtemp(
    path.join(process.cwd(), 'tmp-flows-run-ingested-only-'),
  );
  const tmpRepoFlows = path.join(tmpRepoRoot, 'flows');
  await fs.mkdir(tmpRepoFlows, { recursive: true });
  await fs.cp(fixturesDir, tmpRepoFlows, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpLocalDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new InstantChat(),
          listIngestedRepositories: async () => ({
            repos: [buildRepoEntry(tmpRepoRoot)],
            lockedModelId: null,
          }),
        }),
    }),
  );

  try {
    const conversationId = 'flow-local-conv-1';
    const res = await supertest(app)
      .post('/flows/llm-basic/run')
      .send({ conversationId })
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.flowName, 'llm-basic');
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpLocalDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  }
});

test('flow llm.markdownFile prefers the parent flow repository before codeInfo2', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      codeInfo2Root,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'source-first';
      const conversationId = 'flow-markdown-source-first';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'shared.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: codeInfo2Root,
        relativePath: 'shared.md',
        content: 'codeinfo2 markdown',
      });
      await writeMarkdownFile({
        repoRoot: sourceRepo,
        relativePath: 'shared.md',
        content: 'source markdown',
      });

      const { messages } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo)],
        turnsPredicate: (turns) =>
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
      });

      assert.deepEqual(messages, ['source markdown']);
    },
  );
});

test('flow llm.markdownFile passes loaded markdown through verbatim as one instruction', async () => {
  await withMarkdownFlowHarness(
    async ({
      codeInfo2Root,
      localFlowsDir,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const flowName = 'verbatim-markdown';
      const conversationId = 'flow-markdown-verbatim';
      const markdown = '# Title\n\n- first\n- second\n\n```\nconst x = 1;\n```';
      await writeFlowFile({
        flowsRoot: localFlowsDir,
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'verbatim.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: codeInfo2Root,
        relativePath: 'verbatim.md',
        content: markdown,
      });

      const { messages } = await runFlow({
        flowName,
        conversationId,
        turnsPredicate: (turns) =>
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
      });

      assert.deepEqual(messages, [markdown]);
    },
  );
});

test('flow llm.markdownFile falls back to codeInfo2 after a same-source miss', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      codeInfo2Root,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'codeinfo2-fallback';
      const conversationId = 'flow-markdown-codeinfo2-fallback';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'fallback.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: codeInfo2Root,
        relativePath: 'fallback.md',
        content: 'codeinfo2 fallback markdown',
      });

      const { messages } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo)],
        turnsPredicate: (turns) =>
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
      });

      assert.deepEqual(messages, ['codeinfo2 fallback markdown']);
    },
  );
});

test('flow llm.markdownFile falls back to another ingested repository after same-source and codeInfo2 misses', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const otherRepo = path.join(tempRoot, 'repo-other');
      const flowName = 'other-repo-fallback';
      const conversationId = 'flow-markdown-other-fallback';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'shared.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: otherRepo,
        relativePath: 'shared.md',
        content: 'other repo markdown',
      });

      const { messages } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo), buildRepoEntry(otherRepo)],
        turnsPredicate: (turns) =>
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
      });

      assert.deepEqual(messages, ['other repo markdown']);
    },
  );
});

test('flow llm.markdownFile fails fast when a higher-priority markdown file is unreadable', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      codeInfo2Root,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'unreadable-markdown';
      const conversationId = 'flow-markdown-unreadable';
      const sameSourcePath = await writeMarkdownFile({
        repoRoot: sourceRepo,
        relativePath: 'shared.md',
        content: 'unreadable source markdown',
      });
      await writeMarkdownFile({
        repoRoot: codeInfo2Root,
        relativePath: 'shared.md',
        content: 'codeinfo2 fallback that must not run',
      });
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'shared.md',
          },
        ],
      });

      const { messages, turns } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo)],
        resolverReadFile: async (filePath) => {
          if (filePath === sameSourcePath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
          }
          return fs.readFile(filePath);
        },
        turnsPredicate: (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'failed',
          ),
      });

      assert.deepEqual(messages, []);
      const failedTurn = turns.find(
        (turn) => turn.role === 'assistant' && turn.status === 'failed',
      );
      assert.ok(failedTurn);
      assert.match(failedTurn.content, /permission denied/);
    },
  );
});

test('flow llm.markdownFile uses deterministic full-path ordering for duplicate-label fallback repositories', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const repoAlphaA = path.join(tempRoot, 'repo-alpha-a');
      const repoAlphaB = path.join(tempRoot, 'repo-alpha-b');
      const flowName = 'duplicate-label-order';
      const conversationId = 'flow-markdown-duplicate-labels';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'shared.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: repoAlphaA,
        relativePath: 'shared.md',
        content: 'alpha-a markdown',
      });
      await writeMarkdownFile({
        repoRoot: repoAlphaB,
        relativePath: 'shared.md',
        content: 'alpha-b markdown',
      });

      const { messages } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [
          buildRepoEntry(sourceRepo),
          { ...buildRepoEntry(repoAlphaB), id: 'Alpha Repo' },
          { ...buildRepoEntry(repoAlphaA), id: 'Alpha Repo' },
        ],
        turnsPredicate: (turns) =>
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ),
      });

      assert.deepEqual(messages, ['alpha-a markdown']);
    },
  );
});

test('flow llm.markdownFile fails clearly when the markdown file is missing', async () => {
  await withMarkdownFlowHarness(
    async ({ tempRoot, buildRepoEntry, writeFlowFile, runFlow }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'missing-markdown';
      const conversationId = 'flow-markdown-missing';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'missing.md',
          },
        ],
      });

      const { messages, turns } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo)],
        turnsPredicate: (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'failed',
          ),
      });

      assert.deepEqual(messages, []);
      const failedTurn = turns.find(
        (turn) => turn.role === 'assistant' && turn.status === 'failed',
      );
      assert.ok(failedTurn);
      assert.match(failedTurn.content, /was not found/);
    },
  );
});

test('flow llm.markdownFile fails clearly when markdown bytes are not valid UTF-8', async () => {
  await withMarkdownFlowHarness(
    async ({
      tempRoot,
      buildRepoEntry,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'invalid-utf8-markdown';
      const conversationId = 'flow-markdown-invalid-utf8';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'broken.md',
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: sourceRepo,
        relativePath: 'broken.md',
        bytes: Uint8Array.from([0xc3, 0x28]),
      });

      const { messages, turns } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos: [buildRepoEntry(sourceRepo)],
        turnsPredicate: (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'failed',
          ),
      });

      assert.deepEqual(messages, []);
      const failedTurn = turns.find(
        (turn) => turn.role === 'assistant' && turn.status === 'failed',
      );
      assert.ok(failedTurn);
      assert.match(failedTurn.content, /Invalid UTF-8 markdown content/);
    },
  );
});

test('flow llm.markdownFile surfaces unexpected markdown resolver exceptions as flow-step failures', async () => {
  await withMarkdownFlowHarness(
    async ({ tempRoot, buildRepoEntry, writeFlowFile, runFlow }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'resolver-exception';
      const conversationId = 'flow-markdown-resolver-exception';
      const listedRepos = [buildRepoEntry(sourceRepo)];
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'shared.md',
          },
        ],
      });

      const { messages, turns } = await runFlow({
        flowName,
        conversationId,
        sourceId: sourceRepo,
        listedRepos,
        resolverListRepos: async () => {
          throw new Error('resolver exploded');
        },
        turnsPredicate: (items) =>
          items.some(
            (turn) => turn.role === 'assistant' && turn.status === 'failed',
          ),
      });

      assert.deepEqual(messages, []);
      const failedTurn = turns.find(
        (turn) => turn.role === 'assistant' && turn.status === 'failed',
      );
      assert.ok(failedTurn);
      assert.match(failedTurn.content, /resolver exploded/);
    },
  );
});

test('flow llm.markdownFile reports AGENT_NOT_FOUND before markdown resolution failures', async () => {
  await withMarkdownFlowHarness(
    async ({ tempRoot, buildRepoEntry, writeFlowFile, runFlow }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'markdown-agent-precheck';
      const conversationId = 'flow-markdown-agent-precheck';
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'missing_agent',
            identifier: 'basic',
            markdownFile: 'missing.md',
          },
        ],
      });

      await assert.rejects(
        async () =>
          runFlow({
            flowName,
            conversationId,
            sourceId: sourceRepo,
            listedRepos: [buildRepoEntry(sourceRepo)],
            turnsPredicate: () => false,
          }),
        (error) =>
          (error as { code?: string; reason?: string }).code ===
            'AGENT_NOT_FOUND' &&
          (error as { code?: string; reason?: string }).reason ===
            'Agent missing_agent not found',
      );
    },
  );
});

test('flow llm.markdownFile reports CODEX_UNAVAILABLE before markdown resolution failures', async () => {
  await withMarkdownFlowHarness(
    async ({ tempRoot, buildRepoEntry, writeFlowFile, runFlow }) => {
      const sourceRepo = path.join(tempRoot, 'repo-source');
      const flowName = 'markdown-codex-precheck';
      const conversationId = 'flow-markdown-codex-precheck';
      const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
      const unavailableCodexHome = path.join(tempRoot, 'codex-home-missing');
      await fs.mkdir(unavailableCodexHome, { recursive: true });
      await writeFlowFile({
        flowsRoot: path.join(sourceRepo, 'flows'),
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'missing.md',
          },
        ],
      });

      try {
        process.env.CODEINFO_CODEX_HOME = unavailableCodexHome;
        await assert.rejects(
          async () =>
            runFlow({
              flowName,
              conversationId,
              sourceId: sourceRepo,
              listedRepos: [buildRepoEntry(sourceRepo)],
              turnsPredicate: () => false,
            }),
          (error) =>
            (error as { code?: string; reason?: string }).code ===
              'CODEX_UNAVAILABLE' &&
            /Missing auth\.json/i.test(
              (error as { code?: string; reason?: string }).reason ?? '',
            ),
        );
      } finally {
        process.env.CODEINFO_CODEX_HOME = previousCodexHome;
      }
    },
  );
});

test('flow continues to later steps after a successful llm.markdownFile step', async () => {
  await withMarkdownFlowHarness(
    async ({
      codeInfo2Root,
      localFlowsDir,
      writeFlowFile,
      writeMarkdownFile,
      runFlow,
    }) => {
      const flowName = 'markdown-then-message';
      const conversationId = 'flow-markdown-then-message';
      await writeFlowFile({
        flowsRoot: localFlowsDir,
        flowName,
        steps: [
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            markdownFile: 'first.md',
          },
          {
            type: 'llm',
            agentType: 'coding_agent',
            identifier: 'basic',
            messages: [
              {
                role: 'user',
                content: ['second step message'],
              },
            ],
          },
        ],
      });
      await writeMarkdownFile({
        repoRoot: codeInfo2Root,
        relativePath: 'first.md',
        content: 'first markdown step',
      });

      const { messages, turns } = await runFlow({
        flowName,
        conversationId,
        turnsPredicate: (items) =>
          items.filter(
            (turn) => turn.role === 'assistant' && turn.status === 'ok',
          ).length >= 2,
      });

      assert.deepEqual(messages, [
        'first markdown step',
        'second step message',
      ]);
      const agentConversationId = getAgentConversationId(conversationId);
      const agentTurns = memoryTurns.get(agentConversationId) ?? [];
      assert.equal(
        agentTurns.filter((turn) => turn.role === 'assistant').length,
        2,
      );
      cleanupMemory(agentConversationId);
      assert.equal(turns.filter((turn) => turn.role === 'assistant').length, 2);
    },
  );
});
