import assert from 'node:assert/strict';
import test from 'node:test';
import { getContentItems, getMessageRole } from '../../routes/chat.js';

test('getMessageRole returns data.role when present', () => {
  const role = getMessageRole({ data: { role: 'assistant', content: [] } });
  assert.equal(role, 'assistant');
});

test('getContentItems returns typed items from data.content', () => {
  const message = {
    data: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi' },
        {
          type: 'toolCallRequest',
          toolCallRequest: {
            id: '123',
            type: 'function',
            arguments: { query: 'foo' },
            name: 'VectorSearch',
          },
        },
      ],
    },
  };

  const items = getContentItems(message);

  assert.equal(items.length, 2);
  assert.equal(items[0]?.type, 'text');
  assert.equal((items[0] as { type: string; text: string }).text, 'hi');
  assert.equal(items[1]?.type, 'toolCallRequest');
});
