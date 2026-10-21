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
    'codeinfo_markdown/research_implementation_blocker_repair.md',
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

test('stronger implementation blocker repair is autonomous, cross-task, minimal, and honest', () => {
  const prompt = readRepoFile(
    'codeinfo_markdown/research_implementation_blocker_repair.md',
  );

  assert.match(prompt, /shared\/current-task-handoff\.md/u);
  assert.match(prompt, /--profile blocker-repair --task current/u);
  assert.match(prompt, /selected_task\.live_blockers/u);
  assert.match(prompt, /bound task defines the outcome/u);
  assert.match(prompt, /outside the current task/u);
  assert.match(prompt, /repositories authorized by the persisted/u);
  assert.match(prompt, /other ingested repository/u);
  assert.match(prompt, /official documentation/u);
  assert.match(prompt, /internet research/u);
  assert.match(
    prompt,
    /Research may be broad, but implementation must remain narrow/u,
  );
  assert.match(prompt, /smallest focused evidence-backed change/u);
  assert.match(prompt, /directly causes the blocker/u);
  assert.match(
    prompt,
    /same file, class, module, task, repository, or subsystem/u,
  );
  assert.match(prompt, /every narrower safe repair has been disproved/u);
  assert.match(prompt, /Implementation Notes/u);
  assert.match(prompt, /why each changed file was necessary/u);
  assert.match(prompt, /Do not mark a testing checkbox complete unless/u);
  assert.match(prompt, /\*\*RESOLVED ISSUE\*\*/u);
  assert.match(prompt, /\*\*BLOCKING ANSWER\*\*/u);
  assert.match(prompt, /Create separate commits in each changed repository/u);
  assert.match(prompt, /Do not push/u);
  assert.match(prompt, /not valid stopping reasons/u);
  assert.match(prompt, /speculative redesign or unrelated improvement/u);
});

test('proof prompts isolate blocked checks without weakening mandatory proof', () => {
  const automated = readRepoFile(
    'codeinfo_markdown/run_automated_proof_and_fix_issues.md',
  );
  assert.ok(
    !automated.includes(
      'If `selected_task.live_blockers` is non-empty, do not run automated proof.',
    ),
  );
  assert.match(automated, /map each blocker to its affected checks/u);
  assert.match(automated, /attempt every independent command/u);
  assert.match(
    automated,
    /leave the item unchecked until all required results pass/u,
  );
  assert.match(automated, /perform the documented owned cleanup/u);
  assert.match(automated, /do not bypass an explicit prerequisite/u);
  const manual = readRepoFile(
    'codeinfo_markdown/manual_test_latest_completed_task.md',
  );
  assert.match(manual, /Perform only verified independent manual proof/u);
  assert.match(manual, /This is partial proof, not task completion/u);
});

test('current-plan blocker exit assesses remaining progress instead of executing the blanket blocker predicate', () => {
  const flow = JSON.parse(readRepoFile('flows/implement_current_plan.json'));
  const flatten = (
    steps: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> =>
    steps.flatMap((step) => [
      step,
      ...['steps', 'then', 'else'].flatMap((key) =>
        Array.isArray(step[key])
          ? flatten(step[key] as Array<Record<string, unknown>>)
          : [],
      ),
    ]);
  const steps = flatten(flow.steps);
  const exit = steps.find(
    (step) =>
      step.label ===
      'Exit story flow successfully while durable blocker remains',
  );
  assert.ok(exit);
  assert.equal(exit.decisionScript, undefined);
  assert.equal(exit.exitFlow, true);
  assert.match(
    String(exit.question),
    /every safe independent required implementation, automated proof, manual proof and owned cleanup action/u,
  );
  assert.match(String(exit.question), /exit INCOMPLETE/u);
  for (const label of [
    'Exit current task loop if implementation left a blocker',
    'Exit current task loop if task is blocked after proof',
    'Return to the top of current task rework if automated proof still has unchecked testing',
  ]) {
    const gate = steps.find((step) => step.label === label);
    assert.ok(gate);
    assert.match(String(gate.question), /independent manual/u);
  }
});
