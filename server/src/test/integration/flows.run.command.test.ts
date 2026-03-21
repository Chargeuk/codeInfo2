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
import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
} from '../../agents/service.js';
import { runAgentCommand } from '../../agents/service.js';
import { registerPendingConversationCancel } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __resetMarkdownFileResolverDepsForTests,
  __setMarkdownFileResolverDepsForTests,
} from '../../flows/markdownFileResolver.js';
import {
  __resetFlowServiceDepsForTests,
  __setFlowServiceDepsForTests,
} from '../../flows/service.js';
import { startFlowRun } from '../../flows/service.js';
import type { ListReposResult, RepoEntry } from '../../lmstudio/toolService.js';
import { query, resetStore } from '../../logStore.js';
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
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    const signal = (flags as { signal?: AbortSignal }).signal;
    if (signal?.aborted) {
      this.emit('error', { type: 'error', message: 'aborted' });
      return;
    }
    const delayedMatch = message.match(/^__delay:(\d+)::([\s\S]*)$/);
    if (delayedMatch) {
      await delay(Number(delayedMatch[1]));
      if (signal?.aborted) {
        this.emit('error', { type: 'error', message: 'aborted' });
        return;
      }
    }
    const response = delayedMatch ? delayedMatch[2] : 'ok';
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: response });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class FlakyOnceChat extends ChatInterface {
  constructor(private readonly counter: { count: number }) {
    super();
  }

  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _message;
    void _flags;
    void _model;
    this.counter.count += 1;
    if (this.counter.count === 1) {
      throw new Error('fail once');
    }
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class CompleteThenPauseChat extends ChatInterface {
  constructor(
    private readonly options: {
      pauseMs?: number;
      onComplete?: () => Promise<void> | void;
    } = {},
  ) {
    super();
  }

  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _message;
    void _model;
    const signal = (flags as { signal?: AbortSignal }).signal;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'almost done' });
    this.emit('complete', {
      type: 'complete',
      threadId: conversationId,
      usage: {
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
        cachedInputTokens: 6,
      },
      timing: { totalTimeSec: 0.25, tokensPerSecond: 20 },
    });
    await this.options.onComplete?.();
    await delay(this.options.pauseMs ?? 75);
    if (signal?.aborted) {
      return;
    }
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

const buildRepoEntry = (params: {
  containerPath: string;
  id?: string;
}): RepoEntry => ({
  id:
    params.id ??
    path.posix.basename(params.containerPath.replace(/\\/g, '/')) ??
    'repo',
  description: null,
  containerPath: params.containerPath,
  hostPath: params.containerPath,
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

const withFlowServer = async (
  task: (params: {
    baseUrl: string;
    wsUrl: WebSocket;
    tmpDir: string;
  }) => Promise<void>,
  options?: {
    listIngestedRepositories?: (tmpDir: string) => Promise<ListReposResult>;
    markdownReadFile?: (filePath: string) => Promise<Buffer>;
    chatFactory?: () => ChatInterface;
    flowServiceDeps?: Parameters<typeof __setFlowServiceDepsForTests>[0];
  },
) => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-cmd-'));
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;
  resetStore();

  if (options?.listIngestedRepositories) {
    __setAgentServiceDepsForTests({
      listIngestedRepositories: () => options.listIngestedRepositories!(tmpDir),
    });
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: () => options.listIngestedRepositories!(tmpDir),
      ...(options.markdownReadFile
        ? { readFile: options.markdownReadFile }
        : {}),
    });
  }
  if (options?.flowServiceDeps) {
    __setFlowServiceDepsForTests(options.flowServiceDeps);
  }

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: options?.chatFactory ?? (() => new ScriptedChat()),
          ...(options?.listIngestedRepositories
            ? {
                listIngestedRepositories: () =>
                  options.listIngestedRepositories!(tmpDir),
              }
            : {}),
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
    __resetAgentServiceDepsForTests();
    __resetMarkdownFileResolverDepsForTests();
    __resetFlowServiceDepsForTests();
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    if (prevAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    }
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

const waitForFlowFinal = async (params: {
  ws: WebSocket;
  conversationId: string;
  status: 'ok' | 'failed' | 'stopped';
  timeoutMs?: number;
}) =>
  waitForEvent({
    ws: params.ws,
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
        e.conversationId === params.conversationId &&
        e.status === params.status
      );
    },
    timeoutMs: params.timeoutMs ?? 5000,
  });

const cleanupMemory = (...conversationIds: Array<string | undefined>) => {
  conversationIds.forEach((conversationId) => {
    if (!conversationId) return;
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
};

const makeFlowCommand = (params: { commandName: string }) => ({
  description: 'repo flow command',
  steps: [
    {
      type: 'command',
      agentType: 'planning_agent',
      identifier: 'repo-agent',
      commandName: params.commandName,
    },
  ],
});

const writeRepoCommand = async (params: {
  repoRoot: string;
  commandName: string;
  content?: string;
  items?: unknown[];
  invalidSchema?: boolean;
  invalidJson?: boolean;
}) => {
  const commandDir = path.join(
    params.repoRoot,
    'codex_agents',
    'planning_agent',
    'commands',
  );
  await fs.mkdir(commandDir, { recursive: true });
  const filePath = path.join(commandDir, `${params.commandName}.json`);
  if (params.invalidJson) {
    await fs.writeFile(filePath, '{"Description": ');
    return filePath;
  }
  if (params.invalidSchema) {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        Description: 'invalid schema',
        items: [{ type: 'message', role: 'assistant', content: ['bad role'] }],
      }),
    );
    return filePath;
  }
  await fs.writeFile(
    filePath,
    JSON.stringify({
      Description: 'repo command',
      items: params.items ?? [
        {
          type: 'message',
          role: 'user',
          content: [params.content ?? 'repo step'],
        },
      ],
    }),
  );
  return filePath;
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

