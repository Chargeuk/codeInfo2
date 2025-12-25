import assert from 'node:assert/strict';
import test from 'node:test';

import { InflightRegistry } from '../../ws/inflightRegistry.js';

test('inflight registry enforces max tool count', () => {
  const reg = new InflightRegistry();
  reg.createOrGetActive({ conversationId: 'c1', inflightId: 'i1' });

  const max = reg.__debugMaxTools();
  for (let i = 0; i < max + 50; i++) {
    reg.updateToolState('c1', 'i1', {
      id: `t-${i}`,
      status: 'requesting',
    });
  }

  const snap = reg.getActive('c1');
  assert.ok(snap);
  assert.equal(snap.tools.length, max);
});
