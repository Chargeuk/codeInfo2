# Goal

Re-check the active plan after planner edits so the next loop pass continues from the correct active task rather than stale task-selection assumptions.

<task>

Read the stored current-plan handoff first and use only that scope for this step.
Re-open the exact plan file from disk after the planner step.
Validate the current plan scope again.
Identify the active task for the next loop pass using the updated plan on disk.
Summarize what changed and what the next pass should do.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Re-open the exact relative `plan_path` stored there after the planning agent step.
- Verify that the selected plan file still exists in the current repository and that the story number in the current repository branch name matches the story number in the selected plan filename.
- If either of those checks fails, stop and say the current-plan handoff is stale and must be regenerated.
- Then verify that every additional repository still exists, is readable, and is still on a branch whose story number matches the selected plan filename.
- If an additional repository path is missing, invalid, or unreadable, stop and say the current-plan handoff is stale and must be regenerated.
- If an additional repository no longer has a branch whose story number matches the selected plan filename, stop and say repository branch scope has drifted and must be repaired before continuing.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<task_selection_rules>

- Read the end of the plan file from disk and report the highest `### <number>.` task heading currently present.
- Confirm any `Task Status` updates, new tasks, or task renumbering that occurred after the planner edits.
- If any task is currently `__in_progress__`, the highest-numbered `__in_progress__` task is the active task for the next pass.
- Do not advance to a later `__to_do__` task while any task remains `__in_progress__`.
- If the active `__in_progress__` task has no unchecked subtasks, do not treat that as permission to advance; instead, report that the task remains active and is ready for automated proof or other remaining non-subtask work.
- If the active `__in_progress__` task was returned by planner blocker repair, state explicitly whether the repaired task now has a bounded next implementation step or whether planner repair is still incomplete.
- Only if no task is `__in_progress__` may you identify the next executable task from the remaining `__to_do__` tasks.
- If you conclude there is no next task, you must explicitly confirm that the highest-numbered task is `__done__` and that no later task heading exists.

</task_selection_rules>

<git_rules>

- Run `git status -sb` to verify the plan file change was committed before continuing.

</git_rules>

<output_contract>

Return a concise summary that includes:

1. the highest task heading currently present;
2. any task-status updates, new tasks, or renumbering that occurred;
3. which task is now the active task for the next pass;
4. whether that active task needs implementation work or is instead waiting for automated proof or other remaining non-subtask work.

</output_contract>

<verification_loop>

Before finishing:

- confirm you re-read the plan from disk after the planner edits;
- confirm you validated the current scope from `current-plan.json`;
- confirm you preferred the highest-numbered `__in_progress__` task when one exists;
- confirm you did not advance past an `__in_progress__` task merely because its subtasks were complete;
- confirm you checked `git status -sb` before finalizing.

</verification_loop>
