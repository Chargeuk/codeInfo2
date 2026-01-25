import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import {
  parseCodexDeviceAuthOutput,
  resolveCodexDeviceAuthResult,
  runCodexDeviceAuth,
} from '../../utils/codexDeviceAuth.js';

type SpawnFn = typeof import('node:child_process').spawn;

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

  it('parses ANSI-colored device-auth output', () => {
    const stdout =
      '\u001b[32mOpen\u001b[0m https://example.com/device and enter ' +
      'code \u001b[1mABCD-EFGH\u001b[0m.\n' +
      '\u001b[90mCode expires in 900 seconds.\u001b[0m\n' +
      'Use codex device auth to continue.';

    const result = parseCodexDeviceAuthOutput(stdout);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.verificationUrl, 'https://example.com/device');
      assert.equal(result.userCode, 'ABCD-EFGH');
      assert.equal(result.expiresInSec, 900);
    }
  });

  it('does not match code inside the word codex', () => {
    const stdout =
      'Open https://example.com/device and enter codex to continue.';

    const result = parseCodexDeviceAuthOutput(stdout);

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

  it('resolves completion after the CLI process closes', async () => {
    const child = new EventEmitter() as ChildProcess & {
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();

    const spawnFn = (() => child as ChildProcess) as SpawnFn;

    const runPromise = runCodexDeviceAuth({ spawnFn });
    child.stdout.write(
      'Open https://example.com/device and enter code ABCD-EFGH.\n',
    );

    const result = await runPromise;
    assert.equal(result.ok, true);

    let completionResolved = false;
    const completionPromise = result.completion.then((completion) => {
      completionResolved = true;
      return completion;
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completionResolved, false);

    child.emit('close', 0);

    const completion = await completionPromise;
    assert.equal(completion.exitCode, 0);
    assert.equal(completion.result.ok, true);
  });
});