const writeRepoFlow = async (params: {
  repoRoot: string;
  flowName: string;
  commandName: string;
}) => {
  const flowDir = path.join(params.repoRoot, 'flows');
  await fs.mkdir(flowDir, { recursive: true });
  await fs.writeFile(
    path.join(flowDir, `${params.flowName}.json`),
    JSON.stringify(makeFlowCommand({ commandName: params.commandName })),
  );
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

test('flow-owned commands execute one markdown-backed message item', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-markdown-single');
      const commandName = 'task6_single_markdown';
      const conversationId = 'flow-command-single-markdown';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-single-markdown',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [{ type: 'message', role: 'user', markdownFile: 'single.md' }],
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'single.md',
        content: '# single markdown',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-single-markdown/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('# single markdown'),
          ),
        3000,
      );
      assert.ok(
        turns.some(
          (turn) =>
            turn.role === 'user' && turn.content.includes('# single markdown'),
        ),
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('flow-owned commands preserve order across multiple markdown-backed message items', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-markdown-multi');
      const commandName = 'task6_multi_markdown';
      const conversationId = 'flow-command-multi-markdown';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-multi-markdown',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'message', role: 'user', markdownFile: 'first.md' },
          { type: 'message', role: 'user', markdownFile: 'second.md' },
        ],
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'first.md',
        content: 'first markdown item',
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'second.md',
        content: 'second markdown item',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-multi-markdown/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.filter((turn) => turn.role === 'user').length >= 2,
        3000,
      );
      const userTurns = turns
        .filter((turn) => turn.role === 'user')
        .map((turn) => turn.content);
      assert.deepEqual(userTurns.slice(0, 2), [
        'first markdown item',
        'second markdown item',
      ]);
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('flow-owned commands keep inline content behavior when mixed with markdown-backed items', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-markdown-mixed');
      const commandName = 'task6_mixed_message_items';
      const conversationId = 'flow-command-mixed-items';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-mixed-items',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'message', role: 'user', markdownFile: 'mixed.md' },
          { type: 'message', role: 'user', content: ['inline item'] },
        ],
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'mixed.md',
        content: 'markdown item',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-mixed-items/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.filter((turn) => turn.role === 'user').length >= 2,
        3000,
      );
      const userTurns = turns
        .filter((turn) => turn.role === 'user')
        .map((turn) => turn.content);
      assert.deepEqual(userTurns.slice(0, 2), ['markdown item', 'inline item']);
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('flow-owned commands use the parent flow repository before markdown fallbacks', async () => {
  const repos: RepoEntry[] = [];
  const commandName = 'task6_same_source_markdown';
  const localMarkdownPath = path.join(
    repoRoot,
    'codeinfo_markdown',
    'shared-flow-cmd.md',
  );
  try {
    await fs.mkdir(path.dirname(localMarkdownPath), { recursive: true });
    await fs.writeFile(localMarkdownPath, 'codeinfo2 markdown', 'utf8');
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-markdown-same-source');
        const conversationId = 'flow-command-same-source-markdown';
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-same-source-markdown',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [
            {
              type: 'message',
              role: 'user',
              markdownFile: 'shared-flow-cmd.md',
            },
          ],
        });
        await writeMarkdownFile({
          repoRoot: sourceRoot,
          relativePath: 'shared-flow-cmd.md',
          content: 'same-source markdown',
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-command-same-source-markdown/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId,
          status: 'ok',
        });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('same-source markdown'),
            ),
          3000,
        );
        assert.equal(
          turns.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('codeinfo2 markdown'),
          ),
          false,
        );
        cleanupMemory(conversationId);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
      },
    );
  } finally {
    await fs.rm(localMarkdownPath, { force: true });
  }
});

test('flow-owned commands fall back through markdown repositories after a same-source miss', async () => {
  const repos: RepoEntry[] = [];
  const commandName = 'task6_markdown_fallback';
  const localMarkdownPath = path.join(
    repoRoot,
    'codeinfo_markdown',
    'fallback-flow-cmd.md',
  );
  try {
    await fs.mkdir(path.dirname(localMarkdownPath), { recursive: true });
    await fs.writeFile(
      localMarkdownPath,
      'codeinfo2 fallback markdown',
      'utf8',
    );
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-markdown-fallback');
        const conversationId = 'flow-command-markdown-fallback';
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-markdown-fallback',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [
            {
              type: 'message',
              role: 'user',
              markdownFile: 'fallback-flow-cmd.md',
            },
          ],
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-command-markdown-fallback/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId,
          status: 'ok',
        });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('codeinfo2 fallback markdown'),
            ),
          3000,
        );
        assert.ok(
          turns.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('codeinfo2 fallback markdown'),
          ),
        );
        cleanupMemory(conversationId);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
      },
    );
  } finally {
    await fs.rm(localMarkdownPath, { force: true });
  }
});

test('local codeinfo2 flows resolve commands from the selected working repository before codeinfo2', async () => {
  const repos: RepoEntry[] = [];
  const commandName = 'task2_local_flow_working_repo_first';
  const localCommandPath = path.join(
    repoRoot,
    'codex_agents',
    'planning_agent',
    'commands',
    `${commandName}.json`,
  );

  try {
    await writeRepoCommand({
      repoRoot,
      commandName,
      content: 'codeinfo2 owner command',
    });

    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const workingRoot = path.join(tmpDir, 'working-local-flow-repo');
        const conversationId = 'task2-local-flow-working-repo-first';
        await fs.writeFile(
          path.join(tmpDir, 'task2-local-flow-working-repo-first.json'),
          JSON.stringify(makeFlowCommand({ commandName })),
        );
        await writeRepoCommand({
          repoRoot: workingRoot,
          commandName,
          content: 'working repository command',
        });
        repos.push(
          buildRepoEntry({ containerPath: workingRoot, id: 'Working Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/task2-local-flow-working-repo-first/run')
          .send({
            conversationId,
            working_folder: workingRoot,
          })
          .expect(202);

        await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('working repository command'),
            ),
          3000,
        );
        assert.ok(
          turns.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('working repository command'),
          ),
        );

        const logs = query({ text: 'DEV_0000040_T11_FLOW_RESOLUTION_ORDER' });
        const selectedLog = logs.find(
          (entry) => entry.context?.decision === 'selected',
        );
        const orderLogs = query({
          text: 'DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER',
        });
        assert.equal(
          selectedLog?.context?.selectedRepositoryPath,
          path.resolve(workingRoot),
        );
        assert.equal(selectedLog?.context?.fallbackUsed, false);
        assert.equal(selectedLog?.context?.workingRepositoryAvailable, true);
        assert.equal(orderLogs.length, 2);
        for (const orderLog of orderLogs) {
          assert.deepEqual(orderLog?.context, {
            referenceType: 'commandFile',
            caller: 'flow-command',
            workingRepositoryAvailable: true,
            candidateRepositories: [
              {
                sourceId: path.resolve(workingRoot),
                sourceLabel: 'working-local-flow-repo',
                slot: 'working_repository',
              },
              {
                sourceId: path.resolve(repoRoot),
                sourceLabel: 'codeInfo2',
                slot: 'owner_repository',
              },
            ],
          });
        }
        cleanupMemory(conversationId);
      },
      {
        listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
      },
    );
  } finally {
    await fs.rm(localCommandPath, { force: true });
  }
});

test('cross-repo flows resolve commands from the selected working repository before the flow owner', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'task2-source-repo');
      const workingRoot = path.join(tmpDir, 'task2-working-repo');
      const commandName = 'task2_cross_repo_working_repo_first';
      const conversationId = 'task2-cross-repo-working-repo-first';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'task2-cross-repo-working-repo-first',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        content: 'owner repository command',
      });
      await writeRepoCommand({
        repoRoot: workingRoot,
        commandName,
        content: 'working repository command',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Owner Repo' }),
        buildRepoEntry({ containerPath: workingRoot, id: 'Working Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-cross-repo-working-repo-first/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
          working_folder: workingRoot,
        })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('working repository command'),
          ),
        3000,
      );
      assert.ok(
        turns.some(
          (turn) =>
            turn.role === 'user' &&
            turn.content.includes('working repository command'),
        ),
      );

      const logs = query({ text: 'DEV_0000040_T11_FLOW_RESOLUTION_ORDER' });
      const selectedLog = logs.find(
        (entry) => entry.context?.decision === 'selected',
      );
      assert.equal(
        selectedLog?.context?.selectedRepositoryPath,
        path.resolve(workingRoot),
      );
      assert.equal(selectedLog?.context?.fallbackUsed, false);
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
    },
  );
});

