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

<audit_rules>

- Audit the coding agent's implementation and automated-proof work on the current task honestly.
- Check whether completed work was implemented or proved but left unmarked, and correct task, subtask, and testing statuses if the evidence supports it.
- Identify any blocker notes marked `**BLOCKER**`.
- Capture what remains incomplete and whether any blocker appears local to the task or likely needs planner review later.
- Do not research or repair the blocker in this step.

</audit_rules>

<task_status_rules>

- The task just worked in this loop must not remain hidden as `__to_do__`.
- If its subtasks and testing are honestly complete and no blocker remains, ensure its `Task Status` is `__done__`.
- This audit is the step that should flip the task to `__done__` when planner repair or earlier proof work has already made the task honestly complete.
- Do not require a new automated-proof execution in this pass if the task's testing section is already honestly complete from earlier work.
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
- confirm any blocker was preserved and made visible in the plan;
- confirm tracked changes were committed if any were made.

</verification_loop>
