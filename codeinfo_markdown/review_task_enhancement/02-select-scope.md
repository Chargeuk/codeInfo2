# Goal

Identify exactly which newly added review-created `__to_do__` tasks are eligible for enhancement before the reused `task_up` quality passes run.

<instruction_priority>

- Follow the scoped contract from `review_task_enhancement/01-shared-contract.md`.
- Be conservative. It is better to enhance too few tasks than to silently retask older story work.
- Use on-disk plan evidence and current working-tree diff evidence, not memory, to identify the eligible tasks.

</instruction_priority>

<selection_rules>

- Re-read `codeInfoStatus/flow-state/current-plan.json` and re-open the exact `plan_path` from disk before doing selection.
- Identify the current selected story file and inspect its current working-tree diff against `HEAD`.
- Use that diff to find newly added tasks or newly inserted `__to_do__` review-fix sections created by the immediately preceding `review_disposition` pass.
- Eligible tasks must satisfy all of the following unless the plan file proves a tighter equivalent:
  - they were newly added or materially inserted in the current plan diff;
  - they are still marked `Task Status: __to_do__`;
  - they clearly exist to address the latest review findings, blind-spot challenge, or review disposition output.
- If review disposition added a consecutive block of new high-numbered `__to_do__` tasks, treat that block as the default eligible scope.
- If review disposition inserted a prerequisite task between older tasks, that inserted `__to_do__` task is eligible even if it is not the highest-numbered task.
- Do not select pre-existing tasks solely because they are related to the same seam.
- Do not select tasks already `__in_progress__` or `__done__`.

</selection_rules>

<ambiguity_rules>

- If the plan diff shows both newly added review-created tasks and unrelated edits, limit enhancement to the task additions only.
- If the diff does not make the new review-created tasks identifiable, use the latest review-disposition wording in the plan to isolate them.
- If eligibility is still ambiguous after using both the plan file and its current diff, stop and report the ambiguity instead of rewriting broader task ranges.

</ambiguity_rules>

<handoff_rules>

- Before the next pass, establish a clear internal set of eligible task numbers and keep later edits limited to them except for minimal cross-reference or dependency corrections.
- If no eligible tasks exist, stop without changing the plan.

</handoff_rules>