test('command resolution skips the working slot cleanly when no working repository is available', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'task2-owner-without-working');
      const otherRoot = path.join(tmpDir, 'task2-other-repo');
      const commandName = 'task2_missing_working_repo';
      const conversationId = 'task2-missing-working-repo';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'task2-missing-working-repo',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        content: 'owner repository command',
      });
      await writeRepoCommand({
        repoRoot: otherRoot,
        commandName,
        content: 'other repository command',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Owner Repo' }),
        buildRepoEntry({ containerPath: otherRoot, id: 'Other Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-missing-working-repo/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const logs = query({ text: 'DEV_0000040_T11_FLOW_RESOLUTION_ORDER' });
      const selectedLog = logs.find(
        (entry) => entry.context?.decision === 'selected',
      );
      const candidateRepositories = Array.isArray(
        selectedLog?.context?.candidateRepositories,
      )
        ? (selectedLog.context.candidateRepositories as Array<{ slot: string }>)
        : [];
      assert.equal(selectedLog?.context?.workingRepositoryAvailable, false);
      assert.equal(
        selectedLog?.context?.selectedRepositoryPath,
        path.resolve(sourceRoot),
      );
      assert.deepEqual(
        candidateRepositories.map((item) => item.slot),
        ['owner_repository', 'codeinfo2', 'other_repository'],
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
    },
  );
});

test('command resolution dedupes duplicate working and owner repositories', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'task2-dedupe-working-owner');
      const commandName = 'task2_dedupe_working_owner';
      const conversationId = 'task2-dedupe-working-owner';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'task2-dedupe-working-owner',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        content: 'single repository command',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-dedupe-working-owner/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
          working_folder: sourceRoot,
        })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const logs = query({ text: 'DEV_0000040_T11_FLOW_RESOLUTION_ORDER' });
      const selectedLog = logs.find(
        (entry) => entry.context?.decision === 'selected',
      );
      const candidateRepositories = Array.isArray(
        selectedLog?.context?.candidateRepositories,
      )
        ? (selectedLog.context.candidateRepositories as Array<{
            sourceId: string;
            slot: string;
          }>)
        : [];
      const matchingCandidates =
        candidateRepositories.filter(
          (item) => item.sourceId === path.resolve(sourceRoot),
        ) ?? [];
      assert.equal(matchingCandidates.length, 1);
      assert.equal(matchingCandidates[0]?.slot, 'working_repository');
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
    },
  );
});

test('command resolution dedupes duplicate working and local codeinfo2 repositories', async () => {
  const commandName = 'task2_dedupe_working_codeinfo2';
  const localCommandPath = path.join(
    repoRoot,
    'codex_agents',
    'planning_agent',
    'commands',
    `${commandName}.json`,
  );

  try {
    await writeRepoCommand({
      repoRoot,
      commandName,
      content: 'codeinfo2 repository command',
    });

    await withFlowServer(async ({ baseUrl, wsUrl, tmpDir }) => {
      const conversationId = 'task2-dedupe-working-codeinfo2';
      await fs.writeFile(
        path.join(tmpDir, 'task2-dedupe-working-codeinfo2.json'),
        JSON.stringify(makeFlowCommand({ commandName })),
      );
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-dedupe-working-codeinfo2/run')
        .send({
          conversationId,
          working_folder: repoRoot,
        })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const logs = query({ text: 'DEV_0000040_T11_FLOW_RESOLUTION_ORDER' });
      const selectedLog = logs.find(
        (entry) => entry.context?.decision === 'selected',
      );
      const candidateRepositories = Array.isArray(
        selectedLog?.context?.candidateRepositories,
      )
        ? (selectedLog.context.candidateRepositories as Array<{
            sourceId: string;
            slot: string;
          }>)
        : [];
      const matchingCandidates =
        candidateRepositories.filter(
          (item) => item.sourceId === path.resolve(repoRoot),
        ) ?? [];
      assert.equal(matchingCandidates.length, 1);
      assert.equal(matchingCandidates[0]?.slot, 'working_repository');
      cleanupMemory(conversationId);
    });
  } finally {
    await fs.rm(localCommandPath, { force: true });
  }
});

test('flow-owned command turns persist lookupSummary runtime metadata', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'task2-runtime-owner');
      const workingRoot = path.join(tmpDir, 'task2-runtime-working');
      const commandName = 'task2_runtime_lookup_summary';
      const conversationId = 'task2-runtime-lookup-summary';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'task2-runtime-lookup-summary',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        content: 'owner repository command',
      });
      await writeRepoCommand({
        repoRoot: workingRoot,
        commandName,
        content: 'working repository command',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Owner Repo' }),
        buildRepoEntry({ containerPath: workingRoot, id: 'Working Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/task2-runtime-lookup-summary/run')
        .send({
          conversationId,
          sourceId: sourceRoot,
          working_folder: workingRoot,
        })
        .expect(202);

      await waitForFlowFinal({ ws: wsUrl, conversationId, status: 'ok' });
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.runtime?.lookupSummary?.selectedRepositoryPath ===
              path.resolve(workingRoot),
          ),
        3000,
      );
      const commandTurns = turns.filter(
        (turn) =>
          turn.command?.name === 'flow' &&
          turn.runtime?.lookupSummary?.selectedRepositoryPath ===
            path.resolve(workingRoot),
      );
      assert.equal(commandTurns.length > 0, true);
      assert.equal(
        commandTurns[0]?.runtime?.lookupSummary?.fallbackUsed,
        false,
      );
      assert.equal(
        commandTurns[0]?.runtime?.lookupSummary?.workingRepositoryAvailable,
        true,
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
    },
  );
});

test('flow-owned commands fail fast when a higher-priority markdown file is unreadable', async () => {
  const repos: RepoEntry[] = [];
  const commandName = 'task6_markdown_unreadable';
  const localMarkdownPath = path.join(
    repoRoot,
    'codeinfo_markdown',
    'unreadable-flow-cmd.md',
  );
  let sourceMarkdownPath = '';
  try {
    await fs.mkdir(path.dirname(localMarkdownPath), { recursive: true });
    await fs.writeFile(
      localMarkdownPath,
      'codeinfo2 fallback should not run',
      'utf8',
    );
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-markdown-unreadable');
        const conversationId = 'flow-command-markdown-unreadable';
        sourceMarkdownPath = await writeMarkdownFile({
          repoRoot: sourceRoot,
          relativePath: 'unreadable-flow-cmd.md',
          content: 'source markdown',
        });
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-markdown-unreadable',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [
            {
              type: 'message',
              role: 'user',
              markdownFile: 'unreadable-flow-cmd.md',
            },
          ],
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-command-markdown-unreadable/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId,
          status: 'failed',
        });
        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) => turn.role === 'assistant' && turn.status === 'failed',
            ),
          3000,
        );
        const failedTurn = turns.find(
          (turn) => turn.role === 'assistant' && turn.status === 'failed',
        );
        assert.ok(failedTurn);
        assert.match(failedTurn.content, /permission denied/);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
        markdownReadFile: async (filePath) => {
          if (filePath === sourceMarkdownPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
          }
          return fs.readFile(filePath);
        },
      },
    );
  } finally {
    await fs.rm(localMarkdownPath, { force: true });
  }
});

