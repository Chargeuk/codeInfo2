import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import type {
  ChatEvent,
  ChatToolResultEvent,
} from '../../chat/interfaces/ChatInterface.js';
import { ChatInterfaceCodex } from '../../chat/interfaces/ChatInterfaceCodex.js';
import {
  getMemoryTurns,
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { ConversationModel } from '../../mongo/conversation.js';
import { updateConversationThreadId } from '../../mongo/repo.js';
import type { TurnSummary } from '../../mongo/repo.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';

type MockThread = {
  id: string | null;
  runStreamed: () => Promise<{ events: AsyncGenerator<unknown> }>;
};

type MockCodexFactory = () => {
  startThread: () => MockThread;
  resumeThread: () => MockThread;
};

class TestChatInterfaceCodex extends ChatInterfaceCodex {
  constructor(codexFactory: MockCodexFactory) {
    super(codexFactory);
  }

  protected override async loadHistory(): Promise<TurnSummary[]> {
    return [
      {
        turnId: 't1',
        conversationId: 'conv-1',
        role: 'user',
        content: 'prev',
        model: 'gpt-5',
        provider: 'codex',
        source: 'REST',
        toolCalls: null,
        status: 'ok',
        createdAt: new Date(),
      },
    ];
  }

  protected override async persistTurn(): Promise<{ turnId?: string }> {
    // no-op for unit isolation
    return {};
  }
}

const resetMemory = () => {
  memoryConversations.clear();
  memoryTurns.clear();
};

describe('ChatInterfaceCodex', () => {
  it('emits thread -> tool-request -> tool-result -> token -> final -> complete in order', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });
    const emitted: ChatEvent[] = [];
    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-1' };
      yield {
        type: 'item.started',
        item: {
          type: 'mcp_tool_call',
          id: 'call-1',
          name: 'VectorSearch',
          arguments: '{"q":"hi"}',
        },
      };
      yield {
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          id: 'call-1',
          result: {
            content: [{ type: 'application/json', json: { ok: true } }],
          },
        },
      };
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', text: 'Hello' },
      };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Hello' },
      };
      yield { type: 'turn.completed' };
    };
    const thread = {
      id: 'tid-1',
      runStreamed: async () => ({ events: events() }),
    };
    const codexFactory = () => ({
      startThread: () => thread,
      resumeThread: () => thread,
    });
    const chat = new TestChatInterfaceCodex(codexFactory);

    chat.on('thread', (e) => emitted.push(e));
    chat.on('tool-request', (e) => emitted.push(e));
    chat.on('tool-result', (e) => emitted.push(e));
    chat.on('token', (e) => emitted.push(e));
    chat.on('final', (e) => emitted.push(e));
    chat.on('complete', (e) => emitted.push(e));

    await chat.run('Hello', { threadId: null }, 'conv-1', 'gpt-5');

    const order = emitted.map((e) => e.type);
    assert.deepEqual(order, [
      'thread',
      'tool-request',
      'tool-result',
      'token',
      'final',
      'complete',
    ]);

    const toolResult = emitted.find((e) => e.type === 'tool-result') as
      | ChatToolResultEvent
      | undefined;
    assert(toolResult);
    assert.equal(toolResult.callId, 'call-1');
    assert.equal(toolResult.stage, 'success');
    assert.deepEqual(toolResult.result, { ok: true });
  });

  it('persists usage metadata from turn.completed', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-usage' };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Hello' },
      };
      yield {
        type: 'turn.completed',
        usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 6 },
      };
    };

    const thread = {
      id: 'tid-usage',
      runStreamed: async () => ({ events: events() }),
    };
    const codexFactory = () => ({
      startThread: () => thread,
      resumeThread: () => thread,
    });
    const chat = new TestChatInterfaceCodex(codexFactory);

    await chat.run('Hello', { threadId: null }, 'conv-usage', 'gpt-5');

    const turns = getMemoryTurns('conv-usage');
    const assistant = turns.find((turn) => turn.role === 'assistant');
    assert(assistant?.usage);
    assert.deepEqual(assistant.usage, {
      inputTokens: 10,
      outputTokens: 6,
      cachedInputTokens: 2,
      totalTokens: 16,
    });
  });

  it('handles missing cached input tokens', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-nocache' };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Hi' },
      };
      yield {
        type: 'turn.completed',
        usage: { input_tokens: 4, output_tokens: 5 },
      };
    };

    const thread = {
      id: 'tid-nocache',
      runStreamed: async () => ({ events: events() }),
    };
    const codexFactory = () => ({
      startThread: () => thread,
      resumeThread: () => thread,
    });
    const chat = new TestChatInterfaceCodex(codexFactory);

    await chat.run('Hello', { threadId: null }, 'conv-nocache', 'gpt-5');

    const turns = getMemoryTurns('conv-nocache');
    const assistant = turns.find((turn) => turn.role === 'assistant');
    assert(assistant?.usage);
    assert.deepEqual(assistant.usage, {
      inputTokens: 4,
      outputTokens: 5,
      totalTokens: 9,
    });
  });

  it('derives totalTokens when omitted', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-total' };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Hi' },
      };
      yield {
        type: 'turn.completed',
        usage: { input_tokens: 7, cached_input_tokens: 3, output_tokens: 9 },
      };
    };

    const thread = {
      id: 'tid-total',
      runStreamed: async () => ({ events: events() }),
    };
    const codexFactory = () => ({
      startThread: () => thread,
      resumeThread: () => thread,
    });
    const chat = new TestChatInterfaceCodex(codexFactory);

    await chat.run('Hello', { threadId: null }, 'conv-total', 'gpt-5');

    const turns = getMemoryTurns('conv-total');
    const assistant = turns.find((turn) => turn.role === 'assistant');
    assert(assistant?.usage);
    assert.deepEqual(assistant.usage, {
      inputTokens: 7,
      outputTokens: 9,
      cachedInputTokens: 3,
      totalTokens: 16,
    });
  });

  it('updates flags.threadId without overwriting other flags keys', async () => {
    const originalReady = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: 1,
      configurable: true,
    });

    const original = ConversationModel.findByIdAndUpdate;
    const captured: Array<{
      id: unknown;
      update: unknown;
      options: unknown;
    }> = [];

    ConversationModel.findByIdAndUpdate = ((
      id: unknown,
      update: unknown,
      options: unknown,
    ) => {
      captured.push({ id, update, options });
      return { exec: async () => null } as unknown as ReturnType<
        typeof ConversationModel.findByIdAndUpdate
      >;
    }) as typeof ConversationModel.findByIdAndUpdate;

    try {
      await updateConversationThreadId({
        conversationId: 'conv-flags',
        threadId: 'tid-2',
      });
    } finally {
      ConversationModel.findByIdAndUpdate = original;
      Object.defineProperty(mongoose.connection, 'readyState', {
        value: originalReady,
        configurable: true,
      });
    }

    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.id, 'conv-flags');
    assert.deepEqual(captured[0]?.update, {
      $set: { 'flags.threadId': 'tid-2' },
    });
  });

  it('does not attempt thread id persistence when Mongo is unavailable', async () => {
    const originalReady = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: 0,
      configurable: true,
    });

    const original = ConversationModel.findByIdAndUpdate;
    let called = false;

    ConversationModel.findByIdAndUpdate = (() => {
      called = true;
      return { exec: async () => null } as unknown as ReturnType<
        typeof ConversationModel.findByIdAndUpdate
      >;
    }) as unknown as typeof ConversationModel.findByIdAndUpdate;

    try {
      await updateConversationThreadId({
        conversationId: 'conv-flags',
        threadId: 'tid-2',
      });
    } finally {
      ConversationModel.findByIdAndUpdate = original;
      Object.defineProperty(mongoose.connection, 'readyState', {
        value: originalReady,
        configurable: true,
      });
    }

    assert.equal(called, false);
  });
});
