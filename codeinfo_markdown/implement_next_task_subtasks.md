# Goal

Implement the next executable task's `Subtasks` section only.

<task>

Read the stored current-plan handoff and use only that scope for this step.
Re-open the exact plan file from disk before doing any work.
Identify the next executable task from the current plan.
Work through that task's `Subtasks` section fully and honestly.
Do not run the task's `Testing` section in this step.
Do not mark any `Testing` section items complete in this step.
Leave the task ready for the later automated-proof step.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Re-open the exact relative `plan_path` from disk before starting.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<task_selection_rules>

- Identify the next executable task from the current plan as it exists on disk now.
- Re-read the selected task's full text before changing code so you are working from the latest text.
- Re-read the end of the plan and confirm the highest task heading currently present so you do not miss newly added or renumbered tasks.
- Treat the selected task as `__in_progress__` while you are working on its subtasks, unless it becomes blocked.
- Do not mark the task `__done__` in this step. The later audit step decides whether the task is truly complete after automated proof.

</task_selection_rules>

<execution_rules>

- Work only through the selected task's `Subtasks` section.
- Complete implementation subtasks, proof-authoring subtasks, and any lint, format, or static-analysis subtasks that are listed inside `Subtasks`.
- Do not run the task's `Testing` section wrappers in this step.
- Keep the plan honest while you work:
  - mark each completed subtask complete immediately;
  - add concise implementation notes as work progresses;
  - keep notes specific about what changed, what issue was overcome, or why work is blocked.
- If the task needs additional in-scope implementation work to stay honest, you may add concise new unchecked subtasks to the same task before completing that work.
- If the task needs additional automated proof obligations to stay honest, do not run them here; leave those for the later automated-proof step.

</execution_rules>

<blocker_rules>

- If a blocker is hit, stop and write it into the task's `Implementation Notes` marked as `**BLOCKER**`.
- The blocker note must include:
  - the exact subtask where work stopped;
  - what you tried;
  - the exact missing capability or contradiction;
  - whether the task should be split, reordered, or rewritten before work continues.
- If blocked, leave the task as `__in_progress__`.
- Do not invent fake runtime seams, fake containers, fake health checks, or fake proof.

</blocker_rules>

<git_rules>

- If you make tracked changes, you MUST commit them before finishing this step.
- Do not push in this step.

</git_rules>

<output_contract>

Return a concise summary that includes:

1. which task you worked on;
2. whether all subtasks are now complete;
3. whether the task is ready for automated proof or blocked;
4. any important gotchas encountered.

Do not claim the task is fully complete unless the `Testing` section has also been run later.
Do not mark `Testing` section items complete in this step.

</output_contract>

<verification_loop>

Before finishing:

- confirm you re-read the plan from disk;
- confirm you worked only on the selected task's `Subtasks`;
- confirm you did not run or check off the `Testing` section;
- confirm completed subtasks were marked immediately;
- confirm any blocker was written into `Implementation Notes` as `**BLOCKER**`;
- confirm tracked changes were committed if any were made.

</verification_loop>