test('flow-owned command message execution matches the direct-command path for the same markdown-backed command', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-parity');
      const commandName = 'task6_parity_markdown';
      const flowConversationId = 'flow-command-parity';
      const directConversationId = 'direct-command-parity';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-parity-markdown',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'message', role: 'user', markdownFile: 'parity.md' },
          { type: 'message', role: 'user', content: ['inline parity'] },
        ],
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'parity.md',
        content: 'shared markdown parity',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, {
        type: 'subscribe_conversation',
        conversationId: flowConversationId,
      });
      await supertest(baseUrl)
        .post('/flows/repo-command-parity-markdown/run')
        .send({ conversationId: flowConversationId, sourceId: sourceRoot })
        .expect(202);
      await waitForFlowFinal({
        ws: wsUrl,
        conversationId: flowConversationId,
        status: 'ok',
      });

      await runAgentCommand({
        agentName: 'planning_agent',
        commandName,
        conversationId: directConversationId,
        sourceId: sourceRoot,
        source: 'REST',
        chatFactory: () => new ScriptedChat(),
      });

      const flowTurns = await waitForTurns(
        flowConversationId,
        (items) => items.filter((turn) => turn.role === 'user').length >= 2,
        3000,
      );
      const directTurns = await waitForTurns(
        directConversationId,
        (items) => items.filter((turn) => turn.role === 'user').length >= 2,
        3000,
      );
      assert.deepEqual(
        flowTurns
          .filter((turn) => turn.role === 'user')
          .map((turn) => turn.content),
        directTurns
          .filter((turn) => turn.role === 'user')
          .map((turn) => turn.content),
      );
      cleanupMemory(flowConversationId, directConversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('flow command-step retries and direct-command retries remain unchanged after shared message-item extraction', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  const repos: RepoEntry[] = [];
  const flowAttempts = { count: 0 };
  const directAttempts = { count: 0 };
  try {
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-command-retry-shared');
        const commandName = 'task6_retry_markdown';
        const flowConversationId = 'flow-command-retry-shared';
        const directConversationId = 'direct-command-retry-shared';
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-retry-shared',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [{ type: 'message', role: 'user', markdownFile: 'retry.md' }],
        });
        await writeMarkdownFile({
          repoRoot: sourceRoot,
          relativePath: 'retry.md',
          content: 'retry markdown item',
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, {
          type: 'subscribe_conversation',
          conversationId: flowConversationId,
        });
        await supertest(baseUrl)
          .post('/flows/repo-command-retry-shared/run')
          .send({ conversationId: flowConversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId: flowConversationId,
          status: 'ok',
          timeoutMs: 6000,
        });
        assert.equal(flowAttempts.count, 2);

        await runAgentCommand({
          agentName: 'planning_agent',
          commandName,
          conversationId: directConversationId,
          sourceId: sourceRoot,
          source: 'REST',
          chatFactory: () => new FlakyOnceChat(directAttempts),
        });
        assert.equal(directAttempts.count, 2);
        cleanupMemory(flowConversationId, directConversationId);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
        chatFactory: () => new FlakyOnceChat(flowAttempts),
      },
    );
  } finally {
    if (previousRetries === undefined) {
      delete process.env.FLOW_AND_COMMAND_RETRIES;
    } else {
      process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
    }
  }
});

test('flow-owned commands can execute reingest items', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-reingest-basic');
      const commandName = 'task11_reingest_basic';
      const conversationId = 'flow-command-reingest-basic';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-reingest-basic',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-reingest-basic/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.length >= 2,
        4000,
      );
      assert.equal(turns[0]?.role, 'user');
      assert.equal(turns[1]?.role, 'assistant');
      assert.equal(
        (
          turns[1]?.toolCalls as {
            calls?: Array<{ result?: { kind?: string; status?: string } }>;
          } | null
        )?.calls?.[0]?.result?.kind,
        'reingest_step_result',
      );
      assert.equal(
        (
          turns[1]?.toolCalls as {
            calls?: Array<{ result?: { status?: string } }>;
          } | null
        )?.calls?.[0]?.result?.status,
        'completed',
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async () => ({
          ok: true,
          value: buildReingestSuccess(),
        }),
        createCallId: () => 'call-flow-basic',
      },
    },
  );
});

test('top-level flow target current resolves to the flow owner repository', async () => {
  const repos: RepoEntry[] = [];
  let capturedSourceId: string | undefined;

  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-flow-current');
      const conversationId = 'flow-target-current';
      await fs.mkdir(path.join(sourceRoot, 'flows'), { recursive: true });
      await fs.writeFile(
        path.join(sourceRoot, 'flows', 'repo-flow-current.json'),
        JSON.stringify({
          description: 'flow current target',
          steps: [{ type: 'reingest', target: 'current' }],
        }),
      );
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-flow-current/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      assert.equal(capturedSourceId, sourceRoot);
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async ({ sourceId }) => {
          capturedSourceId = sourceId;
          return {
            ok: true,
            value: buildReingestSuccess({ sourceId }),
          };
        },
      },
    },
  );
});

test('flow-owned command target current resolves to the command owner repository', async () => {
  const repos: RepoEntry[] = [];
  let capturedSourceId: string | undefined;

  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-current');
      const commandName = 'task11_reingest_current';
      const conversationId = 'flow-command-target-current';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-current',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [{ type: 'reingest', target: 'current' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-current/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      assert.equal(capturedSourceId, sourceRoot);
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async ({ sourceId }) => {
          capturedSourceId = sourceId;
          return {
            ok: true,
            value: buildReingestSuccess({ sourceId }),
          };
        },
      },
    },
  );
});

test('top-level flow target current fails fast when there is no owning repository path', async () => {
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const conversationId = 'flow-target-current-missing-owner';
      await fs.writeFile(
        path.join(tmpDir, 'flow-current-missing-owner.json'),
        JSON.stringify({
          description: 'missing owner',
          steps: [{ type: 'reingest', target: 'current' }],
        }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/flow-current-missing-owner/run')
        .send({ conversationId })
        .expect(202);

      const final = (await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'failed',
      })) as { error?: { message?: string } };
      assert.match(
        final.error?.message ?? '',
        /target "current" requires an owning repository path/i,
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos: [],
        lockedModelId: null,
      }),
    },
  );
});

