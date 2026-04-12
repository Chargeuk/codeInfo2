# Goal

Audit the implementation-plus-automated-proof pass for the current task and normalize the plan honestly before manual testing runs.

<task>

Read the stored current-plan handoff and use only that scope for this step.
Re-open the exact plan file from disk before auditing.
Audit the coding agent's implementation and automated-proof work honestly.
Correct task, subtask, and testing status based on repository evidence.
Decide whether the task is now honestly `__done__` or still `__in_progress__`.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Re-open the exact relative `plan_path` from disk before auditing.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<blocker_detection_rules>

- Before deciding whether the current task has a live blocker, read `codeinfo_markdown/shared/blocker-detection.md`.
- Run `python3 scripts/plan_status.py --selector active_or_done`.
- Use the parser output, not visual scanning, to determine whether the selected task contains any live blocker lines.
- Treat only lines reported by the parser under `selected_task.live_blockers` as live blockers for this audit.
- If you add or retire a live blocker during this step, rerun the parser before finalizing your answer so blocker state and task status match current disk state.

</blocker_detection_rules>

<audit_rules>

- Audit the coding agent's implementation and automated-proof work on the current task honestly.
- Check whether completed work was implemented or proved but left unmarked, and correct task, subtask, and testing statuses if the evidence supports it.
- A task must not remain `__done__` if it still has unchecked subtasks, unchecked testing, or a live standalone `**BLOCKER**`; if you discover that invalid state for the selected task, reopen it to `__in_progress__` or finish the checklist honestly before finalizing this audit.
- Identify any blocker notes marked `**BLOCKER**`.
- Capture what remains incomplete and whether any blocker appears local to the task or likely needs planner review later.
- Treat unchecked subtasks, unchecked testing steps, and a live standalone `**BLOCKER**` note as the only valid reasons for the just-worked task to remain `__in_progress__` after this automated-proof audit.
- If prose notes, exit-criteria text, or other non-checklist text still claim remaining work after all subtasks and testing are checked and no live standalone `**BLOCKER**` remains, treat that as invalid task shape rather than as a reason to keep the task open.
- In that invalid task-shape case, either:
  - mark the task `__done__` if current repository evidence shows the prose-only remainder is already satisfied or is not an honest remaining gate; or
  - convert the real remaining work into an unchecked subtask, unchecked testing step, or live standalone `**BLOCKER**` note before leaving the task `__in_progress__`.
- Before appending an audit note, re-read the latest existing audit or implementation note for this task.
- If the latest audit outcome is materially unchanged, do not append another audit note just to restate the same state.
- Treat the outcome as materially unchanged when no subtask status changed, no testing status changed, no blocker state changed, no task status changed, and no new proof or owner conclusion was reached.
- Do not research or repair the blocker in this step.

</audit_rules>

<task_status_rules>

- The task just worked in this loop must not remain hidden as `__to_do__`.
- If its subtasks and testing are honestly complete and no blocker remains, ensure its `Task Status` is `__done__`.
- This audit is the step that should flip the task to `__done__` when planner repair or earlier proof work has already made the task honestly complete.
- Do not require a new automated-proof execution in this pass if the task's testing section is already honestly complete from earlier work.
- Do not keep the task `__in_progress__` solely because prose notes or exit-criteria text still mention remaining work when no unchecked subtasks, unchecked testing steps, or live standalone `**BLOCKER**` note remain.
- If it is blocked or still requires work, ensure its `Task Status` is `__in_progress__`.
- After your audit edits, the highest-numbered task in the plan whose `Task Status` is either `__done__` or `__in_progress__` must be the task that was just worked in this loop.

</task_status_rules>

<git_rules>

- If you make tracked changes, you MUST commit them before finishing this step.
- Do not push in this step.

</git_rules>

<output_contract>

Return a concise summary that includes:

1. which task you audited;
2. whether any testing steps were newly marked complete;
3. whether a blocker exists;
4. whether the task is now `__done__` or remains `__in_progress__`.

</output_contract>

<verification_loop>

Before finishing:

- confirm you re-read the plan from disk;
- confirm you audited both implementation and automated proof honestly;
- confirm task, subtask, and testing status were normalized to match evidence;
- confirm the task was set to `__done__` only when both subtasks and testing were honestly complete and no blocker remained;
- confirm any prose-only remaining-work note was either converted into an unchecked checklist item or blocker, or ignored for completion because it was not an honest remaining gate;
- confirm you did not append a duplicate audit note when the task state was materially unchanged;
- confirm any blocker was preserved and made visible in the plan;
- confirm tracked changes were committed if any were made.

</verification_loop>
