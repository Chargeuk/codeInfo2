# Goal

Normalize a structurally inconsistent active task so the overnight implementation loop can continue honestly instead of repeating a no-progress cycle.

<task>

Read the stored current-plan handoff and use only that scope for this step.
Re-open the exact plan file from disk before normalizing anything.
Identify the highest-numbered task whose `Task Status` is `__in_progress__`.
If there is no such task, or if that task still has unchecked subtasks, unchecked testing steps, or a live standalone `**BLOCKER**`, state that no normalization was needed and stop.
If that task is still `__in_progress__` even though all subtasks are checked, all testing steps are checked, and no live standalone `**BLOCKER**` exists, you MUST normalize the task into an honest state before work continues.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Re-open the exact relative `plan_path` from disk before normalizing.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<blocker_detection_rules>

- Before deciding whether the highest active task has a live blocker, read `codeinfo_markdown/shared/blocker-detection.md`.
- Run `python3 scripts/plan_status.py --selector active`.
- Use the parser output, not visual scanning, to determine whether the selected task contains any live blocker lines.
- Treat only lines reported by the parser under `selected_task.live_blockers` as live blockers for this normalization step.
- If you add or retire a live blocker during this step, rerun the parser before finalizing your answer so blocker state and task status match current disk state.

</blocker_detection_rules>

<normalization_rules>

- Treat a highest active task with all subtasks checked, all testing checked, and no live standalone `**BLOCKER**` as an invalid plan state that must not be left unchanged.
- Re-read the task's full section, including `Task Exit Criteria`, `Subtasks`, `Testing`, and `Implementation notes`, before deciding what to change.
- Then do exactly one of the following:
  - mark the task `__done__` if current repository evidence shows the remaining prose-only note is already satisfied or is not an honest remaining gate; or
  - convert the real remaining work into one or more unchecked subtasks, unchecked testing steps, or a live standalone `**BLOCKER**` note, and leave the task `__in_progress__`.
- Do not leave prose-only “still incomplete” notes as the sole reason a task remains `__in_progress__`.
- Keep the fix minimal and local to the inconsistent task unless a tiny cross-reference update is required for honesty.
- Before appending a new implementation note, re-read the latest existing implementation or audit note and avoid duplicating the same outcome.
- If you normalize by marking the task `__done__`, add one concise implementation note explaining that planner normalization closed a structurally inconsistent fully-checked task whose remaining prose-only gate was not an honest open owner.
- If you normalize by reopening checklist work instead, add one concise implementation note explaining what remaining work was converted into explicit unchecked ownership.

</normalization_rules>

<git_rules>

- If you make tracked changes, you MUST commit them before finishing this step.
- Do not push in this step.

</git_rules>

<output_contract>

Return a concise summary that includes:

1. which task was evaluated for normalization;
2. whether normalization was needed;
3. what change was made to restore an honest task state, if any;
4. whether the task is now `__done__` or remains `__in_progress__`.

</output_contract>

<verification_loop>

Before finishing:

- confirm you re-read the plan from disk;
- confirm you judged the inconsistent state from current plan state rather than memory;
- confirm you did not leave a fully checked, unblocked task as `__in_progress__`;
- confirm any remaining work was represented as unchecked checklist state or a live standalone `**BLOCKER**`, not only in prose;
- confirm tracked changes were committed if any were made.

</verification_loop>
