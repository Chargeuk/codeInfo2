# Goal

Orient the coding agent to the exact current task and current automated-proof blocker immediately before deep blocker repair begins.

<task>

Read the persisted handoff state from disk, validate it, and restate the current task plus the automated-proof blocker or next incomplete proof step that the deep repair step should own.
Do not run any deep repair, implementation, or automated proof commands in this step.
Do not edit the plan, handoff files, code, tests, or configuration in this step.
This step exists only to prime the next deep automated-proof repair step with the freshest blocker context.

</task>

<scope_rules>

- Before doing anything else, read `$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md` and follow it.
- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Read `codeInfoStatus/flow-state/current-task.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/current-task.json`.
- Run `python3 "$CODEINFO_ROOT/scripts/check_current_task_handoff.py"` and use its JSON output to report whether the persisted handoff is currently valid.
- Determine the bound task number from `current-task.json` when it clearly resolves a task, then run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number <that-number>`.
- Re-open the exact relative `plan_path` from disk after reading the handoff files, then re-read the bound task from the plan before describing it.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<selection_rules>

- Use the task already resolved into `current-task.json` as the current task for this orientation step.
- Do not rediscover a different task by scanning the plan independently.
- If `current-task.json` does not clearly resolve a task, say that explicitly.
- If `check_current_task_handoff.py` reports an `active_selected_task`, include it in the summary even when the persisted handoff is invalid so the next step has the freshest visible task identity.

</selection_rules>

<blocker_rules>

- Use `selected_task.live_blockers` from `plan_status.py` as the blocker source of truth.
- If there is no live blocker, say that explicitly.
- If there is a live blocker, quote or paraphrase the exact blocker sufficiently for the next step to know what it is repairing.
- If there is no live blocker but unchecked `Testing` items remain, identify the first unchecked `Testing` item in list order as the next proof step the deep repair prompt may need to run.

</blocker_rules>

<output_contract>

Return a concise summary that includes:

1. whether `check_current_task_handoff.py` reported a valid current-task handoff;
2. the current task number and title from `current-task.json`, or an explicit statement that no task was clearly resolved there;
3. the parser-confirmed task status from `plan_status.py`;
4. the current live blocker text from `selected_task.live_blockers`, or an explicit statement that no live blocker is present;
5. the first unchecked `Testing` item in list order, if one exists;
6. whether the next deep repair step appears applicable, and what exact blocker or proof step it should start from.

</output_contract>

<verification_loop>

- confirm you read `current-plan.json` from disk first;
- confirm you read `current-task.json` from disk after that;
- confirm you ran `python3 "$CODEINFO_ROOT/scripts/check_current_task_handoff.py"`;
- confirm you used the task already resolved into `current-task.json` when one was available;
- confirm you ran `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number <bound-task-number>` when a task number was available;
- confirm you re-opened the plan from disk and re-read the bound task before describing it;
- confirm you used `selected_task.live_blockers` as the blocker source of truth;
- confirm you did not run any repair or automated-proof commands in this preflight step;
- confirm you did not edit the plan, code, tests, or handoff files in this preflight step.

</verification_loop>
