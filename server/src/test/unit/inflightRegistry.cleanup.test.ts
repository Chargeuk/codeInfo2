import assert from 'node:assert/strict';
import test from 'node:test';

import { InflightRegistry } from '../../ws/inflightRegistry.js';

test('inflight registry cleans up entries on finalize', () => {
  const reg = new InflightRegistry();
  reg.createOrGetActive({ conversationId: 'c1', inflightId: 'i1' });
  assert.equal(reg.__debugCounts().active, 1);

  reg.finalize({ conversationId: 'c1', inflightId: 'i1', status: 'ok' });
  assert.equal(reg.__debugCounts().active, 0);
});

test('inflight registry cleans up entries on cancel', () => {
  const reg = new InflightRegistry();
  reg.createOrGetActive({ conversationId: 'c1', inflightId: 'i1' });
  assert.equal(reg.__debugCounts().active, 1);
  reg.cancel('c1', 'i1');
  assert.equal(reg.__debugCounts().active, 0);
});
