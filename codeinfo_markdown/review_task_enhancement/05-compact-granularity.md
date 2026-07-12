# Goal

Make selected review-created tasks concrete and executable without expanding them into full story-sized task breakdowns.

<instruction_priority>

- Follow `"$CODEINFO_ROOT/codeinfo_markdown/review_task_enhancement/01-shared-contract.md"` and keep the scope limited to the selected review-created `__to_do__` tasks.
- Preserve selected review-created task identities, grouping, and `Addresses Findings` coverage.
- Prefer compact first-class patch tasks over one-checkbox-per-file decomposition.
- Compactness must not hide ownership, sequencing, file targets, proof homes, or stopping rules.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. Exclude the dedicated final task from subtask compaction or expansion and preserve its two initial lint and formatting subtasks exactly.

</instruction_priority>

<compact_granularity_rules>

- Immediately before editing, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, rerun `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking`, and use only its fresh bounded task selection and section content.
- Preserve grouped substantive review-fix tasks that share repository ownership, repair seam, root cause, and proof story.
- Keep one compact implementation subtask when several nearby files must change together to express one coherent fix. Name the files or surfaces inline inside that subtask.
- Keep one compact proof-authoring subtask when one proof file or proof surface can honestly cover several related assertions. List the assertions inline inside that subtask.
- Split a subtask only when one of these boundaries is present:
  - different repository ownership;
  - different implementation owner or materially different repair seam;
  - required sequencing or prerequisite handoff;
  - different proof file, harness, or wrapper where combining would hide the proof story;
  - a combined subtask would become vague, blocked, or hard for a junior implementer to complete.
- Do not split merely because a coherent patch touches code plus tests, or because one proof file needs multiple assertions.
- Do not split merely because a sentence contains multiple file names when those files are part of one small review fix.
- Rewrite vague subtasks into compact concrete subtasks instead of exploding them into many micro-subtasks.
- Keep runnable build, test, compose, browser, and wrapper commands in `Testing`, except when the task specifically creates, repairs, or proves a harness or wrapper.

</compact_granularity_rules>

<verification_loop>

- Check that each selected review-created task is still grouped around one coherent repair seam or finding cluster.
- Check that compact subtasks name enough files, surfaces, outcomes, and proof homes for a junior implementer to act without guessing.
- Check that no task was split, merged, absorbed, or identity-shifted during this pass.
- Check that no vague `fix`, `handle`, `wire up`, or `update tests` wording remains without concrete targets and outcomes.
- Check that compactness did not create subtasks gated on later automated or manual proof output.

</verification_loop>

<output_contract>

- Update selected review-created tasks directly.
- Keep wording concise, concrete, and scoped.
- Do not add filler subtasks whose only purpose is to restate the task title or one file name.

</output_contract>
