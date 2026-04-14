# Goal

Resolve the single current task for this implementation-loop pass, or record that the loop must skip into plan repair instead.

<task>

Read the stored current-plan handoff and use only that scope for this step.
Run `python3 scripts/select_current_task.py`.
Read `codeInfoStatus/flow-state/current-task.json` from disk after the script finishes, for example with `cat codeInfoStatus/flow-state/current-task.json`, and determine its meaning from what it contains rather than depending on an exact JSON shape.
If it says a current task was resolved, re-open the exact plan from disk and re-read that bound task before answering.
If it says the plan needs repair, or the story is already complete, report that clearly and do not invent a task anyway.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Treat `codeInfoStatus/flow-state/current-task.json` as a per-iteration flow-state artifact rather than as a durable tracked handoff like `current-plan.json`.
- If a task is resolved, re-open the exact `plan_path` from disk with shell reads such as `sed`, `cat`, or `rg` so you are looking at the current file contents rather than memory.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<script_rules>

- Use the Python selector as the authoritative task-resolution step for this loop pass.
- Do not re-implement its selection logic manually before running it.
- The selector may normalize stale `Task Status` values in the plan before it writes `current-task.json`.
- If the selector changed any tracked plan file content, commit those tracked changes before finishing this step.
- Do not commit `codeInfoStatus/flow-state/current-task.json`.

</script_rules>

<output_contract>

Return a concise summary that includes:

1. whether a task was resolved, the plan needs repair, or the story is complete;
2. which task was bound when one was resolved;
3. whether the selector normalized any stale task statuses;
4. whether any tracked plan-file changes were committed.

</output_contract>

<verification_loop>

- confirm you read `current-plan.json` first;
- confirm you ran `python3 scripts/select_current_task.py`;
- confirm you read `current-task.json` after the script finished;
- confirm you re-opened the plan and re-read the bound task from disk when a task was resolved;
- confirm you did not invent a different task when the selector said repair was needed or the story was complete;
- confirm tracked plan-file changes were committed if any occurred;
- confirm `current-task.json` was not committed.

</verification_loop>
