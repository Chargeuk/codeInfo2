import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import type { AppendTurnInput } from '../../mongo/repo.js';
import type {
  TurnRuntimeMetadata,
  TurnSource,
  TurnTimingMetadata,
  TurnUsageMetadata,
} from '../../mongo/turn.js';
import { createChatRouter } from '../../routes/chat.js';
import { restoreSavedWorkingFolder } from '../../workingFolders/state.js';

class PersistSpyChat extends ChatInterface {
  public persisted: Array<{
    role: string;
    content: string;
    model: string;
    provider: string;
    source?: string;
    runtime?: TurnRuntimeMetadata;
    usage?: TurnUsageMetadata;
    timing?: TurnTimingMetadata;
  }> = [];
  public executeCalls = 0;
  private readonly completeEvent?: {
    usage?: TurnUsageMetadata;
    timing?: TurnTimingMetadata;
  };
  private readonly beforeComplete?: () => void;

  constructor(params?: {
    completeEvent?: { usage?: TurnUsageMetadata; timing?: TurnTimingMetadata };
    beforeComplete?: () => void;
  }) {
    super();
    this.completeEvent = params?.completeEvent;
    this.beforeComplete = params?.beforeComplete;
  }

  protected override async persistTurn(
    input: AppendTurnInput & { source?: TurnSource },
  ): Promise<{ turnId?: string }> {
    this.persisted.push({
      role: input.role,
      content: input.content,
      model: input.model,
      provider: input.provider,
      source: input.source,
      ...(input.runtime !== undefined ? { runtime: input.runtime } : {}),
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
      ...(input.timing !== undefined ? { timing: input.timing } : {}),
    });

    return {};
  }

  async execute(): Promise<void> {
    this.executeCalls += 1;
    this.emitEvent({ type: 'token', content: 'partial' });
    this.emitEvent({ type: 'final', content: 'assistant-reply' });
    if (this.beforeComplete) {
      this.beforeComplete();
    }
    this.emitEvent({
      type: 'complete',
      ...(this.completeEvent ?? {}),
    });
  }
}

class RouteChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ): Promise<void> {
    void _message;
    void _flags;
    void _model;
    this.emitEvent({ type: 'thread', threadId: conversationId });
    this.emitEvent({ type: 'final', content: 'assistant-reply' });
    this.emitEvent({ type: 'complete' });
  }
}

const withReadyState = async (
  readyState: number,
  nodeEnv: string,
  fn: () => Promise<void>,
) => {
  const originalEnv = process.env.NODE_ENV;
  const originalReady = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: readyState,
    configurable: true,
  });
  process.env.NODE_ENV = nodeEnv;
  try {
    await fn();
  } finally {
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: originalReady,
      configurable: true,
    });
    process.env.NODE_ENV = originalEnv;
  }
};

