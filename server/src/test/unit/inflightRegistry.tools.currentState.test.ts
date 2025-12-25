import assert from 'node:assert/strict';
import test from 'node:test';

import { InflightRegistry } from '../../ws/inflightRegistry.js';

test('inflight registry tool state updates in-place', () => {
  const reg = new InflightRegistry();
  reg.createOrGetActive({ conversationId: 'c1', inflightId: 'i1' });

  reg.updateToolState('c1', 'i1', {
    id: 't1',
    name: 'VectorSearch',
    status: 'requesting',
    stage: 'started',
  });
  reg.updateToolState('c1', 'i1', {
    id: 't1',
    status: 'done',
    stage: 'success',
    result: { ok: true },
  });

  const snap = reg.getActive('c1');
  assert.ok(snap);
  assert.equal(snap.tools.length, 1);
  assert.equal(snap.tools[0].id, 't1');
  assert.equal(snap.tools[0].status, 'done');
});
