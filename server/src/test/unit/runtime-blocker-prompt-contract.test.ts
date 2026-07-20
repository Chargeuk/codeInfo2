import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(process.cwd(), '..');

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('blocker repair prompts inspect the active Compose variant without restarting local', () => {
  for (const relativePath of [
    'codeinfo_markdown/research_blocker_solution_and_prove_it.md',
    'codeinfo_markdown/research_blocker_impact_on_plan.md',
    'codeinfo_markdown/deep_implementation_blocker_repair.md',
  ]) {
    const prompt = readRepoFile(relativePath);
    assert.match(prompt, /CODEINFO_RUNTIME_COMPOSE_FILE/u, relativePath);
    assert.match(prompt, /active/u, relativePath);
    assert.match(prompt, /Dockerfile/u, relativePath);
    assert.match(prompt, /compose:local/iu, relativePath);
    assert.match(
      prompt,
      /(?:never|do not)[^.\n]*(?:stop|restart)/iu,
      relativePath,
    );
  }
});
