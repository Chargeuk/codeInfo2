import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildCucumberImportArgs,
  deriveTargetedStepImports,
  normalizeServerPath,
} from './test-summary-server-cucumber-imports.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const serverDir = path.join(rootDir, 'server');

test('targeted feature imports keep global support hooks and add matching step files', () => {
  const importArgs = buildCucumberImportArgs(serverDir, [
    'src/test/features/chat_models.feature',
    'server/src/test/features/chat_stream.feature',
  ]);

  assert.deepEqual(importArgs, [
    '--import',
    'src/test/support/chromaContainer.ts',
    '--import',
    'src/test/support/mongoContainer.ts',
    '--import',
    'src/test/support/registerCucumberEnvIsolation.ts',
    '--import',
    'src/test/steps/chat_models.steps.ts',
    '--import',
    'src/test/steps/chat_stream.steps.ts',
  ]);
});

test('default feature imports still include support hooks plus the step glob', () => {
  const importArgs = buildCucumberImportArgs(serverDir, []);

  assert.deepEqual(importArgs, [
    '--import',
    'src/test/support/chromaContainer.ts',
    '--import',
    'src/test/support/mongoContainer.ts',
    '--import',
    'src/test/support/registerCucumberEnvIsolation.ts',
    '--import',
    'src/test/steps/**/*.ts',
  ]);
});

test('normalizeServerPath strips the repository-level server prefix', () => {
  assert.equal(
    normalizeServerPath('server/src/test/features/chat_models.feature'),
    'src/test/features/chat_models.feature',
  );
});

test('targeted feature imports reject crafted paths that would escape the step-definition subtree', async (t) => {
  const tempServerDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'cucumber-imports-'),
  );
  t.after(async () => {
    await fs.rm(tempServerDir, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(tempServerDir, 'scripts'), { recursive: true });
  await fs.writeFile(
    path.join(tempServerDir, 'scripts', 'escape.steps.ts'),
    '// escape\n',
    'utf8',
  );

  assert.deepEqual(
    deriveTargetedStepImports(tempServerDir, [
      'src/test/features/../../../scripts/escape.feature',
    ]),
    [],
  );
  assert.deepEqual(
    buildCucumberImportArgs(tempServerDir, [
      'src/test/features/../../../scripts/escape.feature',
    ]),
    [
      '--import',
      'src/test/support/chromaContainer.ts',
      '--import',
      'src/test/support/mongoContainer.ts',
      '--import',
      'src/test/support/registerCucumberEnvIsolation.ts',
      '--import',
      'src/test/steps/**/*.ts',
    ],
  );
});
