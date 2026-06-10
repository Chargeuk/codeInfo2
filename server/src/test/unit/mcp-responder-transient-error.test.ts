import assert from 'node:assert/strict';
import test from 'node:test';

import { isTransientReconnect } from '../../agents/transientReconnect.js';
import { McpResponder } from '../../chat/responders/McpResponder.js';

test('transient reconnect classifier accepts bare and suffixed reconnect notices', () => {
  assert.equal(isTransientReconnect('Reconnecting... 1/5'), true);
  assert.equal(
    isTransientReconnect(
      'Reconnecting... 2/5 (stream disconnected before completion: websocket closed by server before response.completed)',
    ),
    true,
  );
  assert.equal(
    isTransientReconnect(
      'stream disconnected before completion: websocket closed by server before response.completed',
    ),
    false,
  );
});

test('McpResponder ignores transient reconnect errors with upstream cause text', () => {
  const responder = new McpResponder();
  responder.handle({
    type: 'error',
    message:
      'Reconnecting... 2/5 (stream disconnected before completion: websocket closed by server before response.completed)',
  } as never);

  assert.doesNotThrow(() => responder.toResult('m1', 'c1'));
});
