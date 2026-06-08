import assert from 'node:assert/strict';
import test from 'node:test';

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
