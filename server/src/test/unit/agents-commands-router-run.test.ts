import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import request from 'supertest';

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
import { query, resetStore } from '../../logStore.js';
import { createAgentsCommandsRouter } from '../../routes/agentsCommands.js';

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
  content?: string;
  invalidSchema?: boolean;
}) => {
  const commandDir = path.join(
    params.repoRoot,
    'codex_agents',
    'planning_agent',
    'commands',
  );
  await fs.mkdir(commandDir, { recursive: true });
  const filePath = path.join(commandDir, `${params.commandName}.json`);
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
          content: [params.content ?? 'repo command'],
        },
      ],
    }),
  );
  return filePath;
};

function buildApp(deps?: {
  startAgentCommand?: (params: unknown) => Promise<unknown>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/agents',
    createAgentsCommandsRouter({
      listAgentCommands: async () => ({ commands: [] }),
      startAgentCommand:
        deps?.startAgentCommand ??
        (async () => {
          throw new Error('not implemented');
        }),
    } as unknown as Parameters<typeof createAgentsCommandsRouter>[0]),
  );
  return app;
}

test('POST /agents/:agentName/commands/run returns 202 + a stable started payload shape', async () => {
  let receivedSourceId: string | undefined;
  let receivedStartStep: number | undefined;
  const res = await request(
    buildApp({
      startAgentCommand: async (params: unknown) => {
        assert.equal(
          (params as { commandName?: string }).commandName,
          'improve_plan',
        );
        receivedSourceId = (params as { sourceId?: string }).sourceId;
        receivedStartStep = (params as { startStep?: number }).startStep;
        return {
          agentName: 'planning_agent',
          commandName: 'improve_plan',
          conversationId: 'conv-1',
          modelId: 'model-from-config',
        };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'started');
  assert.equal(res.body.agentName, 'planning_agent');
  assert.equal(res.body.commandName, 'improve_plan');
  assert.equal(res.body.conversationId, 'conv-1');
  assert.equal(typeof res.body.modelId, 'string');
  assert.equal(res.body.modelId.length > 0, true);
  assert.equal(receivedSourceId, undefined);
  assert.equal(receivedStartStep, undefined);
});

test('POST /agents/:agentName/commands/run forwards sourceId for ingested command runs', async () => {
  let receivedSourceId: string | undefined;
  const res = await request(
    buildApp({
      startAgentCommand: async (params: unknown) => {
        receivedSourceId = (params as { sourceId?: string }).sourceId;
        return {
          agentName: 'planning_agent',
          commandName: 'build',
          conversationId: 'conv-2',
          modelId: 'model-from-config',
        };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'build', sourceId: '/data/repo' });

  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'started');
  assert.equal(receivedSourceId, '/data/repo');
});

test('POST /agents/:agentName/commands/run forwards startStep when provided', async () => {
  let receivedStartStep: number | undefined;
  const res = await request(
    buildApp({
      startAgentCommand: async (params: unknown) => {
        receivedStartStep = (params as { startStep?: number }).startStep;
        return {
          agentName: 'planning_agent',
          commandName: 'build',
          conversationId: 'conv-2',
          modelId: 'model-from-config',
        };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'build', startStep: 2 });

  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'started');
  assert.equal(receivedStartStep, 2);
});

test('POST /agents/:agentName/commands/run maps unknown sourceId to 404', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'COMMAND_NOT_FOUND' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan', sourceId: '/data/missing' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});

test('POST /agents/:agentName/commands/run maps missing ingested command files to 404', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'COMMAND_NOT_FOUND' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'missing', sourceId: '/data/repo' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});

test('POST /agents/:agentName/commands/run maps RUN_IN_PROGRESS to 409 conflict + stable payload', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'RUN_IN_PROGRESS' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'conflict');
  assert.equal(res.body.code, 'RUN_IN_PROGRESS');
});

test('POST /agents/:agentName/commands/run maps invalid commandName to 400 + COMMAND_INVALID', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'COMMAND_INVALID' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: '../bad' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(res.body.code, 'COMMAND_INVALID');
});

test('POST /agents/:agentName/commands/run maps WORKING_FOLDER_UNAVAILABLE to a safe 503 message', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw {
          code: 'WORKING_FOLDER_UNAVAILABLE',
          reason: 'working_folder could not be validated (EACCES)',
          causeCode: 'EACCES',
        };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, {
    error: 'working_folder_unavailable',
    code: 'WORKING_FOLDER_UNAVAILABLE',
    message: 'working_folder is temporarily unavailable',
  });
});