test('flow-owned command reingest results publish live tool_event updates', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-reingest-live');
      const commandName = 'task11_reingest_live';
      const conversationId = 'flow-command-reingest-live';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-reingest-live',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-reingest-live/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      const event = await waitForEvent({
        ws: wsUrl,
        predicate: (
          raw: unknown,
        ): raw is {
          type: 'tool_event';
          conversationId: string;
          event: {
            type: 'tool-result';
            callId: string;
            name: string;
            result?: { kind?: string; status?: string };
          };
        } => {
          const candidate = raw as {
            type?: string;
            conversationId?: string;
            event?: {
              type?: string;
              callId?: string;
              name?: string;
              result?: { kind?: string; status?: string };
            };
          };
          return (
            candidate.type === 'tool_event' &&
            candidate.conversationId === conversationId &&
            candidate.event?.type === 'tool-result' &&
            candidate.event?.name === 'reingest_repository'
          );
        },
        timeoutMs: 5000,
      });

      assert.equal(event.event.callId, 'call-flow-live');
      assert.equal(event.event.result?.kind, 'reingest_step_result');
      assert.equal(event.event.result?.status, 'completed');
      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async () => ({
          ok: true,
          value: buildReingestSuccess(),
        }),
        createCallId: () => 'call-flow-live',
      },
    },
  );
});

test('flow-owned command reingest results persist through assistant toolCalls storage', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-reingest-persisted');
      const commandName = 'task11_reingest_persisted';
      const conversationId = 'flow-command-reingest-persisted';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-reingest-persisted',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [{ type: 'reingest', sourceId: '/repo/source-a' }],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-reingest-persisted/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.length >= 2,
        4000,
      );
      assert.deepEqual(turns[1]?.toolCalls, {
        calls: [
          {
            type: 'tool-result',
            callId: 'call-flow-persisted',
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
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async () => ({
          ok: true,
          value: buildReingestSuccess(),
        }),
        createCallId: () => 'call-flow-persisted',
      },
    },
  );
});

test('repeated flow-owned command reingest items keep distinct callIds', async () => {
  const callIds = ['call-flow-a', 'call-flow-b'];
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-reingest-double');
      const commandName = 'task11_reingest_double';
      const conversationId = 'flow-command-reingest-double';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-reingest-double',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'reingest', sourceId: '/repo/source-a' },
        ],
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-reingest-double/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.filter((turn) => turn.role === 'assistant').length >= 2,
        4000,
      );
      assert.deepEqual(
        turns
          .filter((turn) => turn.role === 'assistant')
          .map(
            (turn) =>
              (
                turn.toolCalls as {
                  calls?: Array<{ callId: string }>;
                } | null
              )?.calls?.[0]?.callId,
          ),
        ['call-flow-a', 'call-flow-b'],
      );
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
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
      },
    },
  );
});

test('flow-owned commands preserve ordering across reingest, markdown, and inline items', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-command-reingest-mixed');
      const commandName = 'task11_reingest_markdown_inline';
      const conversationId = 'flow-command-reingest-mixed';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-reingest-mixed',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        items: [
          { type: 'reingest', sourceId: '/repo/source-a' },
          { type: 'message', role: 'user', markdownFile: 'step.md' },
          { type: 'message', role: 'user', content: ['inline'] },
        ],
      });
      await writeMarkdownFile({
        repoRoot: sourceRoot,
        relativePath: 'step.md',
        content: '# Step markdown\n\nBody',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
      );

      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-reingest-mixed/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForFlowFinal({
        ws: wsUrl,
        conversationId,
        status: 'ok',
      });
      const turns = await waitForTurns(
        conversationId,
        (items) => items.length >= 6,
        4000,
      );
      assert.equal(
        (
          turns[1]?.toolCalls as {
            calls?: Array<{ callId: string }>;
          } | null
        )?.calls?.[0]?.callId,
        'call-flow-mixed',
      );
      assert.equal(turns[2]?.content, '# Step markdown\n\nBody');
      assert.equal(turns[4]?.content, 'inline');
      cleanupMemory(conversationId);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
      flowServiceDeps: {
        runReingestRepository: async () => ({
          ok: true,
          value: buildReingestSuccess(),
        }),
        createCallId: () => 'call-flow-mixed',
      },
    },
  );
});

test('cancellation during flow-owned command reingest stops later items and later flow steps', async () => {
  const commandName = 'task11_reingest_stop';
  const conversationId = 'flow-command-reingest-stop';
  const localCommandPath = path.join(
    repoRoot,
    'codex_agents',
    'planning_agent',
    'commands',
    `${commandName}.json`,
  );
  let resolveRun!: (value: {
    ok: true;
    value: ReturnType<typeof buildReingestSuccess>;
  }) => void;
  let markStarted!: () => void;
  let runToken = '';
  const runPromise = new Promise<{
    ok: true;
    value: ReturnType<typeof buildReingestSuccess>;
  }>((resolve) => {
    resolveRun = resolve;
  });
  const startedPromise = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  try {
    await writeRepoCommand({
      repoRoot,
      commandName,
      items: [
        { type: 'reingest', sourceId: '/repo/source-a' },
        { type: 'message', role: 'user', content: ['after command item'] },
      ],
    });
    await withFlowServer(
      async ({ wsUrl, tmpDir }) => {
        const flowName = 'repo-command-reingest-stop';
        await fs.writeFile(
          path.join(tmpDir, `${flowName}.json`),
          JSON.stringify({
            description: 'stop after flow command reingest',
            steps: [
              {
                type: 'command',
                agentType: 'planning_agent',
                identifier: 'repo-agent',
                commandName,
              },
              {
                type: 'llm',
                agentType: 'planning_agent',
                identifier: 'after-stop',
                messages: [{ role: 'user', content: ['after flow step'] }],
              },
            ],
          }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await startFlowRun({
          flowName,
          conversationId,
          source: 'REST',
          chatFactory: () => new ScriptedChat(),
          onOwnershipReady: ({ runToken: token }) => {
            runToken = token;
          },
        });

        await startedPromise;
        resolveRun({
          ok: true,
          value: buildReingestSuccess(),
        });

        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) => turn.role === 'assistant' && turn.status === 'stopped',
            ) &&
            items.some((turn) => turn.role === 'assistant' && turn.toolCalls),
          4000,
        );
        await delay(150);
        assert.equal(
          turns.some((turn) => turn.role === 'assistant' && turn.toolCalls),
          true,
        );
        assert.equal(
          turns.some(
            (turn) => turn.role === 'assistant' && turn.status === 'stopped',
          ),
          true,
        );
        assert.equal(
          turns.some((turn) => turn.content.includes('after command item')),
          false,
        );
        assert.equal(
          turns.some((turn) => turn.content.includes('after flow step')),
          false,
        );
        assert.equal(
          (memoryTurns.get(conversationId) ?? []).some(
            (turn) => turn.role === 'assistant' && turn.status === 'stopped',
          ),
          true,
        );
        cleanupMemory(conversationId);
      },
      {
        flowServiceDeps: {
          runReingestRepository: async () => {
            markStarted();
            const runTokenDeadline = Date.now() + 1000;
            while (!runToken && Date.now() < runTokenDeadline) {
              await delay(10);
            }
            assert.notEqual(runToken, '');
            registerPendingConversationCancel({
              conversationId,
              runToken,
            });
            return runPromise;
          },
          createCallId: () => 'call-flow-stop',
        },
      },
    );
  } finally {
    await fs.rm(localCommandPath, { force: true });
  }
});

