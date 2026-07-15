# Goal

Create or refresh exactly one completed plan audit task for every non-empty minor-fix pass represented in durable review disposition state.

<critical_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first and use its exact `plan_path`.
- Read `codeInfoStatus/flow-state/review-disposition-state.json` second.
- Do not reconstruct audit evidence from `## Minor Review Fixes`, review artifacts, git diffs, logs, or conversational memory.
- Run `python3 "$CODEINFO_ROOT/scripts/write_minor_fix_audit_task.py"` for the current pass, or add `--all-passes` only when this step runs after combined task-up and must refresh escalation coverage.
- Treat the helper as the sole writer of `minor_fix_loop_audit` tasks. Do not hand-edit, renumber, merge, or duplicate its output.
- If the helper reports `no_non_empty_pass_audit`, make no plan edit and do not create an empty task.
- The generated task is completed historical evidence. It must not replace, close, or satisfy the unfinished final revalidation task.
- If the plan changes, commit only the canonical plan with the story-prefixed commit convention. Do not push from this step.

</critical_rules>

<task_contract>

- Identify the task by the exact `Review Task Role`, `Review Cycle Id`, and `Review Pass Id` markers, not by title or task number.
- Require `Task Status: __done__` and a `#### Overview` that lists every `escalated_finding_ids` entry with its repository, summary, review provenance, and current combined task-up coverage.
- Require one checked subtask for every `fixed_finding_ids` entry, including the complete deduplicated changed-file list from state.
- Require one checked Testing item for every `executed_tests` entry, deduplicated by repository plus command. Never render `not_run` proof as executed testing.
- A failed execution may remain checked because the audit records that the command ran; preserve its explicit failed outcome. When a later execution of the same repository/command passed, render only the final passed outcome and its retry note.
- When combined task-up grouped multiple findings, list the same resulting task for every covered finding. Do not split or duplicate grouped tasks merely to make the audit one-to-one.

</task_contract>

<output_contract>

- Report whether the helper created, updated, or left each audit task unchanged, with its task number, review cycle, and review pass.
- Re-open the bounded plan task packet after a change and confirm exactly one task has the expected cycle/pass markers and checked evidence.

</output_contract>
