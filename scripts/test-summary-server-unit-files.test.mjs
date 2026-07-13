import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { runLoggedCommand } from './summary-wrapper-protocol.mjs';
import { DEFAULT_SERVER_UNIT_TEST_FILES } from './test-summary-server-unit-files.mjs';

test('server unit default file inventory includes wrapper self-tests before the server suites', () => {
  assert.deepEqual(DEFAULT_SERVER_UNIT_TEST_FILES.slice(0, 3), [
    '../scripts/test-summary-server-unit-files.test.mjs',
    '../scripts/test-summary-server-unit-env.test.mjs',
    '../scripts/test-summary-server-cucumber-imports.test.mjs',
  ]);
});

test('server unit default file inventory still includes the checked-in server suite globs', () => {
  assert.deepEqual(DEFAULT_SERVER_UNIT_TEST_FILES.slice(3), [
    'src/test/unit/*.test.ts',
    'src/test/integration/*.test.ts',
    'src/test/mcp2/**/*.test.ts',
  ]);
});

test('server unit watchdog ignores nested TAP plans when outer progress continues', async () => {
  const result = await runLoggedCommand({
    cmd: process.execPath,
    args: [
      '-e',
      "console.log('1..0'); setTimeout(() => console.log('ok 1 - outer progress'), 5); setTimeout(() => process.exit(0), 80);",
    ],
    logStream: new PassThrough(),
    semanticProgressPatterns: [/^ok \d+ - /],
    terminalSummaryPatterns: [/^1\.\./],
    terminalSummaryGraceMs: 25,
    progressWatchdogIntervalMs: 10,
  });

  assert.equal(result.code, 0);
  assert.equal(result.forcedReason, undefined);
  assert.equal(result.lastProgressLine, 'ok 1 - outer progress');
});
