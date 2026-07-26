import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const read = (relativePath: string) =>
  fs.readFile(path.join(repoRoot, relativePath), 'utf8');

test('shared lifecycle permits repository test-stack reclamation without weakening local safety', async () => {
  const contract = await read(
    'codeinfo_markdown/shared/test-stack-lifecycle.md',
  );

  assert.match(contract, /repository testing workflow/u);
  assert.match(contract, /not to the individual agent or flow step/u);
  assert.match(contract, /repository ownership and testing applicability/u);
  assert.match(contract, /occupied port by itself is never authority/u);
  assert.match(contract, /documented shutdown wrapper/u);
  assert.match(contract, /does not matter which earlier agent or flow step/u);
  assert.match(
    contract,
    /between an already-completed startup item and its later test and shutdown items/u,
  );
  assert.match(contract, /`compose:local`/u);
  assert.match(contract, /a `\*-local` Compose project/u);
  assert.match(contract, /another repository or worktree/u);
  assert.match(contract, /recoverable test environment state/u);
  assert.match(
    contract,
    /Do not require per-agent ownership files, launch tokens, leases, or handoff records/u,
  );
});

test('manual and automated proof prompts consume the shared lifecycle at every recovery boundary', async () => {
  const consumers = [
    'codeinfo_markdown/manual_test_latest_completed_task.md',
    'codeinfo_markdown/preflight_visual_diagnosis_current_task.md',
    'codeinfo_markdown/run_automated_proof_and_fix_issues.md',
    'codeinfo_markdown/audit_after_automated_proof.md',
    'codeinfo_markdown/deep_test_failure_repair.md',
    'codeinfo_markdown/research_blocker_solution_and_prove_it.md',
    'codeinfo_markdown/research_blocker_impact_on_plan.md',
    'codeinfo_markdown/deep_implementation_blocker_repair.md',
    'codeinfo_markdown/research_implementation_blocker_repair.md',
  ];

  for (const relativePath of consumers) {
    const content = await read(relativePath);
    assert.match(content, /shared\/test-stack-lifecycle\.md/u, relativePath);
  }

  const manual = await read(
    'codeinfo_markdown/manual_test_latest_completed_task.md',
  );
  assert.match(manual, /another agent or flow step started it/u);
  assert.match(manual, /stop it with the documented repository workflow/u);
  assert.match(
    manual,
    /Never leave a newly started or reclaimed stack running/u,
  );

  const automated = await read(
    'codeinfo_markdown/run_automated_proof_and_fix_issues.md',
  );
  assert.match(automated, /occupied port or pre-existing stack/u);
  assert.match(automated, /repository-supported shutdown wrapper/u);
  assert.match(automated, /does not need to have started the earlier stack/u);
  assert.match(automated, /recoverable proof state/u);

  const visualPreflight = await read(
    'codeinfo_markdown/preflight_visual_diagnosis_current_task.md',
  );
  assert.doesNotMatch(
    visualPreflight,
    /If you started the stack in this step, leave it running/u,
  );
  assert.match(
    visualPreflight,
    /stop it with the documented repository workflow/u,
  );
});

test('repository guidance permits test-stack reclamation while preserving compose local', async () => {
  const guidance = await read('AGENTS.md');

  assert.match(guidance, /Repository-Owned Test Stack Reclamation/u);
  assert.match(guidance, /belongs to a repository they are permitted to test/u);
  assert.match(
    guidance,
    /occupied port or container name alone is not sufficient/u,
  );
  assert.match(
    guidance,
    /does not need to have been started by the same agent/u,
  );
  assert.match(
    guidance,
    /protected local development stack rules below still take precedence/u,
  );
  assert.match(guidance, /Do not run `npm run compose:local:down`/u);
});

test('all main implementation flows retain the shared tester and recovery prompt path', async () => {
  for (const relativePath of [
    'flows/implement_current_plan.json',
    'flows/implement_next_plan.json',
    'flows/improve_task_implement_plan.json',
    'flows/task_and_implement_plan.json',
  ]) {
    const flow = await read(relativePath);
    for (const prompt of [
      'preflight_visual_diagnosis_current_task.md',
      'run_automated_proof_and_fix_issues.md',
      'audit_after_automated_proof.md',
      'deep_test_failure_repair.md',
      'manual_test_latest_completed_task.md',
    ]) {
      assert.match(
        flow,
        new RegExp(prompt.replaceAll('.', '\\.')),
        relativePath,
      );
    }
  }
});
