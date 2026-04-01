# Goal

Run the selected task's automated proof, fix issues that arise, and leave the task in an honest state for audit.

<task>

Read the stored current-plan handoff and use only that scope for this step.
Re-open the exact plan file from disk before doing any work.
Identify the current candidate task for automated proof.
Run only that task's `Testing` section.
Fix issues that arise where possible, rerun proof honestly, and keep the plan up to date.
Do not perform manual testing in this step.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Re-open the exact relative `plan_path` from disk before starting.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<task_selection_rules>

- Scan the plan from bottom to top and identify the highest-numbered task whose `Task Status` is `__in_progress__`.
- Treat that task as the candidate task for this automated-proof step.
- If there is no `__in_progress__` task, report that automated proof is not applicable for this pass and do not edit files.
- Re-read that task's full text before running proof.

</task_selection_rules>

<skip_rules>

- If the candidate task contains a `**BLOCKER**` note, do not run automated proof.
- If the candidate task still has unchecked subtasks, do not run automated proof.
- If you skip automated proof for either reason, return a concise explanation and leave the task `__in_progress__`.

</skip_rules>

<proof_rules>

- Run only the candidate task's `Testing` section in this step.
- Follow the repository's wrapper-first guidance and the exact testing commands listed in the task.
- Inspect saved logs only when the wrapper output requires it or when the command otherwise fails unexpectedly.
- Mark each testing step complete immediately after it honestly passes.
- If a testing step fails, diagnose the exact failure, fix it if it is within the task's scope, and rerun the affected proof honestly.
- Keep implementation notes concise as you work so later steps can see what changed and why.

</proof_rules>

<fix_rules>

- You may fix code, tests, config, wrappers, or task-owned proof files as needed to make the candidate task's automated proof pass honestly.
- If automated proof reveals additional in-scope work that should be tracked explicitly, you may add concise new unchecked subtasks or testing steps to the same task before continuing.
- Do not invent fake proof, fake passing output, fake runtime seams, fake containers, or fake harnesses.

</fix_rules>

<blocker_rules>

- If a testing step becomes honestly blocked, stop and write a `**BLOCKER**` note into the task's `Implementation Notes`.
- The blocker note must include:
  - the exact testing step where work stopped;
  - what you tried;
  - the exact missing capability, failing contract, or contradiction;
  - whether the task should be split, reordered, or rewritten before work continues.
- If blocked, leave the task `__in_progress__`.
- Do not mark blocked testing steps complete.

</blocker_rules>

<manual_testing_boundary>

- Do not perform manual Playwright, browser, or agent-driven validation in this step.
- Do not add manual-testing-only proof here.
- Manual testing is handled later in the flow.

</manual_testing_boundary>

<git_rules>

- If you make tracked changes, you MUST commit them before finishing this step.
- Do not push in this step.

</git_rules>

<output_contract>

Return a concise summary that includes:

1. which task you evaluated;
2. whether automated proof ran or was skipped;
3. which testing steps now pass;
4. whether any blocker remains;
5. any important commands or outputs that indicate success.

Do not mark the task `__done__` in this step. The later audit step decides that.

</output_contract>

<verification_loop>

Before finishing:

- confirm you re-read the plan from disk;
- confirm you selected the highest-numbered `__in_progress__` task;
- confirm you ran only the `Testing` section or honestly skipped it;
- confirm each completed testing step was marked immediately;
- confirm any blocker was recorded as `**BLOCKER**`;
- confirm you did not perform manual testing;
- confirm tracked changes were committed if any were made.

</verification_loop>
