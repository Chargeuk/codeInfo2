# Goal

Normalize structurally inconsistent task state so the overnight implementation loop can continue honestly instead of repeating a no-progress cycle.

<task>

Before doing anything else, read `$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md` and follow it.
Read the stored current-plan handoff and use only that scope for this step.
Read `codeInfoStatus/flow-state/current-task.json` from disk if it exists, for example with `cat codeInfoStatus/flow-state/current-task.json`, and determine its meaning from what it contains rather than depending on an exact JSON shape.
Load compact task status first, then load a fresh bounded packet for the exact inconsistent task before normalizing anything.
Identify the highest-numbered task whose `Task Status` is `__in_progress__`.
If there is no such task, identify the highest-numbered task whose `Task Status` is `__done__` but whose parser state still reports unchecked subtasks, unchecked testing steps, or a live standalone `**BLOCKER**`.
If `current-task.json` says the plan needs repair for any reason, treat that as an inconsistent state that MUST be repaired before work continues.
If `current-task.json` says no current task could be selected because no open or todo task was found, you MUST repair the plan so the next selector pass will either:

- resolve exactly one current task; or
- honestly report story completion.
  If no such inconsistent task exists, state that no normalization was needed and stop.
  If the inconsistent task is `__in_progress__` even though all subtasks are checked, all testing steps are checked, and no live standalone `**BLOCKER**` exists, you MUST normalize that task into an honest state before work continues.
  If the inconsistent task is `__done__` even though unchecked subtasks, unchecked testing steps, or a live standalone `**BLOCKER**` still remain, you MUST repair that invalid `__done__` state before work continues.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --include-tasks` to identify the highest-numbered inconsistent task without depending on `current-task.json` having a selection.
- If `current-task.json` contains a valid selected task, run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile current-task --task current`. Otherwise, run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --task-number <inconsistent-task-number> --section Overview --section "Task Exit Criteria" --section Subtasks --section Testing --section "Implementation Notes"`. Use only that bounded task packet before normalizing.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<blocker_detection_rules>

- Before deciding whether the highest active task has a live blocker, read `$CODEINFO_ROOT/codeinfo_markdown/shared/blocker-detection.md`.
- Run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --selector active`.
- Use the parser output, not visual scanning, to determine whether the selected task contains any live blocker lines.
- Treat only lines reported by the parser under `selected_task.live_blockers` as live blockers for this normalization step.
- Also use the parser output's `inconsistent_done_tasks` list as the source of truth for any `__done__` task that still carries unchecked subtasks, unchecked testing, or a live blocker.
- If you add or retire a live blocker during this step, rerun the parser before finalizing your answer so blocker state and task status match current disk state.

</blocker_detection_rules>

<normalization_rules>

- Treat a highest active task with all subtasks checked, all testing checked, and no live standalone `**BLOCKER**` as an invalid plan state that must not be left unchanged.
- Treat any `__done__` task still reported by the parser under `inconsistent_done_tasks` as an invalid plan state that must not be left unchanged.
- Treat any `current-task.json` state whose meaning is `needs_plan_repair` as an invalid plan state that must not be left unchanged.
- Treat multiple open `__in_progress__` tasks reported either by the parser or by `current-task.json` as an invalid plan state that must not be left unchanged.
- Treat a selector result that says no open or todo task could be found as an invalid plan state that must not be left unchanged unless the story is honestly complete.
- Re-read the task's full section, including `Task Exit Criteria`, `Subtasks`, `Testing`, and `Implementation notes`, before deciding what to change.
- If multiple open `__in_progress__` tasks exist, repair the plan so exactly one true active owner remains before the implementation loop continues.
- If no open or todo task exists but story-complete conditions are not yet honestly satisfied, repair task statuses, checklist state, or missing executable ownership so the next selector pass will not return `no_open_or_todo_task_found`.
- If needed, add or repair canonical `Task Status` lines so every executable task is visible to the selector as exactly one of `__to_do__`, `__in_progress__`, or `__done__`.
- Do not leave the plan in a state where remaining work exists only in prose, malformed statuses, or unowned checklist items that the selector cannot promote.
- Do not guess silently. Use the current task notes, prerequisites, and task ordering to decide which task should remain active, and move any stale, blocked-behind-prerequisite, or wrongly active task out of `__in_progress__`.
- When converting remaining work into explicit ownership, use this section contract:
  - `Subtasks` for implementation work, proof-authoring work, documentation updates, config changes, and explicitly allowed code-hygiene work that can be completed before formal proof runs;
  - `Testing` for automated proof execution only;
  - `Manual Testing Guidance` for optional, non-blocking guidance for the later `manual_testing_agent` pass only when useful.
