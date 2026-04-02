# Goal

Audit the implementation-only pass for the current task and normalize the plan honestly before automated proof runs.

<task>

Read the stored current-plan handoff and use only that scope for this step.
Re-open the exact plan file from disk before auditing.
Audit the coding agent's implementation-only work honestly.
Correct subtask and task status based on repository evidence.
Do not treat this step as automated-proof completion.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Re-open the exact relative `plan_path` from disk before auditing.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<audit_rules>

- Audit the coding agent's implementation-only work on the current task honestly.
- Check whether completed subtasks were implemented but left unmarked, and correct subtask status if the evidence supports it.
- Do not mark any `Testing` section items complete in this audit unless the plan already honestly shows they were completed earlier.
- Identify any blocker notes marked `**BLOCKER**`.
- Capture what remains incomplete and whether any blocker appears local to the task or likely needs planner review later.
- Do not research or repair the blocker in this step.

</audit_rules>

<stall_detection_rules>

- Compare the current task's open subtasks and implementation notes against the latest implementation pass.
- If the task still has unchecked subtasks, no previously unchecked subtask was completed in the latest implementation pass, and there is no live `**BLOCKER**` note, treat that as a stalled invalid state.
- In that stalled invalid state, add a live `**BLOCKER**` note immediately rather than letting the loop continue silently.
- That blocker note must state:
  - the exact remaining subtasks;
  - that the latest implementation pass made no subtask-closing progress;
  - the narrowing, investigation, or implementation work attempted;
  - and that planner intervention is now required to split, narrow, or re-own the task before implementation continues honestly.

</stall_detection_rules>

<task_status_rules>

- The task just worked in this loop must not remain hidden as `__to_do__`.
- After this audit, the task just worked in this loop must remain `__in_progress__`, because automated proof has not yet been completed in this loop.
- A task with unchecked subtasks must not continue through repeated implementation passes without either subtask closure or a live `**BLOCKER**`.
- If this audit detects that stalled state, preserve the task as `__in_progress__` and make the blocker visible so the planner loop can take over.
- After your audit edits, the highest-numbered task in the plan whose `Task Status` is either `__done__` or `__in_progress__` must be the task that was just worked in this loop.

</task_status_rules>

<git_rules>

- If you make tracked changes, you MUST commit them before finishing this step.
- Do not push in this step.

</git_rules>

<output_contract>

Return a concise summary that includes:

1. which task you audited;
2. whether any subtasks were newly marked complete;
3. whether a blocker exists;
4. what still remains incomplete before automated proof.

</output_contract>

<verification_loop>

Before finishing:

- confirm you re-read the plan from disk;
- confirm you audited implementation-only work rather than treating the task as fully proved;
- confirm no `Testing` section items were newly marked complete unless they were already honestly complete;
- confirm the just-worked task was left `__in_progress__`;
- confirm you did not leave a stalled task with open subtasks and no live `**BLOCKER**`;
- confirm any blocker was preserved and made visible in the plan;
- confirm tracked changes were committed if any were made.

</verification_loop>
