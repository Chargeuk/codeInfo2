import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import express from 'express';

import {
  __resetAgentCommandRunnerDepsForTests,
  __setAgentCommandRunnerDepsForTests,
} from '../../agents/commandsRunner.js';
import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
  runAgentCommand,
  startAgentCommand,
} from '../../agents/service.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __resetMarkdownFileResolverDepsForTests,
  __setMarkdownFileResolverDepsForTests,
} from '../../flows/markdownFileResolver.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { attachWs } from '../../ws/server.js';
import { createPlanScopeFixture } from '../support/planScopeFixture.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

class CapturingChat extends ChatInterface {
  constructor(private readonly messages: string[]) {
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
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const ORIGINAL_CODEINFO_HOST_INGEST_DIR = process.env.CODEINFO_HOST_INGEST_DIR;
const ORIGINAL_CODEINFO_CODEX_WORKDIR = process.env.CODEINFO_CODEX_WORKDIR;
const ORIGINAL_CODEX_WORKDIR = process.env.CODEX_WORKDIR;

const restorePathMappingEnv = () => {
  if (ORIGINAL_CODEINFO_HOST_INGEST_DIR === undefined) {
    delete process.env.CODEINFO_HOST_INGEST_DIR;
  } else {
    process.env.CODEINFO_HOST_INGEST_DIR = ORIGINAL_CODEINFO_HOST_INGEST_DIR;
  }
  if (ORIGINAL_CODEINFO_CODEX_WORKDIR === undefined) {
    delete process.env.CODEINFO_CODEX_WORKDIR;
  } else {
    process.env.CODEINFO_CODEX_WORKDIR = ORIGINAL_CODEINFO_CODEX_WORKDIR;
  }
  if (ORIGINAL_CODEX_WORKDIR === undefined) {
    delete process.env.CODEX_WORKDIR;
  } else {
    process.env.CODEX_WORKDIR = ORIGINAL_CODEX_WORKDIR;
  }
};

const setPathMappingEnv = (params: {
  hostIngestDir: string;
  codexWorkdir: string;
}) => {
  process.env.CODEINFO_HOST_INGEST_DIR = params.hostIngestDir;
  process.env.CODEINFO_CODEX_WORKDIR = params.codexWorkdir;
  delete process.env.CODEX_WORKDIR;
};

const buildReingestSuccess = (
  overrides: Partial<{
    status: 'completed' | 'cancelled' | 'error';
    errorCode: string | null;
    sourceId: string;
    runId: string;
    resolvedRepositoryId: string | null;
    completionMode: 'reingested' | 'skipped' | null;
  }> = {},
) => ({
  status: 'completed' as const,
  operation: 'reembed' as const,
  runId: 'run-123',
  sourceId: '/repo/source-a',
  resolvedRepositoryId: 'repo-a',
  completionMode: 'reingested' as const,
  durationMs: 100,
  files: 3,
  chunks: 7,
  embedded: 7,
  errorCode: null,
  ...overrides,
});

const buildWaitTimeQueueUnavailableError = (params: {
  repositoryId: string;
  sourceId: string;
}) => ({
  code: 503 as const,
  message: 'QUEUE_UNAVAILABLE' as const,
  data: {
    tool: 'reingest_repository' as const,
    code: 'QUEUE_UNAVAILABLE' as const,
    retryable: true as const,
    retryMessage: 'retry',
    reingestableRepositoryIds: [params.repositoryId],
    reingestableSourceIds: [params.sourceId],
    queueFailureStage: 'wait' as const,
    waitReason: 'queue-read-failed' as const,
    fieldErrors: [
      {
        field: 'sourceId' as const,
        reason: 'invalid_state' as const,
        message:
          'Mongo-backed ingest queue is unavailable while waiting for re-ingest completion',
      },
    ],
  },
});

const buildRepoEntry = (params: {
  id: string;
  containerPath: string;
  lastIngestAt?: string | null;
}): RepoEntry => ({
  id: params.id,
  description: null,
  containerPath: params.containerPath,
  hostPath: `/host${params.containerPath}`,
  lastIngestAt: params.lastIngestAt ?? '2026-01-01T00:00:00.000Z',
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
  counts: { files: 1, chunks: 1, embedded: 1 },
  lastError: null,
});

const setAgentServiceRepoList = (repos: RepoEntry[]) => {
  __setAgentServiceDepsForTests({
    listIngestedRepositories: async () => ({
      repos,
      lockedModelId: null,
    }),
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
  return agentHome;
};

const writeCommandFile = async (params: {
  commandRoot: string;
  commandName: string;
  items: unknown[];
}) => {
  await fs.mkdir(params.commandRoot, { recursive: true });
  await fs.writeFile(
    path.join(params.commandRoot, `${params.commandName}.json`),
    JSON.stringify(
      {
        Description: 'reingest command',
        items: params.items,
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
  content: string;
}) => {
  const filePath = path.join(
    params.repoRoot,
    'codeinfo_markdown',
    params.relativePath,
  );
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, params.content, 'utf8');
};

let previousPreferredAgentsHome: string | undefined;
let previousLegacyAgentsHome: string | undefined;

beforeEach(() => {
  previousPreferredAgentsHome = process.env.CODEINFO_AGENT_HOME;
  previousLegacyAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  delete process.env.CODEINFO_AGENT_HOME;
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
    reason: undefined,
  });
});

afterEach(() => {
  if (previousPreferredAgentsHome === undefined) {
    delete process.env.CODEINFO_AGENT_HOME;
  } else {
    process.env.CODEINFO_AGENT_HOME = previousPreferredAgentsHome;
  }
  previousPreferredAgentsHome = undefined;
  if (previousLegacyAgentsHome === undefined) {
    delete process.env.CODEINFO_CODEX_AGENT_HOME;
  } else {
    process.env.CODEINFO_CODEX_AGENT_HOME = previousLegacyAgentsHome;
  }
  previousLegacyAgentsHome = undefined;
});

const waitForMemoryTurns = async (
  conversationId: string,
  expectedCount: number,
): Promise<void> => {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const turns = memoryTurns.get(conversationId) ?? [];
    if (turns.length >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for ${expectedCount} memory turns for ${conversationId}`,
  );
};

const setupRepoCommandHarness = async (suffix: string) => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `commands-reingest-${suffix}-`),
  );
  const codexHome = path.join(tempRoot, 'codex-home');
  const repoRoot = path.join(tempRoot, 'repo-owner');
  const agentsHome = path.join(repoRoot, 'codex_agents');
  const agentHome = await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;
  __setAgentServiceDepsForTests({
    getCodexDetection: () => ({
      available: true,
      authPresent: true,
      configPresent: true,
      cliPath: '/usr/bin/codex',
      reason: undefined,
    }),
  });

  return {
    tempRoot,
    repoRoot,
    codexHome,
    agentsHome,
    agentHome,
    restore: async () => {
      __resetAgentCommandRunnerDepsForTests();
      __resetAgentServiceDepsForTests();
      __resetMarkdownFileResolverDepsForTests();
      if (previousAgentsHome === undefined) {
        delete process.env.CODEINFO_CODEX_AGENT_HOME;
      } else {
        process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
      }
      if (previousCodexHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = previousCodexHome;
      }
      memoryConversations.clear();
      memoryTurns.clear();
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
};

test('runAgentCommand bootstraps a new conversation for a reingest-only command', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-reingest-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const agentHome = await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(agentHome, 'commands'),
      commandName: 'reingest-only-run',
      items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
    });
    setAgentServiceRepoList([
      buildRepoEntry({ id: 'repo-a', containerPath: '/repo/source-a' }),
    ]);
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess(),
      }),
      createCallId: () => 'call-run-only',
    });

    const result = await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'reingest-only-run',
      source: 'REST',
    });

    const conversation = memoryConversations.get(result.conversationId);
    const turns = memoryTurns.get(result.conversationId) ?? [];
    assert.ok(conversation);
    assert.equal(conversation?.model, 'gpt-5.6-sol');
    assert.equal(conversation?.title, 'Command: reingest-only-run');
    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.role, 'user');
    assert.equal(turns[1]?.role, 'assistant');
    assert.deepEqual(turns[1]?.toolCalls, {
      calls: [
        {
          type: 'tool-result',
          callId: 'call-run-only',
          name: 'reingest_repository',
          stage: 'success',
          result: {
            kind: 'reingest_step_result',
            stepType: 'reingest',
            targetMode: 'sourceId',
            requestedSelector: '/repo/source-a',
            sourceId: '/repo/source-a',
            resolvedRepositoryId: 'repo-a',
            outcome: 'reingested',
            status: 'completed',
            completionMode: 'reingested',
            operation: 'reembed',
            runId: 'run-123',
            files: 3,
            chunks: 7,
            embedded: 7,
            errorCode: null,
          },
          error: null,
        },
      ],
    });
  } finally {
    __resetAgentCommandRunnerDepsForTests();
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    memoryConversations.clear();
    memoryTurns.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('startAgentCommand bootstraps the same synthetic contract for a reingest-only command', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-reingest-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const agentHome = await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(agentHome, 'commands'),
      commandName: 'reingest-only-start',
      items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
    });
    setAgentServiceRepoList([
      buildRepoEntry({ id: 'repo-a', containerPath: '/repo/source-a' }),
    ]);
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess(),
      }),
      createCallId: () => 'call-start-only',
    });

    const result = await startAgentCommand({
      agentName: 'coding_agent',
      commandName: 'reingest-only-start',
      source: 'REST',
    });

    await waitForMemoryTurns(result.conversationId, 2);

    const conversation = memoryConversations.get(result.conversationId);
    const turns = memoryTurns.get(result.conversationId) ?? [];
    assert.ok(conversation);
    assert.equal(conversation?.model, 'gpt-5.6-sol');
    assert.equal(conversation?.title, 'Command: reingest-only-start');
    assert.equal(turns.length, 2);
    assert.equal(
      (
        turns[1]?.toolCalls as {
          calls?: Array<{ callId: string }>;
        } | null
      )?.calls?.[0]?.callId,
      'call-start-only',
    );
  } finally {
    __resetAgentCommandRunnerDepsForTests();
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    memoryConversations.clear();
    memoryTurns.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('startAgentCommand emits a terminal failure outcome when a reingest precheck rejects in the background runner', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-reingest-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const agentHome = await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  const app = express();
  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'reingest-precheck-fails-conversation';

  try {
    await writeCommandFile({
      commandRoot: path.join(agentHome, 'commands'),
      commandName: 'reingest-precheck-fails',
      items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
    });
    setAgentServiceRepoList([
      buildRepoEntry({ id: 'repo-a', containerPath: '/repo/source-a' }),
    ]);
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: {
          code: 503,
          message: 'QUEUE_UNAVAILABLE',
          data: {
            tool: 'reingest_repository',
            code: 'QUEUE_UNAVAILABLE',
            retryable: true,
            retryMessage: 'retry later',
            reingestableRepositoryIds: ['codeinfo2'],
            reingestableSourceIds: ['/repo/source-a'],
            fieldErrors: [
              {
                field: 'sourceId',
                reason: 'invalid_state',
                message:
                  'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
              },
            ],
          },
        },
      }),
    });

    sendJson(ws, {
      type: 'subscribe_conversation',
      conversationId,
    });

    const finalPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'turn_final';
        conversationId: string;
        status: string;
        error?: { code?: string; message?: string };
      } => {
        const payload = event as {
          type?: string;
          conversationId?: string;
        };
        return (
          payload.type === 'turn_final' &&
          payload.conversationId === conversationId
        );
      },
      timeoutMs: 8_000,
    });

    const result = await startAgentCommand({
      agentName: 'coding_agent',
      commandName: 'reingest-precheck-fails',
      conversationId,
      source: 'REST',
    });

    const final = await finalPromise;

    await waitForMemoryTurns(result.conversationId, 2);

    const turns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(final.status, 'failed');
    assert.equal(final.error?.code, 'COMMAND_INVALID');
    assert.equal(
      final.error?.message,
      'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
    );
    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.role, 'user');
    assert.equal(turns[0]?.content, 'Re-ingest repository /repo/source-a');
    assert.equal(turns[1]?.role, 'assistant');
    assert.equal(turns[1]?.status, 'failed');
    assert.equal(
      turns[1]?.content,
      'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
    );
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    __resetAgentCommandRunnerDepsForTests();
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    memoryConversations.clear();
    memoryTurns.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('startAgentCommand propagates a structured OPENAI_MODEL_UNAVAILABLE reingest result instead of a thrown background-runner exception', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-reingest-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const agentHome = await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  const app = express();
  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'reingest-openai-unavailable-conversation';

  try {
    await writeCommandFile({
      commandRoot: path.join(agentHome, 'commands'),
      commandName: 'reingest-openai-unavailable',
      items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
    });
    setAgentServiceRepoList([
      buildRepoEntry({ id: 'repo-a', containerPath: '/repo/source-a' }),
    ]);
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: {
          code: 409,
          message: 'OPENAI_MODEL_UNAVAILABLE',
          data: {
            tool: 'reingest_repository',
            code: 'OPENAI_MODEL_UNAVAILABLE',
            retryable: true,
            retryMessage: 'retry later',
            reingestableRepositoryIds: ['repo-a'],
            reingestableSourceIds: ['/repo/source-a'],
            fieldErrors: [
              {
                field: 'sourceId',
                reason: 'invalid_state',
                message:
                  'Requested OpenAI embedding model is unavailable for this deployment',
              },
            ],
          },
        },
      }),
    });

    sendJson(ws, {
      type: 'subscribe_conversation',
      conversationId,
    });

    const finalPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'turn_final';
        conversationId: string;
        status: string;
        error?: { code?: string; message?: string };
      } => {
        const payload = event as {
          type?: string;
          conversationId?: string;
        };
        return (
          payload.type === 'turn_final' &&
          payload.conversationId === conversationId
        );
      },
      timeoutMs: 8_000,
    });

    const result = await startAgentCommand({
      agentName: 'coding_agent',
      commandName: 'reingest-openai-unavailable',
      conversationId,
      source: 'REST',
    });

    const final = await finalPromise;

    await waitForMemoryTurns(result.conversationId, 2);

    const turns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(final.status, 'failed');
    assert.equal(final.error?.code, 'COMMAND_INVALID');
    assert.equal(
      final.error?.message,
      'Requested OpenAI embedding model is unavailable for this deployment',
    );
    assert.equal(turns[1]?.status, 'failed');
    assert.equal(
      turns[1]?.content,
      'Requested OpenAI embedding model is unavailable for this deployment',
    );
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    __resetAgentCommandRunnerDepsForTests();
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    memoryConversations.clear();
    memoryTurns.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('mixed direct-command runs preserve reingest then message execution order', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-reingest-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const agentHome = await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });
  const messages: string[] = [];

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(agentHome, 'commands'),
      commandName: 'reingest-then-message',
      items: [
        { type: 'reingest', sourceId: '/repo/source-a' },
        { type: 'message', role: 'user', content: ['after'] },
      ],
    });
    setAgentServiceRepoList([
      buildRepoEntry({ id: 'repo-a', containerPath: '/repo/source-a' }),
    ]);
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess(),
      }),
      createCallId: () => 'call-mixed-1',
    });

    const result = await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'reingest-then-message',
      source: 'REST',
      chatFactory: () => new CapturingChat(messages),
    });

    const turns = memoryTurns.get(result.conversationId) ?? [];
    assert.deepEqual(messages, ['after']);
    assert.equal(turns.length, 4);
    assert.equal(turns[0]?.role, 'user');
    assert.equal(turns[1]?.role, 'assistant');
    assert.notEqual(turns[1]?.toolCalls, null);
    assert.equal(turns[2]?.content, 'after');
  } finally {
    __resetAgentCommandRunnerDepsForTests();
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    memoryConversations.clear();
    memoryTurns.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('multiple direct-command reingest items retain distinct callIds', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-reingest-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const agentHome = await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });
  const callIds = ['call-a', 'call-b'];

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(agentHome, 'commands'),
      commandName: 'double-reingest',
      items: [
        { type: 'reingest', sourceId: '/repo/source-a' },
        { type: 'reingest', sourceId: '/repo/source-a' },
      ],
    });
    setAgentServiceRepoList([
      buildRepoEntry({ id: 'repo-a', containerPath: '/repo/source-a' }),
    ]);
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess(),
      }),
      createCallId: () => {
        const next = callIds.shift();
        if (!next) {
          throw new Error('missing callId');
        }
        return next;
      },
    });

    const result = await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'double-reingest',
      source: 'REST',
    });

    const assistantTurns = (
      memoryTurns.get(result.conversationId) ?? []
    ).filter((turn) => turn.role === 'assistant');
    assert.deepEqual(
      assistantTurns.map(
        (turn) =>
          (
            turn.toolCalls as {
              calls?: Array<{ callId: string }>;
            } | null
          )?.calls?.[0]?.callId,
      ),
      ['call-a', 'call-b'],
    );
  } finally {
    __resetAgentCommandRunnerDepsForTests();
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    memoryConversations.clear();
    memoryTurns.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('repo id selectors resolve to the canonical container path and preserve shared reingest default wait dispatch', async () => {
  const harness = await setupRepoCommandHarness('selector-id');
  const selectedRoot = path.join(harness.tempRoot, 'repo-selected');
  let capturedArgs: unknown;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'repo-id-selector',
      items: [{ type: 'reingest', sourceId: 'Repo Selected' }],
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => ({
        repos: [
          buildRepoEntry({
            id: 'Owner Repo',
            containerPath: harness.repoRoot,
          }),
          buildRepoEntry({
            id: 'Repo Selected',
            containerPath: selectedRoot,
          }),
        ],
        lockedModelId: null,
      }),
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async (args) => {
        capturedArgs = args;
        const sourceId = args.sourceId;
        return {
          ok: true,
          value: buildReingestSuccess({ sourceId: sourceId ?? '/missing' }),
        };
      },
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'repo-id-selector',
      source: 'REST',
    });

    assert.deepEqual(capturedArgs, { sourceId: selectedRoot });
    assert.equal(
      typeof capturedArgs === 'object' &&
        capturedArgs !== null &&
        'waitOptions' in capturedArgs,
      false,
    );
  } finally {
    await harness.restore();
  }
});

test('absolute-path selectors still execute against the explicit canonical path', async () => {
  const harness = await setupRepoCommandHarness('selector-path');
  const selectedRoot = path.join(harness.tempRoot, 'repo-path-target');
  let capturedSourceId: string | undefined;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'path-selector',
      items: [{ type: 'reingest', sourceId: selectedRoot }],
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => ({
        repos: [
          buildRepoEntry({
            id: 'Owner Repo',
            containerPath: harness.repoRoot,
          }),
          buildRepoEntry({
            id: 'Path Repo',
            containerPath: selectedRoot,
          }),
        ],
        lockedModelId: null,
      }),
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async ({ sourceId }) => {
        capturedSourceId = sourceId;
        return { ok: true, value: buildReingestSuccess({ sourceId }) };
      },
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'path-selector',
      source: 'REST',
    });

    assert.equal(capturedSourceId, selectedRoot);
  } finally {
    await harness.restore();
  }
});

test('duplicate case-insensitive repository ids still resolve to the latest ingest', async () => {
  const harness = await setupRepoCommandHarness('selector-latest');
  const olderRoot = path.join(harness.tempRoot, 'repo-older');
  const newerRoot = path.join(harness.tempRoot, 'repo-newer');
  let capturedSourceId: string | undefined;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'latest-selector',
      items: [{ type: 'reingest', sourceId: 'Shared Repo' }],
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => ({
        repos: [
          buildRepoEntry({
            id: 'Owner Repo',
            containerPath: harness.repoRoot,
          }),
          buildRepoEntry({
            id: 'shared repo',
            containerPath: olderRoot,
            lastIngestAt: '2026-01-01T00:00:00.000Z',
          }),
          buildRepoEntry({
            id: 'Shared Repo',
            containerPath: newerRoot,
            lastIngestAt: '2026-02-01T00:00:00.000Z',
          }),
        ],
        lockedModelId: null,
      }),
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async ({ sourceId }) => {
        capturedSourceId = sourceId;
        return { ok: true, value: buildReingestSuccess({ sourceId }) };
      },
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'latest-selector',
      source: 'REST',
    });

    assert.equal(capturedSourceId, newerRoot);
  } finally {
    await harness.restore();
  }
});

test('direct command target working fails fast until the surface passes an explicit working repository path', async () => {
  const harness = await setupRepoCommandHarness('target-working');
  let strictCalls = 0;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'working-target',
      items: [{ type: 'reingest', target: 'working' }],
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => ({
        repos: [
          buildRepoEntry({
            id: 'Owner Repo',
            containerPath: harness.repoRoot,
          }),
        ],
        lockedModelId: null,
      }),
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => {
        strictCalls += 1;
        return { ok: true, value: buildReingestSuccess() };
      },
    });

    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'working-target',
          source: 'REST',
        }),
      (error) =>
        (error as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        /target "working" requires a selected working repository path/i.test(
          (error as { reason?: string }).reason ?? '',
        ),
    );
    assert.equal(strictCalls, 0);
  } finally {
    await harness.restore();
  }
});

test('direct command target working reingests the selected working repository and persists targetMode working', async () => {
  const harness = await setupRepoCommandHarness('target-working-success');

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'working-target-success',
      items: [{ type: 'reingest', target: 'working' }],
    });
    setAgentServiceRepoList([
      buildRepoEntry({
        id: 'Owner Repo',
        containerPath: harness.repoRoot,
      }),
    ]);
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async ({ sourceId }) => ({
        ok: true,
        value: buildReingestSuccess({
          sourceId: sourceId ?? harness.repoRoot,
          resolvedRepositoryId: 'Owner Repo',
        }),
      }),
      createCallId: () => 'call-working-target',
    });

    const result = await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'working-target-success',
      working_folder: harness.repoRoot,
      source: 'REST',
    });

    const turns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(turns.length, 2);
    assert.deepEqual(turns[1]?.toolCalls, {
      calls: [
        {
          type: 'tool-result',
          callId: 'call-working-target',
          name: 'reingest_repository',
          stage: 'success',
          result: {
            kind: 'reingest_step_result',
            stepType: 'reingest',
            targetMode: 'working',
            requestedSelector: null,
            sourceId: harness.repoRoot,
            resolvedRepositoryId: 'Owner Repo',
            outcome: 'reingested',
            status: 'completed',
            completionMode: 'reingested',
            operation: 'reembed',
            runId: 'run-123',
            files: 3,
            chunks: 7,
            embedded: 7,
            errorCode: null,
          },
          error: null,
        },
      ],
    });
  } finally {
    await harness.restore();
  }
});

test('direct command target working resolves a host working_folder into the mounted codex workdir before reingest starts', async () => {
  const harness = await setupRepoCommandHarness('target-working-mapped');
  const hostIngestDir = path.join(harness.tempRoot, 'host-ingest');
  const codexWorkdir = path.join(harness.tempRoot, 'codex-workdir');
  const hostWorkingFolder = path.join(hostIngestDir, 'repo-owner');
  const mappedWorkingFolder = path.join(codexWorkdir, 'repo-owner');
  let capturedSourceId: string | undefined;

  try {
    setPathMappingEnv({ hostIngestDir, codexWorkdir });
    await fs.mkdir(mappedWorkingFolder, { recursive: true });
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'working-target-mapped-success',
      items: [{ type: 'reingest', target: 'working' }],
    });
    setAgentServiceRepoList([
      buildRepoEntry({
        id: 'Owner Repo',
        containerPath: mappedWorkingFolder,
      }),
    ]);
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async ({ sourceId }) => {
        capturedSourceId = sourceId;
        return {
          ok: true,
          value: buildReingestSuccess({
            sourceId: sourceId ?? mappedWorkingFolder,
            resolvedRepositoryId: 'Owner Repo',
          }),
        };
      },
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'working-target-mapped-success',
      working_folder: hostWorkingFolder,
      source: 'REST',
    });

    assert.equal(capturedSourceId, mappedWorkingFolder);
  } finally {
    restorePathMappingEnv();
    await harness.restore();
  }
});

test('direct command target working propagates wait-time queue-read outage as command failure', async () => {
  const harness = await setupRepoCommandHarness(
    'target-working-wait-queue-unavailable',
  );

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'working-target-wait-queue-unavailable',
      items: [{ type: 'reingest', target: 'working' }],
    });
    setAgentServiceRepoList([
      buildRepoEntry({
        id: 'Owner Repo',
        containerPath: harness.repoRoot,
      }),
    ]);
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async ({ sourceId }) => ({
        ok: false,
        error: buildWaitTimeQueueUnavailableError({
          repositoryId: 'Owner Repo',
          sourceId: sourceId ?? harness.repoRoot,
        }),
      }),
      createCallId: () => 'call-working-wait-queue-unavailable',
    });

    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'working-target-wait-queue-unavailable',
          working_folder: harness.repoRoot,
          source: 'REST',
        }),
      (error) =>
        (error as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        /unavailable while waiting for re-ingest completion/i.test(
          (error as { reason?: string }).reason ?? '',
        ),
    );
  } finally {
    await harness.restore();
  }
});

test('target plan_scope fails fast until the surface passes an explicit working repository path', async () => {
  const harness = await setupRepoCommandHarness('target-plan-scope-order');
  const repoA = path.join(harness.tempRoot, 'repo-a');
  const repoB = path.join(harness.tempRoot, 'repo-b');
  const repoC = path.join(harness.tempRoot, 'repo-c');
  const messages: string[] = [];
  const calls: string[] = [];

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'plan-scope-target',
      items: [
        { type: 'reingest', target: 'plan_scope' },
        { type: 'message', role: 'user', content: ['after batch'] },
      ],
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => ({
        repos: [
          buildRepoEntry({ id: 'Repo C', containerPath: repoC }),
          buildRepoEntry({ id: 'Repo A', containerPath: repoA }),
          buildRepoEntry({ id: 'Repo B', containerPath: repoB }),
        ],
        lockedModelId: null,
      }),
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async ({ sourceId }) => {
        calls.push(sourceId ?? '(missing)');
        if (sourceId === repoB) {
          return {
            ok: false,
            error: {
              code: 503,
              message: 'QUEUE_UNAVAILABLE',
              data: {
                tool: 'reingest_repository',
                code: 'QUEUE_UNAVAILABLE',
                retryable: true,
                retryMessage: 'retry',
                reingestableRepositoryIds: [],
                reingestableSourceIds: [],
                fieldErrors: [
                  {
                    field: 'sourceId',
                    reason: 'invalid_state',
                    message:
                      'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
                  },
                ],
              },
            },
          };
        }
        return {
          ok: true,
          value: buildReingestSuccess({
            sourceId,
            resolvedRepositoryId: sourceId === repoA ? 'Repo A' : 'Repo C',
            completionMode: sourceId === repoC ? 'skipped' : 'reingested',
          }),
        };
      },
    });

    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'plan-scope-target',
          source: 'REST',
          chatFactory: () => new CapturingChat(messages),
        }),
      (error) =>
        (error as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        /target "plan_scope" requires a selected working repository path/i.test(
          (error as { reason?: string }).reason ?? '',
        ),
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(messages, []);
  } finally {
    await harness.restore();
  }
});

test('target plan_scope fails before start when the selected working repository is not currently ingested', async () => {
  const harness = await setupRepoCommandHarness(
    'target-plan-scope-not-ingested',
  );
  const messages: string[] = [];
  let reingestCalls = 0;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'plan-scope-target-not-ingested',
      items: [{ type: 'reingest', target: 'plan_scope' }],
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => ({
        repos: [],
        lockedModelId: null,
      }),
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => {
        reingestCalls += 1;
        return { ok: true, value: buildReingestSuccess() };
      },
    });

    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'plan-scope-target-not-ingested',
          working_folder: harness.repoRoot,
          source: 'REST',
          chatFactory: () => new CapturingChat(messages),
        }),
      (error) =>
        (error as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        /target "plan_scope" selected working repository is not currently ingested/i.test(
          (error as { reason?: string }).reason ?? '',
        ),
    );

    assert.equal(reingestCalls, 0);
    assert.deepEqual(messages, []);
  } finally {
    await harness.restore();
  }
});

test('direct command target plan_scope falls back to the working repository for missing and malformed handoff files', async () => {
  for (const mode of ['missing', 'malformed'] as const) {
    const harness = await setupRepoCommandHarness(`target-plan-scope-${mode}`);
    const fixture = await createPlanScopeFixture({
      tempPrefix: `commands-${mode}-`,
      workingRepositoryName: path.basename(harness.repoRoot),
      planFile:
        mode === 'missing'
          ? { mode: 'missing' }
          : { mode: 'malformed', rawText: '{"additional_repositories": [' },
    });
    const calls: string[] = [];
    const expectedWarningCode =
      mode === 'missing' ? 'handoff_missing' : 'handoff_invalid';

    try {
      await writeCommandFile({
        commandRoot: path.join(harness.agentHome, 'commands'),
        commandName: `plan-scope-${mode}`,
        items: [{ type: 'reingest', target: 'plan_scope' }],
      });
      setAgentServiceRepoList([
        buildRepoEntry({
          id: 'Owner Repo',
          containerPath: fixture.workingRepositoryPath,
        }),
      ]);
      __setAgentCommandRunnerDepsForTests({
        runReingestRepository: async ({ sourceId }) => {
          calls.push(sourceId ?? '(missing)');
          return {
            ok: true,
            value: buildReingestSuccess({
              sourceId: sourceId ?? fixture.workingRepositoryPath,
              resolvedRepositoryId: 'Owner Repo',
            }),
          };
        },
        createCallId: () => `call-plan-scope-${mode}`,
      });

      const result = await runAgentCommand({
        agentName: 'coding_agent',
        commandName: `plan-scope-${mode}`,
        working_folder: fixture.workingRepositoryPath,
        source: 'REST',
      });

      const turns = memoryTurns.get(result.conversationId) ?? [];
      const call = (
        turns[1]?.toolCalls as {
          calls?: Array<{ result?: { warnings?: Array<{ code?: string }> } }>;
        } | null
      )?.calls?.[0];
      assert.deepEqual(calls, [fixture.workingRepositoryPath]);
      assert.equal(
        (call?.result as { targetMode?: string } | undefined)?.targetMode,
        'plan_scope',
      );
      const warnings = (
        call?.result as {
          warnings?: Array<{
            code?: string;
            message?: string;
            repositoryPath?: string | null;
            resolvedRepositoryId?: string | null;
          }>;
        }
      ).warnings;
      assert.equal(warnings?.length, 1);
      assert.equal(warnings?.[0]?.code, expectedWarningCode);
      assert.equal(warnings?.[0]?.repositoryPath, fixture.currentPlanPath);
      assert.equal(warnings?.[0]?.resolvedRepositoryId ?? null, null);
      assert.match(
        warnings?.[0]?.message ?? '',
        /working repository only|falling back to the working repository only/i,
      );
    } finally {
      await fixture.cleanup();
      await harness.restore();
    }
  }
});

test('direct command target plan_scope publishes success with warnings, continues after failures, and updates transcript wording', async () => {
  const harness = await setupRepoCommandHarness('target-plan-scope-success');
  const fixture = await createPlanScopeFixture({
    tempPrefix: 'commands-plan-scope-success-',
    workingRepositoryName: path.basename(harness.repoRoot),
    additionalRepositories: [{ name: 'repo-a' }, { name: 'repo-b' }],
    planFile: { mode: 'valid' },
  });
  const validAdditionalPaths = fixture.additionalRepositoryPaths;
  const missingAdditionalPath = path.join(fixture.rootDir, 'repo-missing');
  await fs.writeFile(
    fixture.currentPlanPath,
    JSON.stringify(
      {
        plan_path:
          'planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md',
        branched_from: 'main',
        additional_repositories: [
          { path: fixture.workingRepositoryPath },
          { path: validAdditionalPaths[0] },
          { path: missingAdditionalPath },
          { path: validAdditionalPaths[1] },
        ],
      },
      null,
      2,
    ),
  );

  const app = express();
  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ws = await connectWs({ baseUrl });
  const conversationId = 'direct-command-plan-scope-success';
  const calls: string[] = [];

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'plan-scope-success',
      items: [{ type: 'reingest', target: 'plan_scope' }],
    });
    setAgentServiceRepoList([
      buildRepoEntry({
        id: 'Owner Repo',
        containerPath: fixture.workingRepositoryPath,
      }),
      buildRepoEntry({
        id: 'Repo A',
        containerPath: validAdditionalPaths[0]!,
      }),
      buildRepoEntry({
        id: 'Repo B',
        containerPath: validAdditionalPaths[1]!,
      }),
    ]);
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async ({ sourceId }) => {
        calls.push(sourceId ?? '(missing)');
        if (sourceId === validAdditionalPaths[0]) {
          return {
            ok: false,
            error: {
              code: 503,
              message: 'QUEUE_UNAVAILABLE',
              data: {
                tool: 'reingest_repository',
                code: 'QUEUE_UNAVAILABLE',
                retryable: true,
                retryMessage: 'retry later',
                reingestableRepositoryIds: ['Repo A'],
                reingestableSourceIds: [validAdditionalPaths[0]],
                fieldErrors: [
                  {
                    field: 'sourceId',
                    reason: 'invalid_state',
                    message:
                      'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
                  },
                ],
              },
            },
          };
        }
        return {
          ok: true,
          value: buildReingestSuccess({
            sourceId: sourceId ?? fixture.workingRepositoryPath,
            resolvedRepositoryId:
              sourceId === fixture.workingRepositoryPath
                ? 'Owner Repo'
                : 'Repo B',
          }),
        };
      },
      createCallId: () => 'call-plan-scope-success',
    });

    sendJson(ws, {
      type: 'subscribe_conversation',
      conversationId,
    });

    const finalPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: 'turn_final';
        conversationId: string;
        status: string;
      } => {
        const payload = event as {
          type?: string;
          conversationId?: string;
        };
        return (
          payload.type === 'turn_final' &&
          payload.conversationId === conversationId
        );
      },
      timeoutMs: 8_000,
    });

    const result = await startAgentCommand({
      agentName: 'coding_agent',
      commandName: 'plan-scope-success',
      conversationId,
      working_folder: fixture.workingRepositoryPath,
      source: 'REST',
    });

    const final = await finalPromise;
    await waitForMemoryTurns(result.conversationId, 2);

    const turns = memoryTurns.get(result.conversationId) ?? [];
    const toolCall = (
      turns[1]?.toolCalls as {
        calls?: Array<{
          stage?: string;
          result?: {
            targetMode?: string;
            repositories?: Array<{ sourceId?: string }>;
            warnings?: Array<{ code?: string }>;
          };
        }>;
      } | null
    )?.calls?.[0];

    assert.equal(final.status, 'ok');
    assert.deepEqual(calls, [
      fixture.workingRepositoryPath,
      validAdditionalPaths[0],
      validAdditionalPaths[1],
    ]);
    assert.equal(toolCall?.stage, 'success');
    assert.equal(toolCall?.result?.targetMode, 'plan_scope');
    assert.deepEqual(
      toolCall?.result?.repositories?.map((repository) => repository.sourceId),
      [
        fixture.workingRepositoryPath,
        validAdditionalPaths[0],
        validAdditionalPaths[1],
      ],
    );
    assert.deepEqual(
      toolCall?.result?.warnings?.map((warning) => warning.code),
      ['repository_skipped', 'repository_skipped', 'repository_failed'],
    );
    assert.match(
      turns[0]?.content ?? '',
      /Record re-ingest result for plan scope with warnings/i,
    );
    assert.match(
      turns[1]?.content ?? '',
      /Plan-scope re-ingest recorded for 3 repositories \(2 reingested, 0 skipped, 1 failed\)\. Warning count: 3\./i,
    );
    assert.doesNotMatch(
      `${turns[0]?.content ?? ''} ${turns[1]?.content ?? ''}`,
      /all ingested repositories/i,
    );
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await fixture.cleanup();
    await harness.restore();
  }
});

test('target plan_scope fails fast before strict execution when no working repository path is supplied', async () => {
  const harness = await setupRepoCommandHarness('target-plan-scope-empty');
  const messages: string[] = [];
  let reingestCalls = 0;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'plan-scope-target-empty',
      items: [
        { type: 'reingest', target: 'plan_scope' },
        { type: 'message', role: 'user', content: ['after empty batch'] },
      ],
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => ({
        repos: [],
        lockedModelId: null,
      }),
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => {
        reingestCalls += 1;
        return { ok: true, value: buildReingestSuccess() };
      },
    });

    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'plan-scope-target-empty',
          source: 'REST',
          chatFactory: () => new CapturingChat(messages),
        }),
      (error) =>
        (error as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        /target "plan_scope" requires a selected working repository path/i.test(
          (error as { reason?: string }).reason ?? '',
        ),
    );

    assert.equal(reingestCalls, 0);
    assert.deepEqual(messages, []);
  } finally {
    await harness.restore();
  }
});

test('target working fails before strict BUSY handling until the surface passes an explicit working repository path', async () => {
  const harness = await setupRepoCommandHarness('target-working-busy');
  let strictCalls = 0;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'working-target-busy',
      items: [{ type: 'reingest', target: 'working' }],
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => ({
        repos: [
          buildRepoEntry({
            id: 'Owner Repo',
            containerPath: harness.repoRoot,
          }),
        ],
        lockedModelId: null,
      }),
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => {
        strictCalls += 1;
        return {
          ok: false,
          error: {
            code: 503,
            message: 'QUEUE_UNAVAILABLE',
            data: {
              tool: 'reingest_repository',
              code: 'QUEUE_UNAVAILABLE',
              retryable: true,
              retryMessage: 'retry',
              reingestableRepositoryIds: ['Owner Repo'],
              reingestableSourceIds: [harness.repoRoot],
              fieldErrors: [
                {
                  field: 'sourceId',
                  reason: 'invalid_state',
                  message:
                    'Mongo-backed ingest queue is unavailable while Mongo is disconnected',
                },
              ],
            },
          },
        };
      },
    });

    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'working-target-busy',
          source: 'REST',
        }),
      (error) =>
        (error as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        /target "working" requires a selected working repository path/i.test(
          (error as { reason?: string }).reason ?? '',
        ),
    );
    assert.equal(strictCalls, 0);
  } finally {
    await harness.restore();
  }
});

test('direct command target working fails before strict execution when the surface does not provide a working repository path', async () => {
  const harness = await setupRepoCommandHarness('target-working-not-ingested');
  let strictCalls = 0;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'working-target-not-ingested',
      items: [{ type: 'reingest', target: 'working' }],
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => ({
        repos: [],
        lockedModelId: null,
      }),
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => {
        strictCalls += 1;
        return { ok: true, value: buildReingestSuccess() };
      },
    });

    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'working-target-not-ingested',
          source: 'REST',
        }),
      (error) =>
        (error as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        /target "working" requires a selected working repository path/i.test(
          (error as { reason?: string }).reason ?? '',
        ),
    );
    assert.equal(strictCalls, 0);
  } finally {
    await harness.restore();
  }
});

test('direct command target working fails before start when the selected working repository is not currently ingested', async () => {
  const harness = await setupRepoCommandHarness(
    'target-working-not-ingested-selected',
  );
  let strictCalls = 0;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'working-target-selected-not-ingested',
      items: [{ type: 'reingest', target: 'working' }],
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => ({
        repos: [],
        lockedModelId: null,
      }),
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => {
        strictCalls += 1;
        return { ok: true, value: buildReingestSuccess() };
      },
    });

    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'working-target-selected-not-ingested',
          working_folder: harness.repoRoot,
          source: 'REST',
        }),
      (error) =>
        (error as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        /target "working" selected working repository is not currently ingested/i.test(
          (error as { reason?: string }).reason ?? '',
        ),
    );
    assert.equal(strictCalls, 0);
  } finally {
    await harness.restore();
  }
});

test('direct command target working fails clearly before strict execution when host-to-workdir mapping cannot resolve a visible repository', async () => {
  const scenarios = [
    {
      name: 'outside-ingest-root',
      workingFolder: '/different-host-root/repo-owner',
    },
    {
      name: 'missing-mapped-directory',
      workingFolder: '/host/ingest/repo-owner',
    },
  ] as const;

  for (const scenario of scenarios) {
    const harness = await setupRepoCommandHarness(
      `target-working-env-failure-${scenario.name}`,
    );
    const hostIngestDir = '/host/ingest';
    const codexWorkdir = path.join(
      harness.tempRoot,
      `codex-workdir-${scenario.name}`,
    );
    let strictCalls = 0;

    try {
      setPathMappingEnv({ hostIngestDir, codexWorkdir });
      await writeCommandFile({
        commandRoot: path.join(harness.agentHome, 'commands'),
        commandName: `working-target-env-failure-${scenario.name}`,
        items: [{ type: 'reingest', target: 'working' }],
      });
      setAgentServiceRepoList([
        buildRepoEntry({
          id: 'Owner Repo',
          containerPath: path.join(codexWorkdir, 'repo-owner'),
        }),
      ]);
      __setAgentCommandRunnerDepsForTests({
        runReingestRepository: async () => {
          strictCalls += 1;
          return { ok: true, value: buildReingestSuccess() };
        },
      });

      await assert.rejects(
        async () =>
          runAgentCommand({
            agentName: 'coding_agent',
            commandName: `working-target-env-failure-${scenario.name}`,
            working_folder: scenario.workingFolder,
            source: 'REST',
          }),
        (error) =>
          (error as { code?: string; reason?: string }).code ===
            'WORKING_FOLDER_NOT_FOUND' &&
          /working_folder not found/i.test(
            (error as { reason?: string }).reason ?? '',
          ),
      );
      assert.equal(strictCalls, 0);
    } finally {
      restorePathMappingEnv();
      await harness.restore();
    }
  }
});

test('mixed reingest, markdownFile, and inline content runs preserve ordering and continuation', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-reingest-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const agentHome = await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });
  const messages: string[] = [];

  process.env.CODEINFO_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(agentHome, 'commands'),
      commandName: 'reingest-markdown-inline',
      items: [
        { type: 'reingest', sourceId: '/repo/source-a' },
        { type: 'message', role: 'user', markdownFile: 'step.md' },
        { type: 'message', role: 'user', content: ['inline'] },
      ],
    });
    await writeMarkdownFile({
      repoRoot: codeInfo2Root,
      relativePath: 'step.md',
      content: '# Step markdown\n\nBody',
    });
    setAgentServiceRepoList([
      buildRepoEntry({ id: 'repo-a', containerPath: '/repo/source-a' }),
    ]);
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => ({ repos: [] }) as never,
    });
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: true,
        value: buildReingestSuccess(),
      }),
      createCallId: () => 'call-markdown-inline',
    });

    const result = await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'reingest-markdown-inline',
      source: 'REST',
      chatFactory: () => new CapturingChat(messages),
    });

    const turns = memoryTurns.get(result.conversationId) ?? [];
    assert.deepEqual(messages, ['# Step markdown\n\nBody', 'inline']);
    assert.equal(turns.length, 6);
    assert.equal(
      (
        turns[1]?.toolCalls as {
          calls?: Array<{ callId: string }>;
        } | null
      )?.calls?.[0]?.callId,
      'call-markdown-inline',
    );
    assert.equal(turns[2]?.content, '# Step markdown\n\nBody');
    assert.equal(turns[4]?.content, 'inline');
  } finally {
    __resetAgentCommandRunnerDepsForTests();
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    memoryConversations.clear();
    memoryTurns.clear();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
