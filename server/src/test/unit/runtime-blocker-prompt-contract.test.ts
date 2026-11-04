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

test('deep proof repair consumes reliability guidance only within authorized scope', () => {
  // Static instruction contracts do not prove agent behavior or successful repair.
  const repair = readRepoFile('codeinfo_markdown/deep_test_failure_repair.md');
  const guide = readRepoFile(
    'codeinfo_markdown/shared/test-reliability-patterns.md',
  );
  assert.match(
    repair,
    /\$CODEINFO_ROOT\/codeinfo_markdown\/shared\/test-reliability-patterns\.md/u,
  );
  assert.match(
    repair,
    /approved story\/user contract authorizes brittle-test repairs/u,
  );
  assert.match(
    repair,
    /unrelated to or predating the story[^\n]*same-task proof-repair scope/u,
  );
  assert.match(repair, /coder owns test\/harness repairs/u);
  assert.match(
    repair,
    /automated testing agent owns execution and proof reporting/u,
  );
  assert.match(repair, /complete required full proof[^\n]*bounded recovery/u);
  assert.match(guide, /failed check[^\n]*not proof of brittleness/u);
  assert.match(guide, /BEFORE the trigger[^\n]*then await/u);
  assert.match(guide, /Dispatch accepted does not mean finished/u);
  assert.match(guide, /nonexhaustive guidance, not an all-story checklist/u);
  assert.match(
    guide,
    /Test-repair authority alone does not permit changing production behavior/u,
  );
});

test('manual proof prompt text requires preserved partial work and a fresh completion gate', () => {
  // This checks the instruction contract, not whether an agent follows it.
  const manual = readRepoFile(
    'codeinfo_markdown/manual_test_latest_completed_task.md',
  );
  const candidateRules = manual.match(
    /<candidate_selection_rules>([\s\S]*?)<\/candidate_selection_rules>/u,
  )?.[1];
  const outcomeRules = manual.match(
    /<outcome_rules>([\s\S]*?)<\/outcome_rules>/u,
  )?.[1];
  const selfAudit = manual.match(
    /<verification_loop>([\s\S]*?)<\/verification_loop>/u,
  )?.[1];
  assert.ok(candidateRules);
  assert.ok(outcomeRules);
  assert.ok(selfAudit);

  assert.match(
    candidateRules,
    /For partial independent proof, preserve existing unchecked implementation subtasks, unchecked mandatory `Testing` items, and live blockers; keep[^\n]*`__in_progress__`[^\n]*even when the independent surfaces pass or have a permitted skip\/not-applicable outcome/u,
  );
  assert.match(
    outcomeRules,
    /Before setting or keeping[^\n]*`__done__` under any outcome below, apply this completion gate/u,
  );
  assert.match(
    outcomeRules,
    /re-read[^\n]*shared\/current-task-handoff\.md[^\n]*rerun `python3 "\$CODEINFO_ROOT\/scripts\/plan_status\.py" --task-number <that-number>` against fresh disk state/u,
  );
  assert.match(
    outcomeRules,
    /require the parser-selected task to match the bound task from `current-task\.json`[^\n]*`selected_task\.subtasks_unchecked` equal to zero[^\n]*`selected_task\.testing_unchecked` equal to zero[^\n]*`selected_task\.live_blockers` empty/u,
  );
  assert.match(
    outcomeRules,
    /separately confirm from recorded proof evidence that all required manual proof is complete or has a repository-permitted skip\/not-applicable outcome; the checklist parser alone does not establish manual-proof completion/u,
  );
  assert.match(
    outcomeRules,
    /if any requirement fails or cannot be established, preserve existing unchecked work and live blockers and keep the task `__in_progress__`/u,
  );
  assert.match(
    outcomeRules,
    /If manual testing succeeds without finding further work:\n\s+- set[^\n]*`__done__` only if the completion gate above passes; otherwise record partial proof and keep the task `__in_progress__`/u,
  );
  assert.match(
    selfAudit,
    /Confirm partial independent proof preserved existing unchecked implementation subtasks, unchecked mandatory `Testing` items, and live blockers and kept the task `__in_progress__`/u,
  );
  assert.match(
    selfAudit,
    /Confirm every decision to set or keep the task `__done__` passed the fresh parser-backed completion gate:[^\n]*matched the current handoff[^\n]*no unchecked implementation subtasks, no unchecked mandatory `Testing` items, and no live blocker[^\n]*all required manual proof was complete or had a repository-permitted skip\/not-applicable outcome/u,
  );
});

test('both current-plan durable exits use the story script and preserve independent-proof gates', () => {
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
  for (const flowName of ['implement_current_plan', 'pr_current_plan']) {
    const flow = JSON.parse(readRepoFile(`flows/${flowName}.json`));
    const steps = flatten(flow.steps);
    const exit = steps.find(
      (step) =>
        step.label ===
        'Exit story flow successfully while durable blocker remains',
    );
    assert.ok(exit);
    assert.equal(
      exit.decisionScript,
      'scripts/flow_control/check_story_has_durable_blocker.py',
    );
    assert.equal(exit.exitFlow, true);
    assert.match(
      String(exit.question),
      /Return its current stdout exactly and nothing else/u,
    );
    assert.match(String(exit.question), /Do not recompute the answer/u);
    for (const label of [
      'Exit current task loop if implementation left a blocker',
      'Exit current task loop if task is blocked after proof',
      'Return to the top of current task rework if automated proof still has unchecked testing',
    ]) {
      const gate = steps.find((step) => step.label === label);
      assert.ok(gate);
      assert.equal(gate.decisionScript, undefined);
      assert.match(String(gate.question), /independent manual/u);
    }
  }
});