test("POST /agents/:agentName/commands/run maps COMMAND_NOT_FOUND to 404 { error: 'not_found' }", async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'COMMAND_NOT_FOUND' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'does_not_exist' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});

test("POST /agents/:agentName/commands/run maps CONVERSATION_ARCHIVED to 410 { error: 'archived' }", async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'CONVERSATION_ARCHIVED' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 410);
  assert.deepEqual(res.body, { error: 'archived' });
});

test("POST /agents/:agentName/commands/run maps AGENT_MISMATCH to 400 { error: 'agent_mismatch' }", async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'AGENT_MISMATCH' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'agent_mismatch' });
});

test('POST /agents/:agentName/commands/run maps CODEX_UNAVAILABLE to 503', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'CODEX_UNAVAILABLE', reason: 'missing codex config' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, {
    error: 'codex_unavailable',
    reason: 'missing codex config',
  });
});

test('POST /agents/:agentName/commands/run maps COMMAND_INVALID to 400 + code', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'COMMAND_INVALID', reason: 'Invalid command file' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(res.body.code, 'COMMAND_INVALID');
  assert.equal(typeof res.body.message, 'string');
});

test('POST /agents/:agentName/commands/run maps WORKING_FOLDER_INVALID to 400 + code', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'WORKING_FOLDER_INVALID' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan', working_folder: '/tmp' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(res.body.code, 'WORKING_FOLDER_INVALID');
});

test('POST /agents/:agentName/commands/run maps WORKING_FOLDER_NOT_FOUND to 400 + code', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'WORKING_FOLDER_NOT_FOUND' };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan', working_folder: '/tmp' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(res.body.code, 'WORKING_FOLDER_NOT_FOUND');
});

test("POST /agents/:agentName/commands/run maps unknown agent to 404 { error: 'not_found' }", async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw { code: 'AGENT_NOT_FOUND' };
      },
    }),
  )
    .post('/agents/does-not-exist/commands/run')
    .send({ commandName: 'improve_plan' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});

test('POST /agents/:agentName/commands/run rejects string startStep with deterministic INVALID_START_STEP payload', async () => {
  const res = await request(buildApp())
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan', startStep: '2' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'invalid_request',
    code: 'INVALID_START_STEP',
    message: 'startStep must be between 1 and N',
  });
});

test('POST /agents/:agentName/commands/run rejects fractional startStep with deterministic INVALID_START_STEP payload', async () => {
  const res = await request(buildApp())
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan', startStep: 2.5 });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'invalid_request',
    code: 'INVALID_START_STEP',
    message: 'startStep must be between 1 and N',
  });
});

test('POST /agents/:agentName/commands/run rejects boolean startStep with deterministic INVALID_START_STEP payload', async () => {
  const res = await request(buildApp())
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan', startStep: true });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'invalid_request',
    code: 'INVALID_START_STEP',
    message: 'startStep must be between 1 and N',
  });
});

test('POST /agents/:agentName/commands/run rejects null startStep with deterministic INVALID_START_STEP payload', async () => {
  const res = await request(buildApp())
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan', startStep: null });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'invalid_request',
    code: 'INVALID_START_STEP',
    message: 'startStep must be between 1 and N',
  });
});

test('POST /agents/:agentName/commands/run maps service INVALID_START_STEP to deterministic 400 payload', async () => {
  const res = await request(
    buildApp({
      startAgentCommand: async () => {
        throw {
          code: 'INVALID_START_STEP',
          reason: 'startStep must be between 1 and N',
        };
      },
    }),
  )
    .post('/agents/planning_agent/commands/run')
    .send({ commandName: 'improve_plan', startStep: 999 });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    error: 'invalid_request',
    code: 'INVALID_START_STEP',
    message: 'startStep must be between 1 and N',
  });
});

