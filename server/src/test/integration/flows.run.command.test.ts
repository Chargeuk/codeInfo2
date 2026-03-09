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
import { registerPendingConversationCancel } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import type { ListReposResult, RepoEntry } from '../../lmstudio/toolService.js';
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

const withFlowServer = async (
  task: (params: {
    baseUrl: string;
    wsUrl: WebSocket;
    tmpDir: string;
  }) => Promise<void>,
  options?: {
    listIngestedRepositories?: (tmpDir: string) => Promise<ListReposResult>;
  },
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
      items: [
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

test('deterministic ordering uses normalized source label then full path for other repositories', async () => {
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
              turn.role === 'user' && turn.content.includes('other-alpha'),
          ),
        3000,
      );
      assert.ok(
        turns.some(
          (turn) =>
            turn.role === 'user' && turn.content.includes('other-alpha'),
        ),
      );
      assert.equal(
        turns.some(
          (turn) => turn.role === 'user' && turn.content.includes('other-beta'),
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

test('other-repo ordering trims sourceLabel whitespace', async () => {
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
          (turn) => turn.role === 'user' && turn.content.includes('trim-a'),
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

test('other-repo ordering falls back to basename when sourceLabel is empty', async () => {
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
          (turn) => turn.role === 'user' && turn.content.includes('basename-a'),
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

test('other-repo ordering uses path tie-break when labels match case-insensitively', async () => {
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
          (turn) => turn.role === 'user' && turn.content.includes('tie-a'),
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
