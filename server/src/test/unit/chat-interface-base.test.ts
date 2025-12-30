import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import type { ChatToolResultEvent } from '../../chat/interfaces/ChatInterface.js';
import type { AppendTurnInput } from '../../mongo/repo.js';
import type { TurnSource, TurnStatus } from '../../mongo/turn.js';

class EventChat extends ChatInterface {
  async execute(
    message: string,
    _flags: Record<string, unknown>,
    _conversationId: string,
    model: string,
  ): Promise<void> {
    this.emitEvent({ type: 'token', content: message });
    this.emitEvent({ type: 'final', content: model });
    this.emitEvent({ type: 'complete' });
  }
}

test('emits events in order', async () => {
  const chat = new EventChat();
  const seen: string[] = [];

  chat.on('token', (event) => seen.push(event.type));
  chat.on('final', (event) => seen.push(event.type));
  chat.on('complete', (event) => seen.push(event.type));

  await chat.run('hi', {}, 'conv-1', 'model-1');

  assert.deepEqual(seen, ['token', 'final', 'complete']);
});

class PersistingChat extends ChatInterface {
  public assistant: {
    content: string;
    status: TurnStatus;
    toolCalls: ChatToolResultEvent[];
  } | null = null;
  public turns: Array<{ role: string; content: string }> = [];

  async execute(): Promise<void> {
    // no-op, subclasses override in tests
  }

  protected override async persistTurn(
    input: AppendTurnInput & { source?: TurnSource },
  ): Promise<{ turnId?: string }> {
    this.turns.push({ role: input.role, content: input.content });
    return {};
  }

  protected override async persistAssistantTurn(params: {
    conversationId: string;
    content: string;
    model: string;
    provider: string;
    source: TurnSource;
    status: TurnStatus;
    toolCalls: ChatToolResultEvent[];
    skipPersistence: boolean;
  }): Promise<string | undefined> {
    this.assistant = {
      content: params.content,
      status: params.status,
      toolCalls: params.toolCalls,
    };
    return undefined;
  }
}

describe('ChatInterface assistant buffering', () => {
  test('persists token-only content with ok status', async () => {
    class TokenOnlyChat extends PersistingChat {
      async execute(): Promise<void> {
        this.emitEvent({ type: 'token', content: 'hi' });
        this.emitEvent({ type: 'complete' });
      }
    }
    const chat = new TokenOnlyChat();
    await chat.run('u', {}, 'c1', 'm1');
    assert.equal(chat.assistant?.content, 'hi');
    assert.equal(chat.assistant?.status, 'ok');
    assert.deepEqual(chat.assistant?.toolCalls, []);
  });

  test('prefers final content over tokens', async () => {
    class FinalChat extends PersistingChat {
      async execute(): Promise<void> {
        this.emitEvent({ type: 'token', content: 'tok' });
        this.emitEvent({ type: 'final', content: 'final-text' });
        this.emitEvent({ type: 'complete' });
      }
    }
    const chat = new FinalChat();
    await chat.run('u', {}, 'c2', 'm2');
    assert.equal(chat.assistant?.content, 'final-text');
  });

  test('captures tool results', async () => {
    class ToolChat extends PersistingChat {
      async execute(): Promise<void> {
        this.emitEvent({
          type: 'tool-result',
          callId: '1',
          result: { ok: true },
          name: 'VectorSearch',
        });
        this.emitEvent({ type: 'final', content: 'done' });
        this.emitEvent({ type: 'complete' });
      }
    }
    const chat = new ToolChat();
    await chat.run('u', {}, 'c3', 'm3');
    assert.equal(chat.assistant?.toolCalls.length, 1);
    assert.deepEqual(chat.assistant?.toolCalls[0], {
      type: 'tool-result',
      callId: '1',
      result: { ok: true },
      name: 'VectorSearch',
    });
  });

  test('marks status failed on error event', async () => {
    class ErrorChat extends PersistingChat {
      async execute(): Promise<void> {
        this.emitEvent({ type: 'error', message: 'boom' });
        this.emitEvent({ type: 'complete' });
      }
    }
    const chat = new ErrorChat();
    await chat.run('u', {}, 'c4', 'm4');
    assert.equal(chat.assistant?.status, 'failed');
  });

  test('marks status stopped when external signal aborted', async () => {
    class StopChat extends PersistingChat {
      async execute(): Promise<void> {
        this.emitEvent({ type: 'complete' });
      }
    }
    const controller = new AbortController();
    controller.abort();
    const chat = new StopChat();
    await chat.run('u', { signal: controller.signal }, 'c5', 'm5');
    assert.equal(chat.assistant?.status, 'stopped');
  });
});