test('flow-owned command message retries remain intact after adding reingest support', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  const flowAttempts = { count: 0 };
  const repos: RepoEntry[] = [];
  try {
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-command-retry-task11');
        const commandName = 'task11_message_retry';
        const conversationId = 'flow-command-retry-task11';
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-retry-task11',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [{ type: 'message', role: 'user', content: ['retry me'] }],
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-command-retry-task11/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForFlowFinal({
          ws: wsUrl,
          conversationId,
          status: 'ok',
          timeoutMs: 6000,
        });
        assert.equal(flowAttempts.count, 2);
        cleanupMemory(conversationId);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
        chatFactory: () => new FlakyOnceChat(flowAttempts),
      },
    );
  } finally {
    if (previousRetries === undefined) {
      delete process.env.FLOW_AND_COMMAND_RETRIES;
    } else {
      process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
    }
  }
});

test('flow-owned command reingest items stay single-attempt while later message items can retry', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  const flowAttempts = { count: 0 };
  let reingestCalls = 0;
  const repos: RepoEntry[] = [];
  try {
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'repo-command-reingest-retry');
        const commandName = 'task11_reingest_then_retry';
        const conversationId = 'flow-command-reingest-retry';
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-reingest-retry',
          commandName,
        });
        await writeRepoCommand({
          repoRoot: sourceRoot,
          commandName,
          items: [
            { type: 'reingest', sourceId: '/repo/source-a' },
            {
              type: 'message',
              role: 'user',
              content: ['retry after reingest'],
            },
          ],
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
        await supertest(baseUrl)
          .post('/flows/repo-command-reingest-retry/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForTurns(conversationId, (items) => items.length >= 4, 6000);
        assert.equal(reingestCalls, 1);
        assert.equal(flowAttempts.count, 2);
        cleanupMemory(conversationId);
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
        chatFactory: () => new FlakyOnceChat(flowAttempts),
        flowServiceDeps: {
          runReingestRepository: async () => {
            reingestCalls += 1;
            return {
              ok: true,
              value: buildReingestSuccess(),
            };
          },
          createCallId: () => 'call-flow-retry',
        },
      },
    );
  } finally {
    if (previousRetries === undefined) {
      delete process.env.FLOW_AND_COMMAND_RETRIES;
    } else {
      process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
    }
  }

  const logs = query(
    { text: 'DEV-0000045:T11:flow_command_reingest_recorded' },
    10,
  );
  assert.equal(
    logs.some(
      (item) =>
        item.message === 'DEV-0000045:T11:flow_command_reingest_recorded',
    ),
    true,
  );
});

test('RED: repository flow should resolve same-source command before fallback ordering', async () => {
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'repo-source');
      const sourceCommandDir = path.join(
        sourceRoot,
        'codex_agents',
        'planning_agent',
        'commands',
      );
      const sourceFlowDir = path.join(sourceRoot, 'flows');
      await fs.mkdir(sourceCommandDir, { recursive: true });
      await fs.mkdir(sourceFlowDir, { recursive: true });

      await fs.writeFile(
        path.join(sourceCommandDir, 'source_only_command.json'),
        JSON.stringify({
          Description: 'repo command',
          items: [{ type: 'message', role: 'user', content: ['repo step'] }],
        }),
      );
      await fs.writeFile(
        path.join(sourceFlowDir, 'repo-command.json'),
        JSON.stringify({
          description: 'repo flow command',
          steps: [
            {
              type: 'command',
              agentType: 'planning_agent',
              identifier: 'repo-agent',
              commandName: 'source_only_command',
            },
          ],
        }),
      );

      const conversationId = 'flow-command-source-order-red';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/repo-command/run')
        .send({ conversationId, sourceId: sourceRoot })
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
        timeoutMs: 5000,
      });
      assert.equal(final.status, 'ok');
    },
    {
      listIngestedRepositories: async (tmpDir) => ({
        repos: [
          buildRepoEntry({ containerPath: path.join(tmpDir, 'repo-source') }),
        ],
        lockedModelId: null,
      }),
    },
  );
});

test('same-source missing command falls back to codeInfo2 repository', async () => {
  const commandName = 'task11_codeinfo2_fallback_command';
  const localCommandPath = path.join(
    repoRoot,
    'codex_agents',
    'planning_agent',
    'commands',
    `${commandName}.json`,
  );

  await writeRepoCommand({
    repoRoot: repoRoot,
    commandName,
    content: 'codeinfo2 fallback step',
  });

  try {
    const repos: RepoEntry[] = [];
    await withFlowServer(
      async ({ baseUrl, wsUrl, tmpDir }) => {
        const sourceRoot = path.join(tmpDir, 'source-repo');
        await writeRepoFlow({
          repoRoot: sourceRoot,
          flowName: 'repo-command-codeinfo2',
          commandName,
        });
        repos.push(
          buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        );

        const conversationId = 'flow-command-codeinfo2-fallback';
        sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

        await supertest(baseUrl)
          .post('/flows/repo-command-codeinfo2/run')
          .send({ conversationId, sourceId: sourceRoot })
          .expect(202);

        await waitForEvent({
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
          timeoutMs: 5000,
        });

        const turns = await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('codeinfo2 fallback step'),
            ),
          3000,
        );
        assert.ok(
          turns.some(
            (turn) =>
              turn.role === 'user' &&
              turn.content.includes('codeinfo2 fallback step'),
          ),
        );
      },
      {
        listIngestedRepositories: async () => ({
          repos,
          lockedModelId: null,
        }),
      },
    );
  } finally {
    await fs.rm(localCommandPath, { force: true });
  }
});

