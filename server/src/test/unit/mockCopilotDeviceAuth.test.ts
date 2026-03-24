import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCliMissingScenario,
  createFailureScenario,
  createMockCopilotDeviceAuthHarness,
  createVerificationReadyScenario,
} from '../support/mockCopilotDeviceAuth.js';

test('mock Copilot device-auth harness exposes verification URL, user code, and deterministic completion state', async () => {
  const harness = createMockCopilotDeviceAuthHarness(
    createVerificationReadyScenario({
      name: 'verification-ready',
      verificationUrl: 'https://github.com/login/device',
      userCode: 'WXYZ-1234',
      completionSequence: [
        { status: 'completion_pending' },
        { status: 'completed' },
      ],
    }),
  );

  const result = await harness.startDeviceAuth();

  assert.equal(result.status, 'verification_ready');
  if (result.status !== 'verification_ready') {
    return;
  }

  assert.equal(result.verificationUrl, 'https://github.com/login/device');
  assert.equal(result.userCode, 'WXYZ-1234');
  assert.match(result.rawOutput, /WXYZ-1234/u);

  const firstState = await result.completion;
  const secondState = await harness.readDeviceAuthState();

  assert.deepEqual(firstState, { status: 'completion_pending' });
  assert.deepEqual(secondState, { status: 'completed' });
  assert.equal(harness.getState().startCount, 1);
  assert.equal(harness.getState().completionReadCount, 2);
});

test('mock Copilot device-auth harness returns deterministic missing-cli and explicit failure outcomes', async () => {
  const cliMissingHarness = createMockCopilotDeviceAuthHarness(
    createCliMissingScenario({
      name: 'cli-missing',
      reason: 'copilot not found on PATH',
    }),
  );
  const failedHarness = createMockCopilotDeviceAuthHarness(
    createFailureScenario({
      name: 'failed',
      reason: 'copilot device auth failed',
    }),
  );

  const cliMissing = await cliMissingHarness.startDeviceAuth();
  const failed = await failedHarness.startDeviceAuth();

  assert.deepEqual(cliMissing, {
    status: 'unavailable_before_start',
    reason: 'copilot not found on PATH',
  });
  assert.deepEqual(failed, {
    status: 'failed',
    reason: 'copilot device auth failed',
  });
});
