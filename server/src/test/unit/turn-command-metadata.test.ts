import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
import { ConversationModel } from '../../mongo/conversation.js';
import { appendTurn, listTurns } from '../../mongo/repo.js';
import { TurnModel, type TurnCommandMetadata } from '../../mongo/turn.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

class ScriptedChat extends ChatInterface {
  async execute(
    message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _flags;
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: message });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const writeRepoCommand = async (params: {
  repoRoot: string;
  commandName: string;
  content: string;
}) => {
  const commandDir = path.join(
    params.repoRoot,
    'codex_agents',
    'planning_agent',
    'commands',
  );
  await fs.mkdir(commandDir, { recursive: true });
  const filePath = path.join(commandDir, `${params.commandName}.json`);
  await fs.writeFile(
    filePath,
    JSON.stringify({
      Description: 'repo command',
      items: [{ type: 'message', role: 'user', content: [params.content] }],
    }),
  );
  return filePath;
};

const restore = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  original: T[K],
) => {
  (target as Record<string, unknown>)[key as string] = original as unknown;
};

test('stores + returns command when provided', async () => {
  const stored: Array<Record<string, unknown>> = [];

  const originalCreate = TurnModel.create;
  const originalFind = TurnModel.find;
  const originalUpdate = ConversationModel.findByIdAndUpdate;

  (TurnModel as unknown as Record<string, unknown>).create = async (
    doc: Record<string, unknown>,
  ) => {
    stored.push(doc);
    return doc;
  };

  (TurnModel as unknown as Record<string, unknown>).find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () => stored,
      }),
    }),
  });

  (ConversationModel as unknown as Record<string, unknown>).findByIdAndUpdate =
    () => ({
      exec: async () => null,
    });

  try {
    const command: TurnCommandMetadata = {
      name: 'improve_plan',
      stepIndex: 2,
      totalSteps: 12,
    };

    await appendTurn({
      conversationId: 'c1',
      role: 'user',
      content: 'hello',
      model: 'm1',
      provider: 'codex',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      command,
    });

    const { items } = await listTurns({ conversationId: 'c1', limit: 10 });
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].command, command);
  } finally {
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'create',
      originalCreate,
    );
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'findByIdAndUpdate',
      originalUpdate,
    );
  }
});

test('omitting command keeps existing behavior', async () => {
  const stored: Array<Record<string, unknown>> = [];

  const originalCreate = TurnModel.create;
  const originalFind = TurnModel.find;
  const originalUpdate = ConversationModel.findByIdAndUpdate;

  (TurnModel as unknown as Record<string, unknown>).create = async (
    doc: Record<string, unknown>,
  ) => {
    stored.push(doc);
    return doc;
  };

  (TurnModel as unknown as Record<string, unknown>).find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () => stored,
      }),
    }),
  });

  (ConversationModel as unknown as Record<string, unknown>).findByIdAndUpdate =
    () => ({
      exec: async () => null,
    });

  try {
    await appendTurn({
      conversationId: 'c2',
      role: 'assistant',
      content: 'hi',
      model: 'm1',
      provider: 'lmstudio',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
    });

    const { items } = await listTurns({ conversationId: 'c2', limit: 10 });
    assert.equal(items.length, 1);
    assert.equal(items[0].command, undefined);
  } finally {
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'create',
      originalCreate,
    );
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'findByIdAndUpdate',
      originalUpdate,
    );
  }
});

test('stores + returns flow metadata without agentType or identifier', async () => {
  const stored: Array<Record<string, unknown>> = [];

  const originalCreate = TurnModel.create;
  const originalFind = TurnModel.find;
  const originalUpdate = ConversationModel.findByIdAndUpdate;

  (TurnModel as unknown as Record<string, unknown>).create = async (
    doc: Record<string, unknown>,
  ) => {
    stored.push(doc);
    return doc;
  };

  (TurnModel as unknown as Record<string, unknown>).find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () => stored,
      }),
    }),
  });

  (ConversationModel as unknown as Record<string, unknown>).findByIdAndUpdate =
    () => ({
      exec: async () => null,
    });

  try {
    const command: TurnCommandMetadata = {
      name: 'flow',
      stepIndex: 1,
      totalSteps: 2,
      loopDepth: 0,
      label: 'reingest',
    };

    await appendTurn({
      conversationId: 'c3',
      role: 'assistant',
      content: 'recorded',
      model: 'm1',
      provider: 'codex',
      source: 'REST',
      toolCalls: null,
      status: 'ok',
      command,
    });

    const { items } = await listTurns({ conversationId: 'c3', limit: 10 });
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].command, command);
  } finally {
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'create',
      originalCreate,
    );
    restore(
      TurnModel as unknown as Record<string, unknown>,
      'find',
      originalFind,
    );
    restore(
      ConversationModel as unknown as Record<string, unknown>,
      'findByIdAndUpdate',
      originalUpdate,
    );
  }
});

test('direct command execution persists lookupSummary into turn runtime metadata', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-task2-turn-runtime-'),
  );
  const workingRoot = path.join(tmpDir, 'working-repo');
  const sourceRoot = path.join(tmpDir, 'source-repo');
  const commandName = 'task2_turn_runtime_lookup_summary';
  const conversationId = 'task2-turn-runtime-lookup-summary';
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;

  try {
    process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
    await writeRepoCommand({
      repoRoot: workingRoot,
      commandName,
      content: 'working repository command',
    });
    await writeRepoCommand({
      repoRoot: sourceRoot,
      commandName,
      content: 'source repository command',
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            {
              id: 'Working Repo',
              description: null,
              containerPath: workingRoot,
              hostPath: workingRoot,
              lastIngestAt: null,
              embeddingProvider: 'lmstudio',
              embeddingModel: 'model',
              embeddingDimensions: 768,
              modelId: 'model',
              counts: { files: 0, chunks: 0, embedded: 0 },
              lastError: null,
            },
            {
              id: 'Source Repo',
              description: null,
              containerPath: sourceRoot,
              hostPath: sourceRoot,
              lastIngestAt: null,
              embeddingProvider: 'lmstudio',
              embeddingModel: 'model',
              embeddingDimensions: 768,
              modelId: 'model',
              counts: { files: 0, chunks: 0, embedded: 0 },
              lastError: null,
            },
          ],
        }) as never,
    });

    await runAgentCommand({
      agentName: 'planning_agent',
      commandName,
      conversationId,
      sourceId: sourceRoot,
      working_folder: workingRoot,
      source: 'REST',
      chatFactory: () => new ScriptedChat(),
    });

    const turns = memoryTurns.get(conversationId) ?? [];
    assert.equal(turns.length >= 2, true);
    const commandTurns = turns.filter(
      (turn) =>
        turn.command?.name === commandName &&
        turn.runtime?.lookupSummary?.selectedRepositoryPath ===
          path.resolve(workingRoot),
    );
    assert.equal(commandTurns.length > 0, true);
    assert.equal(
      commandTurns.every(
        (turn) =>
          turn.runtime?.lookupSummary?.fallbackUsed === false &&
          turn.runtime?.lookupSummary?.workingRepositoryAvailable === true,
      ),
      true,
    );
  } finally {
    __resetAgentServiceDepsForTests();
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
