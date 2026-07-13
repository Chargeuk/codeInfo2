# Goal

Identify exactly which newly added review-created `__to_do__` tasks are eligible for enhancement before the reused `task_up` quality passes run.

<instruction_priority>

- Follow the scoped contract from `"$CODEINFO_ROOT/codeinfo_markdown/review_task_enhancement/01-shared-contract.md"`.
- Be conservative. It is better to enhance too few tasks than to silently retask older story work.
- Use on-disk plan evidence and current working-tree diff evidence, not memory, to identify the eligible tasks.

</instruction_priority>

<selection_rules>

- Re-read `codeInfoStatus/flow-state/current-plan.json`, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, and run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` before doing selection.
- Identify the current selected story file and inspect its current working-tree diff against `HEAD`.
- Use that diff to find newly added `__to_do__` review-fix sections appended by the immediately preceding `review_disposition` pass.
- Eligible tasks must satisfy all of the following unless the plan file proves a tighter equivalent:
  - they were newly added in the current plan diff;
  - they are still marked `Task Status: __to_do__`;
  - they clearly exist to address the latest review findings, blind-spot challenge, or review disposition output.
- If review disposition added a consecutive block of new high-numbered `__to_do__` tasks at the end of the file, treat that block as the default eligible scope.
- If the diff shows review-created tasks inserted into older parts of the plan instead of appended at the end, treat that as invalid placement to be repaired in the enhancement pass rather than as a valid eligible shape.
- Do not select pre-existing tasks solely because they are related to the same seam.
- Do not select tasks already `__in_progress__` or `__done__`.
- Newly added review-created tasks remain eligible for enhancement when they still contain legacy manual-testing checklist items or subtasks that depend on future automated or manual proof output.
- If the selected review-created block is so malformed that stable enhancement would require deleting, merging away, or absorbing selected tasks into older tasks, treat that as an upstream packaging defect rather than silently broadening scope.

</selection_rules>

<ambiguity_rules>

- If the plan diff shows both newly added review-created tasks and unrelated edits, limit enhancement to the task additions only.
- If the diff does not make the new review-created tasks identifiable, use the latest review-disposition wording in the plan to isolate them.
- If the new review-created tasks are not a contiguous appended end-of-file block after the latest `Code Review Findings` section, report that placement defect and normalize it instead of preserving the inserted layout.
- If eligibility is still ambiguous after using both the plan file and its current diff, stop and report the ambiguity instead of rewriting broader task ranges.

</ambiguity_rules>

<handoff_rules>

- Before the next pass, establish a clear internal set of eligible task numbers and keep later edits limited to them except for minimal cross-reference or dependency corrections.
- Treat that selected eligible task set as stable for later enhancement passes. Later passes may rewrite the selected tasks in place, but they must not delete, absorb, or identity-shift the selected tasks.
- Keep later enhancement work focused on normalizing those eligible tasks to the current section contract rather than broadening scope.
- If no eligible tasks exist, stop without changing the plan.

</handoff_rules>
