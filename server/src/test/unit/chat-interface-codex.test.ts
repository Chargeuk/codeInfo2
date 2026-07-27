import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  CodexOptions,
  ThreadOptions as CodexThreadOptions,
} from '@openai/codex-sdk';
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

type MockCodexFactory = (options?: CodexOptions) => {
  startThread: (opts?: CodexThreadOptions) => MockThread;
  resumeThread: (threadId: string, opts?: CodexThreadOptions) => MockThread;
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

  it('finalizes correctly when a tool-interleaved agent update is non-prefix', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });
    const emitted: ChatEvent[] = [];
    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-nonprefix' };
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', id: 'm1', text: 'Hel' },
      };
      yield {
        type: 'item.started',
        item: {
          type: 'mcp_tool_call',
          id: 'call-nonprefix',
          name: 'VectorSearch',
          arguments: '{"q":"hi"}',
        },
      };
      yield {
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          id: 'call-nonprefix',
          result: {
            content: [{ type: 'application/json', json: { ok: true } }],
          },
        },
      };
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', id: 'm1', text: 'Hello' },
      };
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', id: 'm1', text: 'I can help' },
      };
      yield {
        type: 'item.completed',
        item: {
          type: 'agent_message',
          id: 'm1',
          text: 'I can help with that.',
        },
      };
      yield { type: 'turn.completed' };
    };
    const thread = {
      id: 'tid-nonprefix',
      runStreamed: async () => ({ events: events() }),
    };
    const codexFactory = () => ({
      startThread: () => thread,
      resumeThread: () => thread,
    });
    const chat = new TestChatInterfaceCodex(codexFactory);

    chat.on('token', (e) => emitted.push(e));
    chat.on('final', (e) => emitted.push(e));
    chat.on('complete', (e) => emitted.push(e));

    await chat.run('Hello', { threadId: null }, 'conv-nonprefix', 'gpt-5');

    const finals = emitted.filter((e) => e.type === 'final');
    assert.equal(finals.length, 1);
    assert.equal(finals[0]?.content, 'I can help with that.');
  });

  it('keeps interleaved assistant item updates isolated by item id', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });
    const emitted: ChatEvent[] = [];
    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-interleaved' };
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', id: 'm1', text: 'Hello ' },
      };
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', id: 'm2', text: 'world' },
      };
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', id: 'm1', text: 'Hello there ' },
      };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm2', text: 'world!' },
      };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', id: 'm1', text: 'Hello there ' },
      };
      yield { type: 'turn.completed' };
    };
    const thread = {
      id: 'tid-interleaved',
      runStreamed: async () => ({ events: events() }),
    };
    const codexFactory = () => ({
      startThread: () => thread,
      resumeThread: () => thread,
    });
    const chat = new TestChatInterfaceCodex(codexFactory);

    chat.on('token', (e) => emitted.push(e));
    chat.on('final', (e) => emitted.push(e));

    await chat.run('Hello', { threadId: null }, 'conv-interleaved', 'gpt-5');

    const finals = emitted.filter((e) => e.type === 'final');
    assert.equal(finals.length, 1);
    assert.equal(finals[0]?.content, 'Hello there world!');
  });

  it('prefers stderr details over [object Object] when streamed startup throws a plain object', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    const errors: string[] = [];
    const thread = {
      id: 'tid-object-stderr',
      runStreamed: async () => {
        throw {
          code: 'ENOENT',
          stderr: 'spawn codex ENOENT',
        };
      },
    };
    const codexFactory = () => ({
      startThread: () => thread,
      resumeThread: () => thread,
    });
    const chat = new TestChatInterfaceCodex(codexFactory);
    chat.on('error', (event) => errors.push(event.message));

    await chat.run('Hello', { threadId: null }, 'conv-object-stderr', 'gpt-5');

    assert.deepEqual(errors, ['spawn codex ENOENT']);
  });

  it('falls back to a generic error when streamed startup throws a plain object with no text diagnostics', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    const errors: string[] = [];
    const thread = {
      id: 'tid-object-generic',
      runStreamed: async () => {
        throw {
          code: 'ENOENT',
        };
      },
    };
    const codexFactory = () => ({
      startThread: () => thread,
      resumeThread: () => thread,
    });
    const chat = new TestChatInterfaceCodex(codexFactory);
    chat.on('error', (event) => errors.push(event.message));

    await chat.run('Hello', { threadId: null }, 'conv-object-generic', 'gpt-5');

    assert.deepEqual(errors, ['codex unavailable']);
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

  it('preserves live web search when config defaults are used for an Unsloth-backed run', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    const captured: { start?: CodexThreadOptions } = {};
    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-live-search' };
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'ok' },
      };
      yield { type: 'turn.completed' };
    };

    const thread = {
      id: 'tid-live-search',
      runStreamed: async () => ({ events: events() }),
    };
    const chat = new TestChatInterfaceCodex(() => ({
      startThread: (opts?: CodexThreadOptions) => {
        captured.start = opts;
        return thread;
      },
      resumeThread: () => thread,
    }));

    await chat.run(
      'Hello',
      {
        threadId: null,
        useConfigDefaults: true,
        forceWebSearchModeWhenUsingConfigDefaults: 'live',
      },
      'conv-live-search',
      'gpt-5',
    );

    assert.equal(captured.start?.model, undefined);
    assert.equal(captured.start?.webSearchMode, 'live');
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

  it('passes validated codex thread-option flags into thread options', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    let lastOptions: CodexThreadOptions | undefined;
    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-flags' };
      yield { type: 'turn.completed' };
    };

    const thread = {
      id: 'tid-flags',
      runStreamed: async () => ({ events: events() }),
    };
    const codexFactory = () => ({
      startThread: (opts?: CodexThreadOptions) => {
        lastOptions = opts;
        return thread;
      },
      resumeThread: () => thread,
    });
    const chat = new TestChatInterfaceCodex(codexFactory);

    await chat.run(
      'Hello',
      {
        threadId: null,
        codexFlags: {
          sandboxMode: 'danger-full-access',
          networkAccessEnabled: false,
          webSearchMode: 'cached',
          approvalPolicy: 'never',
          modelReasoningEffort: 'medium',
        },
      },
      'conv-flags',
      'gpt-5',
    );

    assert.equal(lastOptions?.sandboxMode, 'danger-full-access');
    assert.equal(lastOptions?.networkAccessEnabled, false);
    assert.equal(lastOptions?.webSearchMode, 'cached');
    assert.equal(lastOptions?.approvalPolicy, 'never');
    assert.equal(lastOptions?.modelReasoningEffort, 'medium');
  });

  it('applies reasoning summary and verbosity as runtime config overrides', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    let capturedOptions: CodexOptions | undefined;
    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-runtime-overrides' };
      yield { type: 'turn.completed' };
    };

    const thread = {
      id: 'tid-runtime-overrides',
      runStreamed: async () => ({ events: events() }),
    };
    const codexFactory: MockCodexFactory = (options?: CodexOptions) => {
      capturedOptions = options;
      return {
        startThread: () => thread,
        resumeThread: () => thread,
      };
    };
    const chat = new TestChatInterfaceCodex(codexFactory);

    await chat.run(
      'Hello',
      {
        threadId: null,
        runtimeConfig: {
          model: 'gpt-5.3-codex-spark',
        },
        codexFlags: {
          modelReasoningSummary: 'concise',
          modelVerbosity: 'high',
        },
      },
      'conv-runtime-overrides',
      'gpt-5',
    );

    const config = capturedOptions?.config as
      | Record<string, unknown>
      | undefined;
    assert.equal(config?.model, 'gpt-5.3-codex-spark');
    assert.equal(config?.model_reasoning_summary, 'concise');
    assert.equal(config?.model_verbosity, 'high');
  });

  it('rejects endpoint-only execution when model_provider is not present in model_providers', async () => {
    resetMemory();
    setCodexDetection({
      available: false,
      authPresent: false,
      configPresent: true,
      reason: 'Missing auth.json in /tmp/codex',
    });

    let factoryCalled = false;
    const errors: string[] = [];
    const chat = new TestChatInterfaceCodex(() => {
      factoryCalled = true;
      return {
        startThread: () => {
          throw new Error('should not start thread');
        },
        resumeThread: () => {
          throw new Error('should not resume thread');
        },
      };
    });
    chat.on('error', (event) => errors.push(event.message));

    await chat.run(
      'Hello',
      {
        threadId: null,
        runtimeConfig: {
          model_provider: 'missing-provider',
          model_providers: {
            other_provider: {
              name: 'Other Provider',
            },
          },
        },
      },
      'conv-invalid-endpoint-only',
      'gpt-5',
    );

    assert.equal(factoryCalled, false);
    assert.deepEqual(errors, ['Missing auth.json in /tmp/codex']);
  });

  it('leaves missing codex flags undefined in thread options', async () => {
    resetMemory();
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
    });

    let lastOptions: CodexThreadOptions | undefined;
    const events = async function* () {
      yield { type: 'thread.started', thread_id: 'tid-flags-undefined' };
      yield { type: 'turn.completed' };
    };

    const thread = {
      id: 'tid-flags-undefined',
      runStreamed: async () => ({ events: events() }),
    };
    const codexFactory = () => ({
      startThread: (opts?: CodexThreadOptions) => {
        lastOptions = opts;
        return thread;
      },
      resumeThread: () => thread,
    });
    const chat = new TestChatInterfaceCodex(codexFactory);

    await chat.run(
      'Hello',
      { threadId: null, codexFlags: {} },
      'conv-flags-undefined',
      'gpt-5',
    );

    assert.equal(lastOptions?.sandboxMode, undefined);
    assert.equal(lastOptions?.networkAccessEnabled, undefined);
    assert.equal(lastOptions?.webSearchEnabled, undefined);
    assert.equal(lastOptions?.approvalPolicy, undefined);
    assert.equal(lastOptions?.modelReasoningEffort, undefined);
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
