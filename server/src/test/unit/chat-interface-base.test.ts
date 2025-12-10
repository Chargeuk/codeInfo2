import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';

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
