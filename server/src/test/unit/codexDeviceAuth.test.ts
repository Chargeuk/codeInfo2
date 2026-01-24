import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseCodexDeviceAuthOutput,
  resolveCodexDeviceAuthResult,
} from '../../utils/codexDeviceAuth.js';

describe('codexDeviceAuth', () => {
  it('parses verification URL + user code from stdout', () => {
    const stdout =
      'Open https://example.com/device and enter code ABCD-EFGH.\n' +
      'Code expires in 900 seconds.';

    const result = parseCodexDeviceAuthOutput(stdout);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.verificationUrl, 'https://example.com/device');
      assert.equal(result.userCode, 'ABCD-EFGH');
      assert.equal(result.expiresInSec, 900);
    }
  });

  it('returns an error when stdout is missing required fields', () => {
    const result = parseCodexDeviceAuthOutput('Missing fields');

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, 'device auth output not recognized');
    }
  });

  it('reports non-zero exit codes as failures', () => {
    const result = resolveCodexDeviceAuthResult({
      exitCode: 1,
      stdout: 'Open https://example.com/device and enter code ABCD-EFGH',
      stderr: '',
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, 'device auth command failed');
    }
  });

  it('surfaces expired/declined device code errors', () => {
    const result = resolveCodexDeviceAuthResult({
      exitCode: 1,
      stdout: '',
      stderr: 'device code expired',
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, 'device code expired or was declined');
    }
  });
});
