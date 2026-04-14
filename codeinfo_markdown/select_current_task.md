# Goal

Resolve the single current task for this implementation-loop pass, or record that the loop must skip into plan repair instead.

<critical_rules>

- Before doing anything else, read `codeinfo_markdown/shared/current-task-handoff.md` and follow its disk-reread rules after the selector writes `current-task.json`.
- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Run `python3 scripts/select_current_task.py` before doing any manual task selection.
- Treat the Python selector as the authoritative task-resolution step for this pass; do not re-implement its selection logic manually.
- Read `codeInfoStatus/flow-state/current-task.json` from disk after the script finishes, for example with `cat codeInfoStatus/flow-state/current-task.json`, and determine its meaning from what it contains rather than depending on an exact JSON shape.
- Treat `codeInfoStatus/flow-state/current-task.json` as a per-iteration flow-state artifact rather than as a durable tracked handoff like `current-plan.json`.
- If the selector changed any tracked plan file content, commit those tracked changes before finishing this step.
- Do not commit `codeInfoStatus/flow-state/current-task.json`.

</critical_rules>

<exact_step_order>

1. Read `current-plan.json` from disk.
2. Determine the exact `plan_path` and repository scope from that handoff.
3. Run `python3 scripts/select_current_task.py`.
4. Read `current-task.json` from disk after the script finishes.
5. If `current-task.json` says a current task was resolved, re-open the exact `plan_path` from disk with shell reads such as `sed`, `cat`, or `rg`, then re-read the bound task before answering.
6. If `current-task.json` says the plan needs repair, the story is complete, or a task could not be resolved, report that state clearly and do not invent a task anyway.

</exact_step_order>

<edge_case_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Do not rediscover a different story independently.
- If `current-task.json` is missing or unreadable after the selector runs, stop and say the current task handoff must be regenerated.
- If the selector resolved a task but the plan no longer contains that task when you re-open it from disk, stop and say the current task handoff must be regenerated.

</edge_case_rules>

<output_contract>

Return a concise summary that includes:

1. whether a task was resolved, the plan needs repair, or the story is complete;
2. which task was bound when one was resolved;
3. whether the selector normalized any stale task statuses;
4. whether any tracked plan-file changes were committed.

</output_contract>

<correct_example>

- Example resolved path:
  - read `current-plan.json`;
  - run `python3 scripts/select_current_task.py`;
  - read `current-task.json`;
  - if it resolves Task 12, re-open the plan from disk and re-read `### Task 12.` before answering;
  - report Task 12 as the bound task for this loop pass.

</correct_example>

<verification_loop>

- confirm you read `current-plan.json` first;
- confirm you ran `python3 scripts/select_current_task.py`;
- confirm you read `current-task.json` after the script finished;
- confirm you re-opened the plan and re-read the bound task from disk when a task was resolved;
- confirm you did not invent a different task when the selector said repair was needed or the story was complete;
- confirm tracked plan-file changes were committed if any occurred;
- confirm `current-task.json` was not committed.

</verification_loop>
