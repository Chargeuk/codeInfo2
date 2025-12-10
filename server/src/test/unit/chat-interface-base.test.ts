import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { type TurnSummary } from '../../mongo/repo.js';
import { type TurnRole, type TurnStatus } from '../../mongo/turn.js';

class EventChat extends ChatInterface {
  async run(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void> {
    this.emitEvent({ type: 'token', content: message });
    this.emitEvent({ type: 'final', content: model });
    this.emitEvent({ type: 'complete' });
  }
}

class PersistChat extends ChatInterface {
  historyCalls: string[] = [];
  persistCalls: string[] = [];

  protected override async loadHistory(
    conversationId: string,
  ): Promise<TurnSummary[]> {
    this.historyCalls.push(conversationId);
    return [
      {
        conversationId,
        role: 'assistant',
        content: 'prev',
        model: 'model',
        provider: 'codex',
        source: 'REST',
        toolCalls: null,
        status: 'ok',
        createdAt: new Date(),
      },
    ];
  }

  protected override async persistTurn(input: {
    conversationId: string;
    role: TurnRole;
    content: string;
    model: string;
    provider: string;
    status: TurnStatus;
    source?: 'REST' | 'MCP';
  }): Promise<void> {
    this.persistCalls.push(
      `${input.conversationId}:${input.content}:${input.model}:${input.provider}:${input.status}:${input.source ?? 'REST'}`,
    );
  }

  async run(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void> {
    await this.loadHistory(conversationId);
    await this.persistTurn({
      conversationId,
      role: 'user' as TurnRole,
      content: message,
      model,
      provider: 'codex',
      source: 'REST',
      status: 'ok' as TurnStatus,
    });
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

test('persists history and turns via helpers', async () => {
  const chat = new PersistChat();
  await chat.run('hello', {}, 'conv-2', 'model-2');

  assert.deepEqual(chat.historyCalls, ['conv-2']);
  assert.equal(chat.persistCalls.length, 1);
  assert.equal(chat.persistCalls[0], 'conv-2:hello:model-2:codex:ok:REST');
});