test('direct command execution searches the working repository before the selected command repository', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-task2-direct-command-'),
  );
  const workingRoot = path.join(tmpDir, 'working-repo');
  const sourceRoot = path.join(tmpDir, 'source-repo');
  const commandName = 'task2_direct_command_working_repo_first';
  const conversationId = 'task2-direct-command-working-repo-first';
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;

  try {
    resetStore();
    process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
    await writeRepoCommand({
      repoRoot: workingRoot,
      commandName,
      content: 'working repository command',
    });
    await writeRepoCommand({
      repoRoot: sourceRoot,
      commandName,
      content: 'selected source repository command',
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
    assert.equal(
      turns.some((turn) => turn.content === 'working repository command'),
      true,
    );
    const orderLogs = query({
      text: 'DEV_0000048_T1_REPOSITORY_CANDIDATE_ORDER',
    });
    assert.equal(orderLogs.length, 1);
    assert.deepEqual(orderLogs[0]?.context, {
      referenceType: null,
      caller: 'direct-command',
      workingRepositoryAvailable: true,
      candidateRepositories: [
        {
          sourceId: path.resolve(workingRoot),
          sourceLabel: 'working-repo',
          slot: 'working_repository',
        },
        {
          sourceId: path.resolve(sourceRoot),
          sourceLabel: 'Source Repo',
          slot: 'owner_repository',
        },
        {
          sourceId: path.resolve(repoRoot),
          sourceLabel: 'codeInfo2',
          slot: 'codeinfo2',
        },
      ],
    });
  } finally {
    __resetAgentServiceDepsForTests();
    resetStore();
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

test('direct command execution restores the saved folder from the owning agent conversation', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-task5-direct-command-saved-folder-'),
  );
  const savedWorkingRoot = path.join(tmpDir, 'saved-working-repo');
  const sourceRoot = path.join(tmpDir, 'source-repo');
  const commandName = 'task5_direct_command_saved_folder';
  const conversationId = 'task5-direct-command-saved-folder';
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;

  try {
    process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
    await writeRepoCommand({
      repoRoot: savedWorkingRoot,
      commandName,
      content: 'saved working repository command',
    });
    await writeRepoCommand({
      repoRoot: sourceRoot,
      commandName,
      content: 'source repository command',
    });
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Direct command conversation',
      agentName: 'planning_agent',
      source: 'REST',
      flags: { workingFolder: savedWorkingRoot },
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageAt: new Date(),
      archivedAt: null,
    });
    __setAgentServiceDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            {
              id: 'Saved Working Repo',
              description: null,
              containerPath: savedWorkingRoot,
              hostPath: savedWorkingRoot,
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
      source: 'REST',
      chatFactory: () => new ScriptedChat(),
    });

    const turns = memoryTurns.get(conversationId) ?? [];
    assert.equal(
      turns.some((turn) => turn.content === 'saved working repository command'),
      true,
    );
    assert.equal(
      memoryConversations.get(conversationId)?.flags?.workingFolder,
      savedWorkingRoot,
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

test('direct command execution fails fast when a higher-priority command file exists but is schema-invalid', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-task2-direct-command-invalid-'),
  );
  const workingRoot = path.join(tmpDir, 'working-repo');
  const sourceRoot = path.join(tmpDir, 'source-repo');
  const commandName = 'task2_direct_command_fail_fast_invalid';
  const conversationId = 'task2-direct-command-fail-fast-invalid';
  const previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;

  try {
    process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
    await writeRepoCommand({
      repoRoot: workingRoot,
      commandName,
      invalidSchema: true,
    });
    await writeRepoCommand({
      repoRoot: sourceRoot,
      commandName,
      content: 'selected source repository command',
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

    await assert.rejects(
      () =>
        runAgentCommand({
          agentName: 'planning_agent',
          commandName,
          conversationId,
          sourceId: sourceRoot,
          working_folder: workingRoot,
          source: 'REST',
          chatFactory: () => new ScriptedChat(),
        }),
      (error: unknown) =>
        (error as { code?: string }).code === 'COMMAND_INVALID',
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
