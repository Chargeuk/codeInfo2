import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __setGlobalCodexDetectionForTests,
  getCodexDetection,
  setCodexDetection,
  updateCodexDetection,
} from '../../providers/codexRegistry.js';
import { runWithTestOverrides } from '../support/testOverrideScope.js';

const globalDetection = {
  available: false,
  authPresent: false,
  configPresent: false,
  reason: 'global',
};

test('scoped Codex detection updates do not replace the global fallback', async () => {
  const originalDetection = getCodexDetection();
  __setGlobalCodexDetectionForTests(globalDetection);

  try {
    const scopedSetDetection = {
      available: true,
      authPresent: true,
      configPresent: true,
      reason: 'scoped set',
    };
    await runWithTestOverrides({}, async () => {
      setCodexDetection(scopedSetDetection);
      assert.deepEqual(getCodexDetection(), scopedSetDetection);
    });

    await runWithTestOverrides({}, async () => {
      assert.deepEqual(getCodexDetection(), globalDetection);

      const scopedUpdateDetection = {
        available: true,
        authPresent: false,
        configPresent: true,
        reason: 'scoped update',
      };
      assert.deepEqual(
        updateCodexDetection(scopedUpdateDetection),
        scopedUpdateDetection,
      );
      assert.deepEqual(getCodexDetection(), scopedUpdateDetection);
    });

    assert.deepEqual(getCodexDetection(), globalDetection);
  } finally {
    __setGlobalCodexDetectionForTests(originalDetection);
  }
});
