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

<task_status_rules>

- The task just worked in this loop must not remain hidden as `__to_do__`.
- After this audit, the task just worked in this loop must remain `__in_progress__`, because automated proof has not yet been completed in this loop.
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
- confirm any blocker was preserved and made visible in the plan;
- confirm tracked changes were committed if any were made.

</verification_loop>