test('other repositories preserve caller-supplied order instead of sorting by label', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo');
      const otherA = path.join(tmpDir, 'alpha-repo');
      const otherB = path.join(tmpDir, 'beta-repo');
      const commandName = 'task11_ordered_other_repo_command';

      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-other-order',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: otherA,
        commandName,
        content: 'other-alpha',
      });
      await writeRepoCommand({
        repoRoot: otherB,
        commandName,
        content: 'other-beta',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherB, id: 'Zulu' }),
        buildRepoEntry({ containerPath: otherA, id: 'Alpha' }),
      );

      const conversationId = 'flow-command-other-order';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/repo-command-other-order/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForEvent({
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
        timeoutMs: 5000,
      });

      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' && turn.content.includes('other-beta'),
          ),
        3000,
      );
      assert.ok(
        turns.some(
          (turn) => turn.role === 'user' && turn.content.includes('other-beta'),
        ),
      );
      assert.equal(
        turns.some(
          (turn) =>
            turn.role === 'user' && turn.content.includes('other-alpha'),
        ),
        false,
      );
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('same-source schema-invalid command fails fast without fallback', async () => {
  const commandName = 'task11_schema_invalid';
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-invalid');
      const otherRoot = path.join(tmpDir, 'other-repo-valid');
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-invalid-same-source',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        invalidSchema: true,
      });
      await writeRepoCommand({
        repoRoot: otherRoot,
        commandName,
        content: 'fallback should not run',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherRoot, id: 'Other Repo' }),
      );

      const res = await supertest(baseUrl)
        .post('/flows/repo-command-invalid-same-source/run')
        .send({ sourceId: sourceRoot })
        .expect(400);
      assert.equal(res.body.error, 'invalid_request');
      assert.match(String(res.body.message ?? ''), /schema validation/i);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('same-source parse failure fails fast without fallback', async () => {
  const commandName = 'task11_parse_invalid';
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-parse');
      const otherRoot = path.join(tmpDir, 'other-repo-parse');
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-parse-invalid',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: sourceRoot,
        commandName,
        invalidJson: true,
      });
      await writeRepoCommand({
        repoRoot: otherRoot,
        commandName,
        content: 'parse fallback should not run',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherRoot, id: 'Other Repo' }),
      );

      const res = await supertest(baseUrl)
        .post('/flows/repo-command-parse-invalid/run')
        .send({ sourceId: sourceRoot })
        .expect(400);
      assert.equal(res.body.error, 'invalid_request');
      assert.match(String(res.body.message ?? ''), /schema validation/i);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('command not found across all candidates fails deterministically', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-none');
      const otherRoot = path.join(tmpDir, 'other-repo-none');
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-all-missing',
        commandName: 'missing_everywhere',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherRoot, id: 'Other Repo' }),
      );

      const res = await supertest(baseUrl)
        .post('/flows/repo-command-all-missing/run')
        .send({ sourceId: sourceRoot })
        .expect(400);
      assert.equal(res.body.error, 'invalid_request');
      assert.match(String(res.body.message ?? ''), /not found/i);
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('other-repo ordering preserves caller order even when sourceLabel has whitespace', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-trim');
      const otherA = path.join(tmpDir, 'trim-a');
      const otherB = path.join(tmpDir, 'trim-b');
      const commandName = 'task11_trimmed_label';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-trim-label',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: otherA,
        commandName,
        content: 'trim-a',
      });
      await writeRepoCommand({
        repoRoot: otherB,
        commandName,
        content: 'trim-b',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherB, id: '  Zeta  ' }),
        buildRepoEntry({ containerPath: otherA, id: '  Alpha  ' }),
      );

      const conversationId = 'flow-command-trim-order';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-trim-label/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForEvent({
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
        timeoutMs: 5000,
      });
      const turns = memoryTurns.get(conversationId) ?? [];
      assert.ok(
        turns.some(
          (turn) => turn.role === 'user' && turn.content.includes('trim-b'),
        ),
      );
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('other-repo ordering preserves caller order when sourceLabel falls back to basename', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-basename');
      const otherA = path.join(tmpDir, 'aaa-basename');
      const otherB = path.join(tmpDir, 'zzz-basename');
      const commandName = 'task11_basename_label';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-basename-label',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: otherA,
        commandName,
        content: 'basename-a',
      });
      await writeRepoCommand({
        repoRoot: otherB,
        commandName,
        content: 'basename-b',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherB, id: ' ' }),
        buildRepoEntry({ containerPath: otherA, id: '' }),
      );

      const conversationId = 'flow-command-basename-order';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-basename-label/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForEvent({
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
        timeoutMs: 5000,
      });
      const turns = memoryTurns.get(conversationId) ?? [];
      assert.ok(
        turns.some(
          (turn) => turn.role === 'user' && turn.content.includes('basename-b'),
        ),
      );
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
});

test('other-repo ordering preserves caller order when labels only differ by case', async () => {
  const repos: RepoEntry[] = [];
  await withFlowServer(
    async ({ baseUrl, wsUrl, tmpDir }) => {
      const sourceRoot = path.join(tmpDir, 'source-repo-path-tie');
      const otherA = path.join(tmpDir, 'aaa-tie');
      const otherB = path.join(tmpDir, 'bbb-tie');
      const commandName = 'task11_path_tie';
      await writeRepoFlow({
        repoRoot: sourceRoot,
        flowName: 'repo-command-path-tie',
        commandName,
      });
      await writeRepoCommand({
        repoRoot: otherA,
        commandName,
        content: 'tie-a',
      });
      await writeRepoCommand({
        repoRoot: otherB,
        commandName,
        content: 'tie-b',
      });
      repos.push(
        buildRepoEntry({ containerPath: sourceRoot, id: 'Source Repo' }),
        buildRepoEntry({ containerPath: otherB, id: 'same-label' }),
        buildRepoEntry({ containerPath: otherA, id: 'SAME-LABEL' }),
      );

      const conversationId = 'flow-command-path-tie-order';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/repo-command-path-tie/run')
        .send({ conversationId, sourceId: sourceRoot })
        .expect(202);

      await waitForEvent({
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
        timeoutMs: 5000,
      });
      const turns = memoryTurns.get(conversationId) ?? [];
      assert.ok(
        turns.some(
          (turn) => turn.role === 'user' && turn.content.includes('tie-b'),
        ),
      );
    },
    {
      listIngestedRepositories: async () => ({
        repos,
        lockedModelId: null,
      }),
    },
  );
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

test('command-load failures are retried and then fail deterministically', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  const commandName = 'task5_retry_temp_command';
  const commandPath = path.join(
    repoRoot,
    'codex_agents',
    'planning_agent',
    'commands',
    `${commandName}.json`,
  );
  await fs.writeFile(
    commandPath,
    JSON.stringify({
      Description: 'Temporary command for Task 5 retry test',
      items: [{ type: 'message', role: 'user', content: ['temporary step'] }],
    }),
  );
  await withFlowServer(async ({ baseUrl, wsUrl, tmpDir }) => {
    const conversationId = 'flow-command-missing-retry-conv';
    sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

    const retryFlow = {
      description: 'Retry missing command',
      steps: [
        {
          type: 'llm',
          agentType: 'planning_agent',
          identifier: 'prep',
          messages: [{ role: 'user', content: ['__delay:300::prep'] }],
        },
        {
          type: 'command',
          agentType: 'planning_agent',
          identifier: 'missing-command',
          commandName,
        },
      ],
    };
    await fs.writeFile(
      path.join(tmpDir, 'command-missing-retry.json'),
      JSON.stringify(retryFlow, null, 2),
    );

    await supertest(baseUrl)
      .post('/flows/command-missing-retry/run')
      .send({ conversationId })
      .expect(202);
    await delay(50);
    await fs.rm(commandPath, { force: true });

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
          e.status === 'failed'
        );
      },
      timeoutMs: 5000,
    });

    assert.equal(final.status, 'failed');
    const turns = await waitForTurns(
      conversationId,
      (items) => items.filter((turn) => turn.role === 'assistant').length >= 1,
      3000,
    );
    const assistantTurns = turns.filter((turn) => turn.role === 'assistant');
    assert.equal(assistantTurns.length, 2);

    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
  await fs.rm(commandPath, { force: true });
  if (previousRetries === undefined) {
    delete process.env.FLOW_AND_COMMAND_RETRIES;
  } else {
    process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
  }
});

