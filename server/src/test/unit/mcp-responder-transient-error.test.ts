import assert from 'node:assert/strict';
import test from 'node:test';

import { McpResponder } from '../../chat/responders/McpResponder.js';

test('McpResponder ignores transient reconnect errors', () => {
  const responder = new McpResponder();
  responder.handle({ type: 'error', message: 'Reconnecting... 1/5' } as never);

  assert.doesNotThrow(() => responder.toResult('m1', 'c1'));
});
