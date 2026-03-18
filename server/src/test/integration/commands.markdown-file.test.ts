import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
  runAgentCommand,
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
    void _model;
    this.messages.push(message);
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

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
        Description: 'markdown command',
        items: params.items,
      },
      null,
      2,
    ),
    'utf8',
  );
};

test('runAgentCommand executes local markdown-backed direct commands', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-markdown-file-'),
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
  const conversationId = 'commands-markdown-local';

  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(agentHome, 'commands'),
      commandName: 'local-markdown',
      items: [{ type: 'message', role: 'user', markdownFile: 'local.md' }],
    });
    await writeMarkdownFile({
      repoRoot: codeInfo2Root,
      relativePath: 'local.md',
      content: '# Local markdown\n\nBody',
    });
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => ({ repos: [] }) as never,
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'local-markdown',
      conversationId,
      source: 'REST',
      chatFactory: () => new CapturingChat(messages),
    });

    assert.deepEqual(messages, ['# Local markdown\n\nBody']);
  } finally {
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('runAgentCommand preserves sourceId so same-source markdown wins over codeInfo2', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-markdown-file-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const sourceRepo = path.join(tempRoot, 'repo-source');
  await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });
  const messages: string[] = [];
  const conversationId = 'commands-markdown-source-wins';

  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(
        sourceRepo,
        'codex_agents',
        'coding_agent',
        'commands',
      ),
      commandName: 'repo-markdown',
      items: [{ type: 'message', role: 'user', markdownFile: 'shared.md' }],
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
    const repoResult = {
      repos: [buildRepoEntry({ id: 'Source Repo', containerPath: sourceRepo })],
    } as never;
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => repoResult,
    });
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => repoResult,
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'repo-markdown',
      conversationId,
      source: 'REST',
      sourceId: sourceRepo,
      chatFactory: () => new CapturingChat(messages),
    });

    assert.deepEqual(messages, ['source markdown']);
  } finally {
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('runAgentCommand falls back to codeInfo2 when same-source markdown is missing', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-markdown-file-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const sourceRepo = path.join(tempRoot, 'repo-source');
  await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });
  const messages: string[] = [];
  const conversationId = 'commands-markdown-source-fallback';

  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(
        sourceRepo,
        'codex_agents',
        'coding_agent',
        'commands',
      ),
      commandName: 'repo-markdown-fallback',
      items: [{ type: 'message', role: 'user', markdownFile: 'fallback.md' }],
    });
    await writeMarkdownFile({
      repoRoot: codeInfo2Root,
      relativePath: 'fallback.md',
      content: 'codeinfo2 fallback markdown',
    });
    const repoResult = {
      repos: [buildRepoEntry({ id: 'Source Repo', containerPath: sourceRepo })],
    } as never;
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => repoResult,
    });
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => repoResult,
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'repo-markdown-fallback',
      conversationId,
      source: 'REST',
      sourceId: sourceRepo,
      chatFactory: () => new CapturingChat(messages),
    });

    assert.deepEqual(messages, ['codeinfo2 fallback markdown']);
  } finally {
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('runAgentCommand restarts markdown repository ordering from the current hop instead of sticking to the command repository winner', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-markdown-file-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const sourceRepo = path.join(tempRoot, 'repo-source');
  const workingRepo = path.join(tempRoot, 'repo-working');
  await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });
  const messages: string[] = [];
  const conversationId = 'commands-markdown-restart-order';

  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(
        sourceRepo,
        'codex_agents',
        'coding_agent',
        'commands',
      ),
      commandName: 'repo-markdown-working-restart',
      items: [{ type: 'message', role: 'user', markdownFile: 'restart.md' }],
    });
    await writeMarkdownFile({
      repoRoot: sourceRepo,
      relativePath: 'restart.md',
      content: 'owner repo markdown',
    });
    await writeMarkdownFile({
      repoRoot: workingRepo,
      relativePath: 'restart.md',
      content: 'working repo markdown',
    });
    const repoResult = {
      repos: [
        buildRepoEntry({ id: 'Working Repo', containerPath: workingRepo }),
        buildRepoEntry({ id: 'Source Repo', containerPath: sourceRepo }),
      ],
    } as never;
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => repoResult,
    });
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => repoResult,
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'repo-markdown-working-restart',
      conversationId,
      sourceId: sourceRepo,
      working_folder: workingRepo,
      source: 'REST',
      chatFactory: () => new CapturingChat(messages),
    });

    assert.deepEqual(messages, ['working repo markdown']);
  } finally {
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('runAgentCommand persists nested markdown lookup summaries into turn runtime metadata', async () => {
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commands-markdown-file-'),
  );
  const codeInfo2Root = path.join(tempRoot, 'codeinfo2');
  const agentsHome = path.join(codeInfo2Root, 'codex_agents');
  const codexHome = path.join(tempRoot, 'codex-home');
  const sourceRepo = path.join(tempRoot, 'repo-source');
  const workingRepo = path.join(tempRoot, 'repo-working');
  await writeAgentScaffold({
    agentsHome,
    agentName: 'coding_agent',
    codexHome,
  });
  const conversationId = 'commands-markdown-runtime-summary';

  process.env.CODEINFO_CODEX_AGENT_HOME = agentsHome;
  process.env.CODEINFO_CODEX_HOME = codexHome;

  try {
    await writeCommandFile({
      commandRoot: path.join(
        sourceRepo,
        'codex_agents',
        'coding_agent',
        'commands',
      ),
      commandName: 'repo-markdown-runtime',
      items: [{ type: 'message', role: 'user', markdownFile: 'runtime.md' }],
    });
    await writeMarkdownFile({
      repoRoot: sourceRepo,
      relativePath: 'runtime.md',
      content: 'owner repo markdown',
    });
    await writeMarkdownFile({
      repoRoot: workingRepo,
      relativePath: 'runtime.md',
      content: 'working repo markdown',
    });
    const repoResult = {
      repos: [
        buildRepoEntry({ id: 'Working Repo', containerPath: workingRepo }),
        buildRepoEntry({ id: 'Source Repo', containerPath: sourceRepo }),
      ],
    } as never;
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () => repoResult,
    });
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => repoResult,
    });

    await runAgentCommand({
      agentName: 'coding_agent',
      commandName: 'repo-markdown-runtime',
      conversationId,
      sourceId: sourceRepo,
      working_folder: workingRepo,
      source: 'REST',
      chatFactory: () => new CapturingChat([]),
    });

    const turns = memoryTurns.get(conversationId) ?? [];
    const markdownTurns = turns.filter(
      (turn) =>
        turn.command?.name === 'repo-markdown-runtime' &&
        turn.content === 'working repo markdown',
    );
    assert.equal(markdownTurns.length > 0, true);
    assert.equal(
      markdownTurns.every(
        (turn) =>
          turn.runtime?.lookupSummary?.selectedRepositoryPath ===
            path.resolve(workingRepo) &&
          turn.runtime?.lookupSummary?.fallbackUsed === false &&
          turn.runtime?.lookupSummary?.workingRepositoryAvailable === true,
      ),
      true,
    );
  } finally {
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