test('flow run rejects path traversal attempts', async () => {
  await withFlowServer(async ({ baseUrl }) => {
    await supertest(baseUrl)
      .post('/flows/..%2Fescape/run')
      .send({})
      .expect(404);
  });
});

test('conversation-only stop prevents nested command handoff from starting', async () => {
  await withFlowServer(async ({ wsUrl, tmpDir }) => {
    const conversationId = 'flow-command-stop-before-handoff';
    const flowName = 'command-stop-check';
    await fs.writeFile(
      path.join(tmpDir, `${flowName}.json`),
      JSON.stringify({
        description: 'stop before command handoff',
        steps: [
          {
            type: 'command',
            agentType: 'planning_agent',
            identifier: 'stop-check',
            commandName: 'improve_plan',
          },
        ],
      }),
    );
    sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

    const startedPromise = startFlowRun({
      flowName,
      conversationId,
      source: 'REST',
      chatFactory: () => new ScriptedChat(),
      onOwnershipReady: ({ runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });
    await startedPromise;

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
          e.status === 'stopped'
        );
      },
      timeoutMs: 5000,
    });

    assert.equal(final.status, 'stopped');
    await delay(250);

    const flowConversation = memoryConversations.get(conversationId);
    const flowFlags = (flowConversation?.flags ?? {}) as {
      flow?: { agentConversations?: Record<string, string> };
    };
    assert.equal(
      flowFlags.flow?.agentConversations?.['planning_agent:stop-check'],
      undefined,
    );

    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
});

test('no stale flow continuation resumes after confirmed stop', async () => {
  await withFlowServer(async ({ wsUrl }) => {
    const conversationId = 'flow-command-stop-no-resume';
    sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

    const events: Array<{ type?: string; conversationId?: string }> = [];
    wsUrl.on('message', (raw) => {
      const parsed = JSON.parse(String(raw)) as {
        type?: string;
        conversationId?: string;
      };
      events.push(parsed);
    });

    const startedPromise = startFlowRun({
      flowName: 'command-step',
      conversationId,
      source: 'REST',
      chatFactory: () => new ScriptedChat(),
      onOwnershipReady: ({ runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });
    await startedPromise;

    await waitForEvent({
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
          e.status === 'stopped'
        );
      },
      timeoutMs: 5000,
    });

    const turnCountAfterStop = memoryTurns.get(conversationId)?.length ?? 0;
    await delay(300);

    const finals = events.filter(
      (event) =>
        event.type === 'turn_final' && event.conversationId === conversationId,
    );
    assert.equal(finals.length, 1);
    assert.equal(
      memoryTurns.get(conversationId)?.length ?? 0,
      turnCountAfterStop,
    );

    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
});

test('stop-near-complete flow aligns final status with persisted turns and emits Task 3 diagnostics', async () => {
  let wsRef: WebSocket | null = null;
  let flowInflightId: string | null = null;
  let cancelSent = false;

  await withFlowServer(async ({ wsUrl }) => {
    wsRef = wsUrl;
    const conversationId = 'flow-command-stop-near-complete';
    sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

    const startedPromise = startFlowRun({
      flowName: 'command-step',
      conversationId,
      source: 'REST',
      chatFactory: () =>
        new CompleteThenPauseChat({
          onComplete: async () => {
            const deadline = Date.now() + 1000;
            while (!flowInflightId && Date.now() < deadline) {
              await delay(10);
            }
            assert.ok(flowInflightId);
            if (!cancelSent && wsRef) {
              cancelSent = true;
              sendJson(wsRef, {
                type: 'cancel_inflight',
                conversationId,
                inflightId: flowInflightId,
              });
            }
          },
        }),
    });

    const inflightSnapshot = await waitForEvent({
      ws: wsUrl,
      predicate: (
        event: unknown,
      ): event is {
        type: 'inflight_snapshot';
        conversationId: string;
        inflight: { inflightId?: string };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflight?: { inflightId?: string };
        };
        return (
          e.type === 'inflight_snapshot' &&
          e.conversationId === conversationId &&
          typeof e.inflight?.inflightId === 'string'
        );
      },
      timeoutMs: 5000,
    });
    flowInflightId = inflightSnapshot.inflight.inflightId ?? null;
    assert.ok(flowInflightId);

    await startedPromise;
    const final = await waitForFlowFinal({
      ws: wsUrl,
      conversationId,
      status: 'stopped',
      timeoutMs: 5000,
    });
    assert.equal(final.status, 'stopped');

    const turns = await waitForTurns(
      conversationId,
      (items) =>
        items.some(
          (turn) => turn.role === 'assistant' && turn.status === 'stopped',
        ),
      4000,
    );
    assert.equal(
      turns.some(
        (turn) => turn.role === 'assistant' && turn.status === 'stopped',
      ),
      true,
    );

    const stopPathLog = query(
      { text: 'DEV-0000049:T03:stop_path_registered' },
      50,
    ).find(
      (entry) =>
        entry.context?.conversationId === conversationId &&
        entry.context?.inflightId === flowInflightId,
    );
    assert.ok(stopPathLog);

    const reclassifiedLog = query(
      { text: 'DEV-0000049:T03:flow_instruction_status_reclassified' },
      20,
    ).find(
      (entry) =>
        entry.context?.flowConversationId === conversationId &&
        entry.context?.inflightId === flowInflightId,
    );
    assert.ok(reclassifiedLog);
    assert.equal(reclassifiedLog.context?.fromStatus, 'ok');
    assert.equal(reclassifiedLog.context?.toStatus, 'stopped');

    const persistedLogs = query(
      { text: 'DEV-0000049:T03:flow_turn_status_persisted' },
      20,
    ).filter(
      (entry) =>
        entry.context?.flowConversationId === conversationId &&
        entry.context?.inflightId === flowInflightId,
    );
    assert.equal(persistedLogs.length >= 2, true);
    assert.equal(
      persistedLogs.every((entry) => entry.context?.status === 'stopped'),
      true,
    );

    const alignedLog = query(
      { text: 'DEV-0000049:T03:deferred_final_status_aligned' },
      20,
    ).find(
      (entry) =>
        entry.context?.conversationId === conversationId &&
        entry.context?.inflightId === flowInflightId,
    );
    assert.ok(alignedLog);
    assert.equal(alignedLog.context?.pendingStatus, 'ok');
    assert.equal(alignedLog.context?.resolvedStatus, 'stopped');

    cleanupMemory(conversationId);
  });
});
