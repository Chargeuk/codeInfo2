import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  __resetAgentCommandRunnerDepsForTests,
  __setAgentCommandRunnerDepsForTests,
} from '../../agents/commandsRunner.js';
import {
  __resetAgentServiceDepsForTests,
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
  }> = {},
) => ({
  status: 'completed' as const,
  operation: 'reembed' as const,
  runId: 'run-123',
  sourceId: '/repo/source-a',
  durationMs: 100,
  files: 3,
  chunks: 7,
  embedded: 7,
  errorCode: null,
  ...overrides,
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
            sourceId: '/repo/source-a',
            status: 'completed',
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