- Do not create manual testing checklist items in `Subtasks` or `Testing`.
- Before preserving unchecked work or a blocker, interpret each checklist item by meaning rather than keywords. If an existing `Subtasks` or `Testing` item actually asks for browser walkthroughs, screenshots, an agent-driven manual scenario, or another manual-testing-agent action, preserve and merge its useful meaning into checkbox-free `Manual Testing Guidance`, remove only the misplaced checklist item, and retire any live blocker whose sole reason was waiting for that manual action. Do not mark the unperformed manual scenario as completed; it becomes non-blocking guidance for the later manual pass.
- Treat this section-shape repair as normal self-healing, not as a reason to split the task, add a prerequisite, or return the same task to automated proof unchanged.
- Do not create subtasks that depend on future automated or manual proof output in order to become complete.
- If the remaining prose describes manual validation, browser checks, screenshots, or runtime-visible follow-up, place that only in `Manual Testing Guidance` when useful rather than converting it into an unchecked subtask or testing checklist item.
- If the remaining prose describes proof artifacts or observability expectations, convert that into:
  - proof-authoring subtasks that prepare the relevant files, markers, fixtures, or harnesses; or
  - automated-only `Testing` steps that run the supported wrapper or harness.
- Do not create subtasks that say or imply `run automated tests`, `after Testing step N`, or `capture proof from the later test run`.
- Then do exactly one of the following:
  - mark the task `__done__` if current repository evidence shows the remaining prose-only note is already satisfied or is not an honest remaining gate; or
  - convert the real remaining work into one or more of:
    - unchecked implementation or proof-authoring subtasks;
    - unchecked automated-only testing steps;
    - a live standalone `**BLOCKER**` note,
      and leave the task `__in_progress__`.
- You may also add optional `Manual Testing Guidance` when later manual-testing-agent validation would help for an externally observable surface, but that guidance is not by itself a reason to keep the task `__in_progress__`.
- If the inconsistent task is currently `__done__` and the remaining unchecked checklist state is still honest unfinished work, reopen that task to `__in_progress__` before returning it to the loop.
- A task must not remain `__done__` while the parser still reports unchecked subtasks, unchecked testing, or a live blocker for that task.
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

- confirm you used a fresh bounded current-task packet;
- confirm you judged the inconsistent state from current plan state rather than memory;
- confirm you did not leave any selector-reported `needs_plan_repair` state unaddressed;
- confirm you did not leave a fully checked, unblocked task as `__in_progress__`;
- confirm you did not leave multiple open `__in_progress__` tasks after normalization;
- confirm you did not leave remaining work hidden behind missing or malformed task-status ownership;
- confirm you did not leave any parser-reported `inconsistent_done_tasks` entry in an invalid `__done__` state;
- confirm any remaining work was represented as unchecked checklist state or a live standalone `**BLOCKER**`, not only in prose;
- confirm you did not create manual testing checklist items in `Subtasks` or `Testing`;
- confirm you did not create subtasks that depend on future automated or manual proof output;
- confirm any optional manual-testing-agent guidance was placed only in `Manual Testing Guidance`;
- confirm tracked changes were committed if any were made.

</verification_loop>
