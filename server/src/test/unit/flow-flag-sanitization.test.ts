import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeConversationFlagsForProvider } from '../../chat/agentFlags.js';

test('ordinary conversation flag sanitization drops flow-owned metadata while nested flow writers remain the owner', () => {
  assert.deepEqual(
    sanitizeConversationFlagsForProvider(
      'codex',
      {
        flow: { executionId: 'smuggled-parent-1' },
        flowChild: { executionId: 'smuggled-child-1' },
        threadId: 'thread-1',
        workingFolder: '/repos/flow-root',
      },
      { preserveFlowState: false },
    ),
    {
      threadId: 'thread-1',
      workingFolder: '/repos/flow-root',
    },
  );
});
