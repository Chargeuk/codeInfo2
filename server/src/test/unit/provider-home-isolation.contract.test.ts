import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const harnessFiles = [
  'server/src/test/integration/agents-run-ws-cancel.test.ts',
  'server/src/test/integration/flows.run.basic.test.ts',
  'server/src/test/integration/flows.run.command.test.ts',
  'server/src/test/integration/flows.run.errors.test.ts',
  'server/src/test/integration/flows.run.loop.test.ts',
  'server/src/test/integration/flows.run.resume.identity.test.ts',
  'server/src/test/integration/flows.run.subflow.test.ts',
  'server/src/test/integration/flows.run.working-folder.test.ts',
] as const;

test('server-unit flow harnesses avoid repo-root provider homes', async () => {
  for (const relativePath of harnessFiles) {
    const source = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');

    assert.match(source, /providerHomeHarness/u, relativePath);
    assert.doesNotMatch(
      source,
      /CODEINFO_CODEX_HOME:\s*path\.join\(repoRoot,\s*['"]codex['"]\)/u,
      relativePath,
    );
    assert.doesNotMatch(
      source,
      /process\.env\.CODEINFO_CODEX_HOME\s*=\s*path\.join\(repoRoot,\s*['"]codex['"]\)/u,
      relativePath,
    );
    assert.doesNotMatch(
      source,
      /CODEINFO_COPILOT_HOME:\s*path\.join\(repoRoot,\s*['"]copilot['"]\)/u,
      relativePath,
    );
    assert.doesNotMatch(
      source,
      /CODEINFO_LMSTUDIO_HOME:\s*path\.join\(repoRoot,\s*['"]lmstudio['"]\)/u,
      relativePath,
    );
  }
});
