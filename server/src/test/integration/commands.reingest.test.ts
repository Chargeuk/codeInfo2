import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
import { attachWs } from '../../ws/server.js';
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

const buildRepoEntry = (params: {
  id: string;
  containerPath: string;
  lastIngestAt?: string | null;
}): RepoEntry => ({
  id: params.id,
  description: null,
  containerPath: params.containerPath,
  hostPath: `/host${params.containerPath}`,
  lastIngestAt: params.lastIngestAt ?? null,
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

  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

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

  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(agentHome, 'commands'),
      commandName: 'reingest-only-run',
      items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
    });
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
    assert.equal(conversation?.model, 'agent-model-1');
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

  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(agentHome, 'commands'),
      commandName: 'reingest-only-start',
      items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
    });
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
    assert.equal(conversation?.model, 'agent-model-1');
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
    __setAgentCommandRunnerDepsForTests({
      runReingestRepository: async () => ({
        ok: false,
        error: {
          code: 429,
          message: 'BUSY',
          data: {
            tool: 'reingest_repository',
            code: 'BUSY',
            retryable: true,
            retryMessage: 'retry later',
            reingestableRepositoryIds: ['codeinfo2'],
            reingestableSourceIds: ['/repo/source-a'],
            fieldErrors: [
              {
                field: 'sourceId',
                reason: 'busy',
                message: 'Repository is already being re-ingested',
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
      'Repository is already being re-ingested',
    );
    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.role, 'user');
    assert.equal(turns[0]?.content, 'Re-ingest repository /repo/source-a');
    assert.equal(turns[1]?.role, 'assistant');
    assert.equal(turns[1]?.status, 'failed');
    assert.equal(turns[1]?.content, 'Repository is already being re-ingested');
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

test('repo id selectors resolve to the canonical container path before direct command reingest starts', async () => {
  const harness = await setupRepoCommandHarness('selector-id');
  const selectedRoot = path.join(harness.tempRoot, 'repo-selected');
  let capturedSourceId: string | undefined;

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
      runReingestRepository: async ({ sourceId }) => {
        capturedSourceId = sourceId;
        return { ok: true, value: buildReingestSuccess({ sourceId }) };
      },
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'repo-id-selector',
      source: 'REST',
    });

    assert.equal(capturedSourceId, selectedRoot);
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

test('direct command target current resolves to the command owner repository', async () => {
  const harness = await setupRepoCommandHarness('target-current');
  let capturedSourceId: string | undefined;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'current-target',
      items: [{ type: 'reingest', target: 'current' }],
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
      runReingestRepository: async ({ sourceId }) => {
        capturedSourceId = sourceId;
        return { ok: true, value: buildReingestSuccess({ sourceId }) };
      },
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'current-target',
      source: 'REST',
    });

    assert.equal(capturedSourceId, harness.repoRoot);
  } finally {
    await harness.restore();
  }
});

test('target all executes in ascending canonical path order and continues after failures', async () => {
  const harness = await setupRepoCommandHarness('target-all-order');
  const repoA = path.join(harness.tempRoot, 'repo-a');
  const repoB = path.join(harness.tempRoot, 'repo-b');
  const repoC = path.join(harness.tempRoot, 'repo-c');
  const messages: string[] = [];
  const calls: string[] = [];

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'all-target',
      items: [
        { type: 'reingest', target: 'all' },
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
              code: 429,
              message: 'BUSY',
              data: {
                tool: 'reingest_repository',
                code: 'BUSY',
                retryable: true,
                retryMessage: 'retry',
                reingestableRepositoryIds: [],
                reingestableSourceIds: [],
                fieldErrors: [
                  {
                    field: 'sourceId',
                    reason: 'busy',
                    message:
                      'reingest is currently locked by another ingest operation',
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

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'all-target',
      source: 'REST',
      chatFactory: () => new CapturingChat(messages),
    });

    assert.deepEqual(calls, [repoA, repoB, repoC]);
    assert.deepEqual(messages, ['after batch']);
  } finally {
    await harness.restore();
  }
});

test('target all returns an empty batch without calling the strict reingest service when no repositories are ingested', async () => {
  const harness = await setupRepoCommandHarness('target-all-empty');
  const messages: string[] = [];
  let reingestCalls = 0;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'all-target-empty',
      items: [
        { type: 'reingest', target: 'all' },
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

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'all-target-empty',
      source: 'REST',
      chatFactory: () => new CapturingChat(messages),
    });

    assert.equal(reingestCalls, 0);
    assert.deepEqual(messages, ['after empty batch']);
  } finally {
    await harness.restore();
  }
});

test('target current preserves strict-service BUSY failures instead of collapsing them into a generic orchestration error', async () => {
  const harness = await setupRepoCommandHarness('target-current-busy');

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'current-target-busy',
      items: [{ type: 'reingest', target: 'current' }],
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
      runReingestRepository: async () => ({
        ok: false,
        error: {
          code: 429,
          message: 'BUSY',
          data: {
            tool: 'reingest_repository',
            code: 'BUSY',
            retryable: true,
            retryMessage: 'retry',
            reingestableRepositoryIds: ['Owner Repo'],
            reingestableSourceIds: [harness.repoRoot],
            fieldErrors: [
              {
                field: 'sourceId',
                reason: 'busy',
                message:
                  'reingest is currently locked by another ingest operation',
              },
            ],
          },
        },
      }),
    });

    await assert.rejects(
      async () =>
        runAgentCommand({
          agentName: 'coding_agent',
          commandName: 'current-target-busy',
          source: 'REST',
        }),
      (error) =>
        (error as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        (error as { code?: string; reason?: string }).reason ===
          'reingest is currently locked by another ingest operation',
    );
  } finally {
    await harness.restore();
  }
});

test('direct command target current fails before strict execution when the owner is not currently ingested', async () => {
  const harness = await setupRepoCommandHarness('target-current-not-ingested');
  let strictCalls = 0;

  try {
    await writeCommandFile({
      commandRoot: path.join(harness.agentHome, 'commands'),
      commandName: 'current-target-not-ingested',
      items: [{ type: 'reingest', target: 'current' }],
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
          commandName: 'current-target-not-ingested',
          source: 'REST',
        }),
      (error) =>
        (error as { code?: string; reason?: string }).code ===
          'COMMAND_INVALID' &&
        /owner repository is not currently ingested/i.test(
          (error as { reason?: string }).reason ?? '',
        ),
    );
    assert.equal(strictCalls, 0);
  } finally {
    await harness.restore();
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