describe('ChatInterface.run persistence', () => {
  test('persists user turn then executes when Mongo is available', async () => {
    const chat = new PersistSpyChat();
    await withReadyState(1, 'development', async () => {
      await chat.run(
        'hello',
        { provider: 'codex', source: 'REST' },
        'conv-a',
        'model-a',
      );
    });

    assert.equal(chat.executeCalls, 1);
    assert.equal(chat.persisted.length, 2);
    assert.deepEqual(chat.persisted[0], {
      role: 'user',
      content: 'hello',
      model: 'model-a',
      provider: 'codex',
      source: 'REST',
    });
    const assistant = chat.persisted[1];
    assert.equal(assistant.role, 'assistant');
    assert.equal(assistant.content, 'assistant-reply');
    assert.equal(assistant.model, 'model-a');
    assert.equal(assistant.provider, 'codex');
    assert.equal(assistant.source, 'REST');
    if (assistant.timing) {
      assert.equal(typeof assistant.timing.totalTimeSec, 'number');
    }
  });

  test('skips Mongo and does not call persistTurn when using memory fallback', async () => {
    const chat = new PersistSpyChat();
    await withReadyState(0, 'test', async () => {
      await chat.run(
        'hello',
        { provider: 'lmstudio', source: 'MCP' },
        'conv-b',
        'model-b',
      );
    });

    assert.equal(chat.executeCalls, 1);
    assert.equal(chat.persisted.length, 0);
  });

  test('persists assistant usage/timing when completion provides metadata', async () => {
    const chat = new PersistSpyChat({
      completeEvent: {
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          cachedInputTokens: 2,
        },
        timing: {
          totalTimeSec: 1.25,
          tokensPerSecond: 16,
        },
      },
    });

    await withReadyState(1, 'development', async () => {
      await chat.run(
        'hello',
        { provider: 'lmstudio', source: 'REST' },
        'conv-c',
        'model-c',
      );
    });

    assert.equal(chat.persisted.length, 2);
    assert.deepEqual(chat.persisted[1].usage, {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      cachedInputTokens: 2,
    });
    assert.deepEqual(chat.persisted[1].timing, {
      totalTimeSec: 1.25,
      tokensPerSecond: 16,
    });
  });

  test('assistant persistence omits usage and only persists derived timing when available', async () => {
    const chat = new PersistSpyChat();

    await withReadyState(1, 'development', async () => {
      await chat.run(
        'hello',
        { provider: 'lmstudio', source: 'REST' },
        'conv-d',
        'model-d',
      );
    });

    assert.equal(chat.persisted.length, 2);
    assert.equal(chat.persisted[1].usage, undefined);
    const timing = chat.persisted[1].timing;
    if (timing) {
      assert.equal(typeof timing.totalTimeSec, 'number');
      assert.equal(timing.tokensPerSecond, undefined);
    }
  });

  test('fallback timing uses run start when provider timing missing', async () => {
    let now = 10_000;
    const originalNow = Date.now;
    Date.now = () => now;

    const chat = new PersistSpyChat({
      beforeComplete: () => {
        now = 11_500;
      },
    });

    try {
      await withReadyState(1, 'development', async () => {
        await chat.run(
          'hello',
          { provider: 'lmstudio', source: 'REST' },
          'conv-e',
          'model-e',
        );
      });
    } finally {
      Date.now = originalNow;
    }

    assert.equal(chat.persisted.length, 2);
    const totalTimeSec = chat.persisted[1].timing?.totalTimeSec ?? 0;
    assert.ok(Math.abs(totalTimeSec - 1.5) < 0.001);
  });

  test('persists Turn.runtime in the Mongo-backed path', async () => {
    const chat = new PersistSpyChat();

    await withReadyState(1, 'development', async () => {
      await chat.run(
        'hello',
        {
          provider: 'lmstudio',
          source: 'REST',
          runtime: {
            workingFolder: '/repos/working-root',
            lookupSummary: {
              selectedRepositoryPath: '/repos/working-root',
              fallbackUsed: false,
              workingRepositoryAvailable: true,
            },
          },
        },
        'conv-runtime-mongo',
        'model-runtime',
      );
    });

    assert.equal(chat.persisted.length, 2);
    assert.deepEqual(chat.persisted[0].runtime, {
      workingFolder: '/repos/working-root',
      lookupSummary: {
        selectedRepositoryPath: '/repos/working-root',
        fallbackUsed: false,
        workingRepositoryAvailable: true,
      },
    });
  });

  test('persists Turn.runtime in the memory-backed path', async () => {
    const chat = new PersistSpyChat();
    memoryConversations.set('conv-runtime-memory', {
      _id: 'conv-runtime-memory',
      provider: 'lmstudio',
      model: 'model-runtime',
      title: 'Runtime memory test',
      source: 'REST',
      flags: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageAt: new Date(),
      archivedAt: null,
    });

    try {
      await withReadyState(0, 'test', async () => {
        await chat.run(
          'hello',
          {
            provider: 'lmstudio',
            source: 'REST',
            runtime: {
              workingFolder: '/repos/working-root',
              lookupSummary: {
                selectedRepositoryPath: '/repos/working-root',
                fallbackUsed: false,
                workingRepositoryAvailable: true,
              },
            },
          },
          'conv-runtime-memory',
          'model-runtime',
        );
      });

      const turns = memoryTurns.get('conv-runtime-memory') ?? [];
      assert.equal(turns.length, 2);
      assert.deepEqual(turns[0]?.runtime, {
        workingFolder: '/repos/working-root',
        lookupSummary: {
          selectedRepositoryPath: '/repos/working-root',
          fallbackUsed: false,
          workingRepositoryAvailable: true,
        },
      });
    } finally {
      memoryConversations.delete('conv-runtime-memory');
      memoryTurns.delete('conv-runtime-memory');
    }
  });

  test('a successful chat run persists the selected working folder on the owning conversation', async () => {
    const app = express();
    app.use(
      '/chat',
      createChatRouter({
        clientFactory: () =>
          ({
            system: {
              listDownloadedModels: async () => [{ modelKey: 'lmstudio-test' }],
            },
          }) as never,
        chatFactory: () => new RouteChat(),
      }),
    );

    await withReadyState(0, 'test', async () => {
      const res = await request(app).post('/chat').send({
        provider: 'lmstudio',
        model: 'lmstudio-test',
        message: 'hello',
        conversationId: 'chat-working-folder-save',
        working_folder: process.cwd(),
      });

      assert.equal(res.status, 202);
    });

    try {
      assert.equal(
        memoryConversations.get('chat-working-folder-save')?.flags
          ?.workingFolder,
        process.cwd(),
      );
    } finally {
      memoryConversations.delete('chat-working-folder-save');
      memoryTurns.delete('chat-working-folder-save');
    }
  });

  test('an invalid saved chat working folder is cleared before the chat restore path uses it', async () => {
    let clearedConversationId: string | undefined;
    const restored = await restoreSavedWorkingFolder({
      conversation: {
        conversationId: 'chat-restore-clear',
        flags: {
          workingFolder: path.join(process.cwd(), 'definitely-missing'),
        },
      },
      surface: 'chat_run',
      clearPersistedWorkingFolder: async (conversationId) => {
        clearedConversationId = conversationId;
      },
    });

    assert.equal(restored, undefined);
    assert.equal(clearedConversationId, 'chat-restore-clear');
  });

  test('an invalid saved chat working folder is cleared before the next chat run reuses it', async () => {
    memoryConversations.set('chat-working-folder-clear', {
      _id: 'chat-working-folder-clear',
      provider: 'lmstudio',
      model: 'lmstudio-test',
      title: 'Chat conversation',
      source: 'REST',
      flags: {
        workingFolder: path.join(process.cwd(), 'definitely-missing-chat-path'),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageAt: new Date(),
      archivedAt: null,
    });

    const app = express();
    app.use(
      '/chat',
      createChatRouter({
        clientFactory: () =>
          ({
            system: {
              listDownloadedModels: async () => [{ modelKey: 'lmstudio-test' }],
            },
          }) as never,
        chatFactory: () => new RouteChat(),
      }),
    );

    try {
      await withReadyState(0, 'test', async () => {
        const res = await request(app).post('/chat').send({
          provider: 'lmstudio',
          model: 'lmstudio-test',
          message: 'hello',
          conversationId: 'chat-working-folder-clear',
        });

        assert.equal(res.status, 202);
      });

      assert.equal(
        memoryConversations.get('chat-working-folder-clear')?.flags
          ?.workingFolder,
        undefined,
      );
    } finally {
      memoryConversations.delete('chat-working-folder-clear');
      memoryTurns.delete('chat-working-folder-clear');
    }
  });

  test('chat turn runtime metadata includes the working-folder snapshot when a chat run uses one', async () => {
    const app = express();
    app.use(
      '/chat',
      createChatRouter({
        clientFactory: () =>
          ({
            system: {
              listDownloadedModels: async () => [{ modelKey: 'lmstudio-test' }],
            },
          }) as never,
        chatFactory: () => new RouteChat(),
      }),
    );

    try {
      await withReadyState(0, 'test', async () => {
        await request(app).post('/chat').send({
          provider: 'lmstudio',
          model: 'lmstudio-test',
          message: 'hello',
          conversationId: 'chat-runtime-working-folder',
          working_folder: process.cwd(),
        });
      });

      const turns = memoryTurns.get('chat-runtime-working-folder') ?? [];
      assert.equal(turns[0]?.runtime?.workingFolder, process.cwd());
    } finally {
      memoryConversations.delete('chat-runtime-working-folder');
      memoryTurns.delete('chat-runtime-working-folder');
    }
  });
});
